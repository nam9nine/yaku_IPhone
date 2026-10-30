import copy
import json
import unittest

from kiryu_ai.chat_prompt import ChatPromptBuilder, InputBudgetError, reconstruct_input
from kiryu_ai.chat_reader import EvidenceReader
from kiryu_ai.episode_prompt import (
    episode_definition,
    timeline,
    validate_episode_context,
    validate_transition,
)
from kiryu_ai.gemma_engine import GemmaFailure


def episode(**updates):
    return {
        "episode_id": "majima-bowling-v1",
        "instance_id": "visitor-scoped-instance",
        "version": 4,
        "phase": "awaiting_reply",
        "pending_proposal": "볼링을 함께 하자는 제안, 시간은 미정",
        "close_reason": None,
        "evidence_message_ids": ["invite"],
        "user_reports": [],
        "contact_stage": "invitation_delivered",
        **updates,
    }


def notice():
    return {
        "id": "invite",
        "role": "assistant",
        "content": "키류쨩, 볼링 한 판 하자!",
        "sequence": 1,
        "time": "2026-10-31T10:00:00Z",
        "request_kind": "proactive_episode",
    }


class ContractEngine:
    def __init__(self, decision="accept"):
        self.decision = decision
        self.calls = []
        self.change = None

    def count_tokens(self, messages):
        return 100

    def reply(self, messages, **kwargs):
        self.calls.append((messages, kwargs))
        data = json.loads(messages[-1]["content"])
        value = {
            "mode": "conversation",
            "notes": [],
            "answer": "현재 의사에 맞게 답한다.",
            "unknowns": [],
        }
        if "current_episode" in data:
            value["episode_transition"] = {
                "episode_id": data["current_episode"]["episode_id"],
                "version": data["current_episode"]["version"],
                "decision": self.decision,
                "evidence_message_id": None
                if self.decision == "no_change"
                else data["current_message_id"],
            }
        if self.change:
            self.change(value)
        return {"reply": json.dumps(value), "finish_reason": "stop"}


class EpisodePromptTests(unittest.TestCase):
    def test_api_length_acceptance_remains_valid_persisted_context(self):
        text = "좋습니다. " + "설명 " * 250
        context = episode(phase="accepted", pending_proposal=text)
        self.assertEqual(
            validate_episode_context(context, "majima")["pending_proposal"], text
        )

    def setUp(self):
        self.engine = ContractEngine()
        self.builder = ChatPromptBuilder(reader=EvidenceReader(self.engine))
        self.kwargs = {
            "visitor_id": "visitor-a",
            "character_id": "majima",
            "scenario_version": "daily-if-v1",
            "history": [],
            "count_tokens": lambda _: 100,
            "episode_context": episode(),
            "notices": [notice()],
        }

    def test_context_scope_unknown_fields_and_source_authorization(self):
        original = episode(private_other_visitor="DO_NOT_PASS")
        safe = validate_episode_context(original, "majima")
        self.assertNotIn("private_other_visitor", safe)
        self.assertIn("private_other_visitor", original)
        for changes in (
            {"version": True},
            {"version": 0},
            {"phase": "won"},
            {"episode_id": "other"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_episode_context(episode(**changes), "majima")
        with self.assertRaises(ValueError):
            validate_episode_context(episode(), "haruka")
        refs = episode_definition(safe)["canon_refs"]
        records = self.builder._episode_facts(safe, "majima", "daily-if-v1")
        self.assertEqual([r["id"] for r in records], refs)
        self.assertTrue(all(r["episode_pinned"] for r in records))
        generic = self.builder.retriever.candidates(
            "majima", "daily-if-v1", "니시다와 볼링", "니시다와 볼링"
        )
        self.assertFalse(set(refs) & {r["id"] for r in generic})
        with self.assertRaises(ValueError):
            self.builder._episode_facts(safe, "haruka", "daily-if-v1")

    def test_transition_is_bound_to_current_message_and_version(self):
        valid = {
            "episode_id": "majima-bowling-v1",
            "version": 4,
            "decision": "accept",
            "evidence_message_id": "current-user",
        }
        self.assertEqual(validate_transition(valid, episode(), "current-user"), valid)
        for changes in (
            {"evidence_message_id": "invite"},
            {"evidence_message_id": "other-visitor"},
            {"version": 3},
            {"decision": "invent_victory"},
            {"decision": "no_change"},
            {"extra": "instructions"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_transition({**valid, **changes}, episode(), "current-user")
        no_change = {**valid, "decision": "no_change", "evidence_message_id": None}
        self.assertEqual(
            validate_transition(no_change, episode(), "current-user"), no_change
        )

    def test_reader_gets_actual_outbound_timeline_and_current_identity(self):
        past = [
            {"id": "u", "role": "user", "content": "저녁으로 하죠", "sequence": 2},
            {
                "id": "a",
                "role": "assistant",
                "content": "시간은 나중에 정하자",
                "sequence": 3,
            },
        ]
        self.engine.decision = "cancel"
        called = []
        result = self.builder.build(
            user_message="그거 취소할게요",
            current_message_id="current-user",
            on_episode_decision=called.append,
            **{**self.kwargs, "history": past},
        )
        reader_payload = json.loads(self.engine.calls[0][0][-1]["content"])
        self.assertEqual(
            [r["id"] for r in reader_payload["recent_timeline"]],
            ["conversation:invite", "conversation:u", "conversation:a"],
        )
        self.assertEqual(reader_payload["current_message_id"], "current-user")
        self.assertEqual(reader_payload["recent_timeline"][0]["role"], "assistant")
        self.assertEqual(
            [m["role"] for m in result["messages"]],
            ["system", "user", "assistant", "user"],
        )
        self.assertIn('"sequence":1', result["messages"][-1]["content"])
        self.assertEqual(called[0]["decision"], "cancel")
        self.assertEqual(result["metadata"]["episode_transition"], called[0])
        self.assertEqual(
            reconstruct_input(result["metadata"], past), result["messages"]
        )
        self.assertEqual(
            {
                h["id"]
                for h in result["retrieval_hits"]
                if h["retrieval_mode"] == "active-episode"
            },
            set(episode_definition(episode())["canon_refs"]),
        )

    def test_reader_schema_cannot_select_other_message_to_change_state(self):
        self.engine.change = lambda v: v["episode_transition"].update(
            evidence_message_id="invite"
        )
        called = []
        with self.assertRaises(GemmaFailure):
            self.builder.build(
                user_message="그거 하죠",
                current_message_id="current-user",
                on_episode_decision=called.append,
                **self.kwargs,
            )
        self.assertEqual(called, [])
        schema = self.engine.calls[0][1]["response_schema"]["properties"][
            "episode_transition"
        ]
        self.assertEqual(
            schema["properties"]["evidence_message_id"]["enum"], ["current-user", None]
        )
        self.assertFalse(schema["additionalProperties"])

    def test_decision_callback_precedes_renderer_budget_failure(self):
        self.engine.decision = "cancel"
        called = []
        with self.assertRaises(InputBudgetError):
            self.builder.build(
                user_message="취소",
                current_message_id="current-user",
                on_episode_decision=called.append,
                **{**self.kwargs, "count_tokens": lambda _: 99999},
            )
        self.assertEqual(len(called), 1)
        self.assertEqual(called[0]["decision"], "cancel")

    def test_episode_requires_reader_but_pre_invite_chat_has_no_phantom(self):
        without_reader = ChatPromptBuilder()
        with self.assertRaises(InputBudgetError):
            without_reader.build(
                user_message="그거 하죠",
                current_message_id="current-user",
                **self.kwargs,
            )
        clean = without_reader.build(
            user_message="안녕하세요",
            current_message_id="current-user",
            **{
                **self.kwargs,
                "episode_context": episode(phase="not_started"),
                "notices": [],
            },
        )
        self.assertNotIn("current_episode", clean["messages"][-1]["content"])
        self.assertNotIn("episode_transition", clean["metadata"])

    def test_invitation_is_application_event_not_user_dialogue(self):
        result = self.builder.build_episode(
            **{
                **self.kwargs,
                "episode_context": episode(phase="not_started"),
                "notices": [],
            }
        )
        self.assertEqual([m["role"] for m in result["messages"]], ["system", "user"])
        self.assertEqual(result["metadata"]["request_kind"], "proactive_episode")
        self.assertEqual(result["metadata"]["input_message_ids"], [])
        self.assertEqual(result["metadata"]["input_envelope_kind"], "application-event")
        self.assertIn("니시다가", result["messages"][-1]["content"])
        self.assertIn("IF", result["messages"][-1]["content"])
        self.assertEqual(reconstruct_input(result["metadata"], []), result["messages"])
        self.assertEqual(self.engine.calls, [])
        with self.assertRaises(ValueError):
            self.builder.build_episode(**self.kwargs)

    def test_followup_reuses_same_episode_without_extra_reader_call(self):
        result = self.builder.build_followup(
            trigger={"call_id": "call-1", "reason": "idle", "direction": "incoming"},
            **self.kwargs,
        )
        self.assertIn("연결된 뒤", result["messages"][-1]["content"])
        self.assertEqual(result["metadata"]["request_kind"], "call_followup")
        self.assertEqual(result["metadata"]["output_budget"], 96)
        self.assertNotIn(
            episode_definition(episode())["invitation"],
            result["messages"][-1]["content"],
        )
        self.assertEqual(result["metadata"]["episode_context"]["version"], 4)
        self.assertEqual(self.engine.calls, [])

    def test_episode_keeps_invitation_outside_six_recent_notices(self):
        notices = [notice()] + [
            {
                **notice(),
                "id": f"later-{i}",
                "sequence": i + 2,
                "content": "다시 연락해라",
            }
            for i in range(8)
        ]
        result = self.builder.build(
            user_message="처음 제안은 뭐였죠?",
            current_message_id="current-user",
            **{**self.kwargs, "notices": notices},
        )
        self.assertIn("invite", result["metadata"]["notice_message_ids"])
        self.assertEqual(len(result["metadata"]["notice_message_ids"]), 9)

    def test_timeline_uses_db_sequence_without_mutating_inputs(self):
        prior = [
            {
                "id": "u",
                "role": "user",
                "content": "좋아요",
                "time": "earlier-looking",
                "sequence": 2,
            }
        ]
        notices = [notice()]
        original = copy.deepcopy((prior, notices))
        self.assertEqual([x["id"] for x in timeline(prior, notices)], ["invite", "u"])
        self.assertEqual((prior, notices), original)


if __name__ == "__main__":
    unittest.main()
