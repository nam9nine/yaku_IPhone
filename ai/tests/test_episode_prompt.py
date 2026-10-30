import copy
import json
import unittest

from kiryu_ai.chat_prompt import ChatPromptBuilder, InputBudgetError, reconstruct_input
from kiryu_ai.chat_reader import EvidenceReader
from kiryu_ai.episode_prompt import (
    OUTBOUND_FACTS_RULES,
    OUTBOUND_FACTS_VERSION,
    episode_definition,
    episode_state_view,
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
                "decision": {
                    "accept": "accept_participation",
                    "report_outcome": "report_activity_completion",
                }.get(self.decision, self.decision),
                "evidence_message_id": None
                if self.decision == "no_change"
                else data["current_message_id"],
            }
        if self.change:
            self.change(value)
        return {"reply": json.dumps(value), "finish_reason": "stop"}


class EpisodePromptTests(unittest.TestCase):
    def test_current_turn_task_respects_phase_but_discussion_can_resume(self):
        cases = (
            ("defer", "awaiting_reply", "respect_pause_or_end"),
            ("cancel", "accepted", "respect_pause_or_end"),
            ("change_topic", "accepted", "respect_pause_or_end"),
            ("no_change", "closed", "respect_pause_or_end"),
            ("discuss_proposal", "deferred", "discuss"),
            ("accept_participation", "deferred", "acknowledge_acceptance"),
            ("amend_participation", "accepted", "acknowledge_amendment"),
            ("report_progress", "accepted", "acknowledge_progress"),
        )
        for act, phase, policy_id in cases:
            with self.subTest(act=act, phase=phase):
                self.engine.decision = act
                result = self.builder.build(
                    user_message="현재 문자의 질문",
                    current_message_id="current-user",
                    **{**self.kwargs, "episode_context": episode(phase=phase)},
                )
                task = result["metadata"]["episode_turn_task"]
                self.assertEqual(task["policy_id"], policy_id)
                envelope = result["messages"][-1]["content"]
                self.assertTrue(envelope.endswith(task["instruction"]))
                self.assertNotIn('"episode_purpose"', envelope)
                self.assertIn('"id":"majima-bowling-challenge"', envelope)
                self.assertIn('"id":"majima-retrain-rival"', envelope)
                self.assertEqual(
                    reconstruct_input(result["metadata"], []), result["messages"]
                )

    def test_reader_acts_separate_discussion_progress_and_terminal_decisions(self):
        cases = (
            ("discuss_proposal", "deferred", "no_change", "deferred"),
            ("report_progress", "awaiting_reply", "no_change", "awaiting_reply"),
            ("accept_participation", "deferred", "accept", "accepted"),
            ("amend_participation", "accepted", "accept", "accepted"),
            ("report_activity_completion", "accepted", "report_outcome", "closed"),
        )
        for act, phase, decision, next_phase in cases:
            with self.subTest(act=act):
                self.engine.decision = act
                calls = []
                result = self.builder.build(
                    user_message="행위 분류 계약 검사용 현재 원문",
                    current_message_id="current-user",
                    on_episode_decision=calls.append,
                    **{**self.kwargs, "episode_context": episode(phase=phase)},
                )
                interpretation = result["metadata"]["grounding"][
                    "episode_interpretation"
                ]
                self.assertEqual(interpretation["reader_act"], act)
                self.assertEqual(interpretation["raw_transition"]["decision"], act)
                self.assertEqual(
                    interpretation["validated_transition"]["decision"], decision
                )
                self.assertEqual(calls[0]["decision"], decision)
                self.assertEqual(
                    calls[0]["evidence_message_id"],
                    None if decision == "no_change" else "current-user",
                )
                envelope = result["messages"][-1]["content"]
                self.assertIn(f'"current_episode_speech_act":"{act}"', envelope)
                self.assertIn(f'"phase":"{next_phase}"', envelope)
                schema = self.engine.calls[-1][1]["response_schema"]["properties"][
                    "episode_transition"
                ]
                allowed = schema["properties"]["decision"]["enum"]
                self.assertIn(act, allowed)
                self.assertNotIn("accept", allowed)
                self.assertNotIn("report_outcome", allowed)

    def test_new_reader_acts_keep_version_and_message_scope_strict(self):
        for act in (
            "discuss_proposal",
            "report_progress",
            "accept_participation",
            "amend_participation",
            "report_activity_completion",
        ):
            self.engine.decision = act
            for changes in (
                {"version": 0},
                {"evidence_message_id": "other-user"},
                {"decision": "accept"},
                {"decision": "report_outcome"},
            ):
                with self.subTest(act=act, changes=changes):
                    self.engine.change = lambda value, changes=changes: value[
                        "episode_transition"
                    ].update(changes)
                    with self.assertRaises(GemmaFailure):
                        self.builder.build(
                            user_message="현재 원문",
                            current_message_id="current-user",
                            **self.kwargs,
                        )

    def test_condition_amendment_uses_canonical_accept_but_keeps_original_act(self):
        """Contract replay with a stub act; not evidence of model classification."""
        old = "토요일 오후 3시에 같이 볼링 치겠습니다."
        history = [
            {"id": "old-user", "role": "user", "content": old, "sequence": 2},
            {
                "id": "old-answer",
                "role": "assistant",
                "content": "좋다.",
                "sequence": 3,
            },
        ]
        state = episode(
            phase="accepted", pending_proposal=old, evidence_message_ids=["old-user"]
        )
        original = copy.deepcopy(state)
        for current in (
            "토요일 약속은 취소하고 일요일 오후 4시로 바꿔 주세요.",
            "날짜는 그대로 두고 장소만 역 앞에 있는 곳으로 바꾸겠습니다.",
            "함께 하는 건 그대로입니다. 먼저 말한 세 판 대신 한 판으로 변경해 주세요.",
        ):
            with self.subTest(current=current):
                self.engine.decision = "amend_participation"
                callbacks = []
                result = self.builder.build(
                    user_message=current,
                    current_message_id="replacement-user",
                    on_episode_decision=callbacks.append,
                    **{**self.kwargs, "episode_context": state, "history": history},
                )
                self.assertEqual(
                    callbacks,
                    [
                        {
                            "episode_id": state["episode_id"],
                            "version": state["version"],
                            "decision": "accept",
                            "evidence_message_id": "replacement-user",
                        }
                    ],
                )
                interpretation = result["metadata"]["grounding"][
                    "episode_interpretation"
                ]
                self.assertEqual(interpretation["reader_act"], "amend_participation")
                self.assertEqual(
                    interpretation["raw_transition"]["decision"], "amend_participation"
                )
                self.assertEqual(
                    result["metadata"]["episode_turn_task"]["policy_id"],
                    "acknowledge_amendment",
                )
                envelope = result["messages"][-1]["content"]
                self.assertIn('"current_episode_interpretation":"accept"', envelope)
                self.assertIn(
                    '"current_episode_speech_act":"amend_participation"', envelope
                )
                self.assertIn(
                    '"pending_proposal":{"message_id":"replacement-user"}', envelope
                )
                self.assertIn('"phase":"accepted"', envelope)
                self.assertIn(json.dumps(current, ensure_ascii=False), envelope)
                self.assertNotIn('"close_reason":"cancel"', envelope)
                self.assertEqual(
                    reconstruct_input(result["metadata"], history), result["messages"]
                )
                self.assertEqual(state, original)

    def test_condition_question_deferral_and_full_cancellation_have_distinct_contracts(
        self,
    ):
        """Only verify parsed acts/state plumbing; generation is tested separately."""
        for act, current, canonical, phase, task in (
            (
                "discuss_proposal",
                "다른 시간으로 바꿀 수 있습니까?",
                "no_change",
                "accepted",
                "discuss",
            ),
            (
                "defer",
                "일단 미루겠습니다. 언제 가능할지는 아직 모릅니다.",
                "defer",
                "deferred",
                "respect_pause_or_end",
            ),
            (
                "cancel",
                "그 활동은 아예 하지 않겠습니다. 다른 약속도 잡지 마세요.",
                "cancel",
                "closed",
                "respect_pause_or_end",
            ),
        ):
            with self.subTest(act=act):
                self.engine.decision = act
                result = self.builder.build(
                    user_message=current,
                    current_message_id="current-user",
                    **{**self.kwargs, "episode_context": episode(phase="accepted")},
                )
                self.assertEqual(
                    result["metadata"]["episode_transition"]["decision"], canonical
                )
                self.assertEqual(
                    result["metadata"]["episode_turn_task"]["policy_id"], task
                )
                self.assertIn(f'"phase":"{phase}"', result["messages"][-1]["content"])
                if act == "cancel":
                    self.assertIn(
                        '"close_reason":"cancel"', result["messages"][-1]["content"]
                    )

    def test_identical_note_selections_are_deduplicated_with_raw_audit(self):
        identifier = "c1093ba9-ca6c-43f2-8116-41dc2b486824-assistant"
        quote = "맞다, 그때는 그랬었제. 이번에는 내서 직접 연락한 기다. 그래서, 볼링은 어떠노?"
        current = "2e8910f5-5a8b-418e-bdd3-f64af8432498-user"
        self.engine.decision = "no_change"

        def reply(value):
            value.update(
                mode="grounded",
                notes=[
                    {"id": "conversation:" + identifier, "field": "text"}
                    for _ in range(3)
                ],
                answer="맞다. 이번에는 내 손으로 직접 보낸 기다.",
            )
            value["episode_transition"]["evidence_message_id"] = current

        self.engine.change = reply
        result = self.builder.build(
            user_message="지금 문자 보낸 건 형님이잖아요.",
            current_message_id=current,
            **{
                **self.kwargs,
                "history": [
                    {
                        "id": "past-user",
                        "role": "user",
                        "content": "예전에는 니시다가 연락했죠?",
                    },
                    {"id": identifier, "role": "assistant", "content": quote},
                ],
            },
        )
        audit = result["metadata"]["grounding"]
        self.assertEqual(
            audit["notes"]["notes"],
            [{"id": "conversation:" + identifier, "quote": quote, "role": "assistant"}],
        )
        self.assertEqual(len(audit["note_normalization"]["raw_notes"]), 3)
        self.assertEqual(len(audit["selected_fields"]), 1)
        allowed = self.engine.calls[-1][1]["response_schema"]["properties"]["notes"][
            "items"
        ]["enum"]
        self.assertIn({"id": "conversation:" + identifier, "field": "text"}, allowed)
        self.assertNotIn(
            {"id": "conversation:" + identifier, "field": "source_excerpt"}, allowed
        )
        self.assertIn(
            {"id": "majima-bowling-challenge", "field": "source_excerpt"}, allowed
        )

    def test_note_deduplication_does_not_hide_invalid_selections(self):
        for notes in (
            [{"id": "unknown-source", "field": "text"}] * 3,
            [
                {"id": "majima-bowling-challenge", "field": "text"},
                {"id": "majima-bowling-challenge", "field": "source_excerpt"},
            ],
            [{"id": "majima-bowling-challenge", "field": "text"}] * 6,
        ):
            with self.subTest(notes=notes):
                self.engine.change = lambda value, notes=notes: value.update(
                    notes=notes
                )
                with self.assertRaises(GemmaFailure):
                    self.builder.build(
                        user_message="근거 질문",
                        current_message_id="current-user",
                        **self.kwargs,
                    )

    def test_large_current_text_fails_but_next_short_turn_recovers(self):
        rare = "".join(chr(0xAC00 + (i * 7919) % 11172) for i in range(300))
        text = (
            "좋습니다. 볼링 하죠. 메모한 글자를 보냅니다. "
            + rare
            + " 확인했습니다." * 150
        )[:1000]

        def budget(messages):
            return 9999 if any(text in m["content"] for m in messages) else 100

        calls = []
        with self.assertRaises(InputBudgetError):
            self.builder.build(
                user_message=text,
                current_message_id="long-user",
                on_episode_decision=calls.append,
                **{**self.kwargs, "count_tokens": budget},
            )
        self.assertEqual(calls[0]["decision"], "accept")
        past = [
            {"id": "long-user", "role": "user", "content": text},
            {
                "id": "long-assistant",
                "role": "assistant",
                "content": "시간은 나중에 정하자.",
            },
        ]
        context = episode(
            phase="accepted", pending_proposal=text, evidence_message_ids=["long-user"]
        )
        original = copy.deepcopy((past, context))
        self.engine.decision = "no_change"
        self.engine.change = lambda value: value.update(
            notes=[{"id": "conversation:long-user", "field": "text"}],
            answer="READER_DRAFT_PRIVATE_DETAIL",
        )
        result = self.builder.build(
            user_message="형님",
            current_message_id="short-user",
            **{
                **self.kwargs,
                "history": past,
                "episode_context": context,
                "count_tokens": budget,
            },
        )
        model_text = json.dumps(result["messages"], ensure_ascii=False)
        self.assertNotIn(text, model_text)
        self.assertNotIn(rare[:20], model_text)
        self.assertNotIn("READER_DRAFT_PRIVATE_DETAIL", model_text)
        self.assertIn('"content_omitted":true', result["messages"][-1]["content"])
        self.assertIn("long-user", model_text)
        self.assertIn("형님", model_text)
        self.assertEqual(
            result["metadata"]["episode_context"]["pending_proposal"], text
        )
        self.assertIn(
            "long-user", result["metadata"]["past_context_omission"]["message_ids"]
        )
        self.assertEqual((past, context), original)
        self.assertEqual(
            reconstruct_input(result["metadata"], past), result["messages"]
        )

    def test_reader_last_resort_drops_whole_past_but_never_current_question(self):
        text = "기존 약속의 긴 상세 자료 " * 30
        context = episode(
            phase="accepted", pending_proposal=text, evidence_message_ids=["long-user"]
        )
        prior = [{"id": "long-user", "role": "user", "content": text}]
        self.engine.decision = "no_change"
        self.engine.count_tokens = lambda messages: (
            5000 if text in messages[-1]["content"] else 100
        )
        reader = EvidenceReader(self.engine)
        kwargs = {
            "character": "majima",
            "candidates": [],
            "relationships": [],
            "recent": prior,
            "memories": [],
            "initial_state": None,
            "notices": [notice()],
            "episode_context": context,
            "current_message_id": "current",
            "episode_evidence": prior,
        }
        _, audit = reader.read(question="형님", **kwargs)
        payload = json.loads(audit["input_messages"][-1]["content"])
        self.assertTrue(
            payload["current_episode"]["pending_proposal"]["content_omitted"]
        )
        self.assertEqual(payload["question"], "형님")
        self.assertEqual(payload["episode_evidence"], [])
        self.assertIn("long-user", audit["past_context_omission"]["message_ids"])
        self.engine.calls.clear()
        with self.assertRaises(GemmaFailure) as caught:
            reader.read(question=text, **kwargs)
        self.assertEqual(caught.exception.code, "context_limit")
        self.assertEqual(self.engine.calls, [])

    def test_followup_omission_keeps_authoritative_call_result(self):
        text = "세부 조건 전체 원문 " * 50
        context = episode(
            phase="accepted",
            pending_proposal=text,
            evidence_message_ids=["long-user"],
            call_outcome="missed",
        )
        result = self.builder.build_followup(
            trigger={"call_id": "call-1", "reason": "missed", "direction": "incoming"},
            **{
                **self.kwargs,
                "episode_context": context,
                "count_tokens": lambda messages: (
                    9999 if text in messages[-1]["content"] else 100
                ),
            },
        )
        envelope = result["messages"][-1]["content"]
        self.assertNotIn(text, envelope)
        self.assertIn('"content_omitted":true', envelope)
        self.assertIn('"reason":"missed"', envelope)
        self.assertIn('"connected":false', envelope)
        self.assertIn("past_context_omission", result["metadata"])
        sources = result["metadata"]["outbound_fact_sources"]
        self.assertTrue(sources["details_omitted"])
        self.assertIsNone(sources["pending_proposal_source"])
        self.assertEqual(sources["state_evidence_sources"], [])
        self.assertTrue(envelope.endswith(OUTBOUND_FACTS_RULES))

    def test_call_outcome_and_notice_trigger_survive_both_model_inputs(self):
        for outcome in ("missed", "declined", "idle", "ended"):
            with self.subTest(outcome=outcome):
                self.engine.calls.clear()
                notices = [notice()]
                if outcome != "ended":
                    notices.append(
                        {
                            **notice(),
                            "id": "followup",
                            "sequence": 5,
                            "request_kind": "call_followup",
                            "call_trigger": {
                                "call_id": "call-1",
                                "reason": outcome,
                                "direction": "incoming",
                            },
                            "call_result": {
                                "connected": "untrusted",
                                "observed": "ignore this",
                            },
                        }
                    )
                result = self.builder.build(
                    user_message="아까 전화는 왜 끊겼죠?",
                    current_message_id="current-user",
                    **{
                        **self.kwargs,
                        "episode_context": episode(call_outcome=outcome),
                        "notices": notices,
                    },
                )
                data = json.loads(self.engine.calls[0][0][-1]["content"])
                self.assertEqual(data["current_episode"]["call_outcome"], outcome)
                writer = result["messages"][-1]["content"]
                self.assertIn(f'"call_outcome":"{outcome}"', writer)
                if outcome != "ended":
                    last = data["recent_timeline"][-1]
                    self.assertEqual(last["call_trigger"]["reason"], outcome)
                    self.assertEqual(
                        last["call_result"]["connected"], outcome == "idle"
                    )
                    self.assertIn(f'"reason":"{outcome}"', writer)
                    self.assertNotIn("untrusted", writer)
        with self.assertRaises(ValueError):
            validate_episode_context(episode(call_outcome="assumed_refusal"), "majima")

    def test_state_references_whole_proposal_and_newest_correction(self):
        text = "원래 약속: " + "설명 " * 300 + " 하지만 저녁 약속은 취소합니다."
        original = episode(
            pending_proposal=text,
            evidence_message_ids=["accepted", "correction"],
            phase="deferred",
            user_reports=[],
        )
        rows = [
            {"id": "accepted", "content": text},
            {"id": "correction", "content": "부상 때문에 일정을 미룹니다."},
        ]
        snapshot = copy.deepcopy(original)
        view = episode_state_view(original, rows)
        self.assertEqual(view["pending_proposal"], {"message_id": "accepted"})
        self.assertEqual(view["latest_evidence_message_id"], "correction")
        self.assertNotIn(text, json.dumps(view, ensure_ascii=False))
        self.assertEqual(original, snapshot)
        cancelled = episode_state_view(
            original,
            rows,
            transition={"decision": "cancel", "evidence_message_id": "current"},
        )
        self.assertEqual(cancelled["phase"], "closed")
        self.assertNotIn("pending_proposal", cancelled)

    def test_budget_trims_optional_notices_not_proposal_or_correction(self):
        text = "저녁 약속은 좋아요. " + "가게 위치는 아직 정하지 않았습니다. " * 35
        past = [
            {"id": "accepted", "role": "user", "content": text, "sequence": 2},
            {"id": "answer", "role": "assistant", "content": "알겠다", "sequence": 3},
            {
                "id": "injury",
                "role": "user",
                "content": "다쳐서 걷기도 힘드니 일단 미룹니다.",
                "sequence": 4,
            },
            {
                "id": "answer-2",
                "role": "assistant",
                "content": "그 사정부터 보자",
                "sequence": 5,
            },
        ] + [
            {
                "id": f"later-{i}-{role}",
                "role": role,
                "content": "다른 일상 이야기",
                "sequence": 6 + 2 * i + j,
            }
            for i in range(8)
            for j, role in enumerate(("user", "assistant"))
        ]
        notices = (
            [notice()]
            + [
                {
                    **notice(),
                    "id": f"optional-{i}",
                    "sequence": 50 + i,
                    "request_kind": "call_followup",
                    "content": "연락 좀 하자",
                }
                for i in range(18)
            ]
            + [
                {
                    **notice(),
                    "id": "latest",
                    "sequence": 80,
                    "request_kind": "call_followup",
                    "call_trigger": {
                        "call_id": "call-1",
                        "reason": "missed",
                        "direction": "incoming",
                    },
                }
            ]
        )
        context = episode(
            phase="deferred",
            pending_proposal=text,
            evidence_message_ids=["accepted", "injury"],
        )
        self.engine.decision = "no_change"

        def budget(messages):
            return (
                9000
                if "optional-" in messages[-1]["content"] or len(messages) > 2
                else 100
            )

        result = self.builder.build(
            user_message="그 사정이 그대로예요",
            current_message_id="current-user",
            **{
                **self.kwargs,
                "history": past,
                "notices": notices,
                "episode_context": context,
                "count_tokens": budget,
            },
        )
        payload = result["messages"][-1]["content"]
        self.assertIn(json.dumps(text, ensure_ascii=False), payload)
        self.assertIn(past[2]["content"], payload)
        self.assertEqual(result["metadata"]["notice_message_ids"], ["invite", "latest"])
        self.assertEqual(
            result["metadata"]["episode_context"]["pending_proposal"], text
        )
        reader = json.loads(self.engine.calls[0][0][-1]["content"])
        self.assertEqual(reader["recent"], [])
        self.assertEqual(
            {r["id"] for r in reader["episode_evidence"]},
            {"conversation:accepted", "conversation:injury"},
        )

    def test_selected_noncore_relation_survives_episode_budget_layout(self):
        self.engine.change = lambda value: value.update(
            notes=[{"id": "saejima-majima", "field": "text"}]
        )
        result = self.builder.build(
            user_message="사에지마와는 무슨 사이죠?",
            current_message_id="current",
            **self.kwargs,
        )
        reader = json.loads(self.engine.calls[0][0][-1]["content"])
        self.assertIn("saejima-majima", {r["id"] for r in reader["canon"]})
        self.assertNotIn(
            "saejima-majima", result["metadata"]["system_relationship_ids"]
        )
        self.assertIn('"id":"saejima-majima"', result["messages"][-1]["content"])

    def test_selected_native_turn_is_not_copied_into_writer_notes(self):
        past = [
            {"id": "u", "role": "user", "content": "다쳐서 미루겠습니다."},
            {"id": "a", "role": "assistant", "content": "그 사정을 먼저 보자."},
        ]
        self.engine.change = lambda value: value.update(
            notes=[{"id": "conversation:u", "field": "text"}]
        )
        self.engine.decision = "no_change"
        result = self.builder.build(
            user_message="핑계가 아닙니다.",
            current_message_id="current",
            **{
                **self.kwargs,
                "history": past,
                "episode_context": episode(
                    phase="deferred", evidence_message_ids=["u"]
                ),
            },
        )
        self.assertEqual(
            sum(m["content"].count(past[0]["content"]) for m in result["messages"]), 1
        )

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

    def test_timeline_note_and_redundant_current_id_no_change_are_accepted(self):
        # Reproduces injury turn-4: recent is intentionally empty because the
        # actual utterance is in recent_timeline; the note ID is valid. The old
        # failure was the no_change/current-ID pair, not missing quote sources.
        prior_id = "ffbdcb3e-2a39-4305-9427-cef952753526-user"
        current = "95b099f5-8ee6-4179-b208-4a229415e136-user"
        text = "일단 며칠 쉬어야 한대요."
        self.engine.decision = "no_change"

        def output(value):
            value.update(
                mode="grounded",
                notes=[{"id": "conversation:" + prior_id, "field": "text"}],
                answer="네, 일단 며칠 쉬어야 한다고 해서 오늘은 별다른 약속은 없습니다.",
            )
            value["episode_transition"]["evidence_message_id"] = current

        self.engine.change = output
        result = self.builder.build(
            user_message="그러니까 오늘 약속은 없는 거죠?",
            current_message_id=current,
            **{
                **self.kwargs,
                "history": [
                    {"id": prior_id, "role": "user", "content": text, "sequence": 2},
                    {
                        "id": "last-assistant",
                        "role": "assistant",
                        "content": "알겠다",
                        "sequence": 3,
                    },
                ],
                "episode_context": episode(phase="deferred", version=5),
            },
        )
        grounding = result["metadata"]["grounding"]
        data = json.loads(grounding["input_messages"][-1]["content"])
        self.assertEqual(data["recent"], [])
        self.assertIn(
            "conversation:" + prior_id, {m["id"] for m in data["recent_timeline"]}
        )
        self.assertEqual(grounding["notes"]["notes"][0]["quote"], text)
        self.assertIsNone(
            result["metadata"]["episode_transition"]["evidence_message_id"]
        )
        self.assertEqual(
            grounding["transition_normalization"]["raw_transition"][
                "evidence_message_id"
            ],
            current,
        )

    def test_no_change_normalization_does_not_accept_foreign_evidence_or_scope(self):
        self.engine.decision = "no_change"
        for changes in (
            {"evidence_message_id": "another-user"},
            {"evidence_message_id": "current-user", "version": 999},
            {"evidence_message_id": "current-user", "extra": "not allowed"},
        ):
            with self.subTest(changes=changes):
                self.engine.change = lambda value, changes=changes: value[
                    "episode_transition"
                ].update(changes)
                with self.assertRaises(GemmaFailure):
                    self.builder.build(
                        user_message="상태는 그대로죠?",
                        current_message_id="current-user",
                        **self.kwargs,
                    )

    def test_mutating_decisions_still_require_exact_current_evidence(self):
        for decision in (
            "accept",
            "defer",
            "decline",
            "cancel",
            "report_outcome",
            "change_topic",
        ):
            self.engine.decision = decision
            for identifier in (None, "stale-user"):
                with self.subTest(decision=decision, evidence=identifier):
                    self.engine.change = lambda value, identifier=identifier: value[
                        "episode_transition"
                    ].update(evidence_message_id=identifier)
                    with self.assertRaises(GemmaFailure):
                        self.builder.build(
                            user_message="현재 문자",
                            current_message_id="current-user",
                            **self.kwargs,
                        )

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

    def test_outbound_fact_contract_is_shared_and_last_for_both_generation_paths(self):
        invitation = self.builder.build_episode(
            **{
                **self.kwargs,
                "episode_context": episode(phase="not_started"),
                "notices": [],
            }
        )
        followup = self.builder.build_followup(
            trigger={"call_id": "call-1", "reason": "missed", "direction": "incoming"},
            **self.kwargs,
        )
        for result in (invitation, followup):
            with self.subTest(kind=result["metadata"]["request_kind"]):
                self.assertTrue(
                    result["messages"][-1]["content"].endswith(OUTBOUND_FACTS_RULES)
                )
                sources = result["metadata"]["outbound_fact_sources"]
                self.assertEqual(sources["version"], OUTBOUND_FACTS_VERSION)
                self.assertEqual(
                    reconstruct_input(result["metadata"], []), result["messages"]
                )
        self.assertEqual(followup["metadata"]["output_budget"], 96)
        self.assertEqual(self.engine.calls, [])

    def test_outbound_proposal_and_user_confirmation_preserve_distinct_sources(self):
        proposal = "11월 6일 저녁에 볼링 치는 건 어떠노?"
        confirmed = "좋습니다. 11월 6일 저녁 7시에 같이 치죠."
        for role, text, phase in (
            ("assistant", proposal, "awaiting_reply"),
            ("user", confirmed, "accepted"),
        ):
            with self.subTest(role=role):
                notices = [{**notice(), "content": proposal}]
                history = (
                    []
                    if role == "assistant"
                    else [
                        {
                            "id": "confirm",
                            "role": "user",
                            "content": text,
                            "sequence": 2,
                        },
                        {
                            "id": "ack",
                            "role": "assistant",
                            "content": "알았다.",
                            "sequence": 3,
                        },
                    ]
                )
                identifier = "invite" if role == "assistant" else "confirm"
                result = self.builder.build_followup(
                    trigger={
                        "call_id": "call-1",
                        "reason": "missed",
                        "direction": "incoming",
                    },
                    **{
                        **self.kwargs,
                        "history": history,
                        "notices": notices,
                        "episode_context": episode(
                            phase=phase,
                            pending_proposal=text,
                            evidence_message_ids=[identifier],
                        ),
                    },
                )
                sources = result["metadata"]["outbound_fact_sources"]
                self.assertEqual(
                    sources["pending_proposal_source"],
                    {"message_id": identifier, "role": role},
                )
                self.assertEqual(
                    sources["state_evidence_sources"],
                    [{"message_id": identifier, "role": role}],
                )
                self.assertTrue(any(text in m["content"] for m in result["messages"]))
                self.assertNotIn("confirmed_date", sources)
                self.assertEqual(
                    reconstruct_input(result["metadata"], history), result["messages"]
                )

    def test_outbound_keeps_latest_correction_and_cancel_with_original_date_evidence(
        self,
    ):
        first = "11월 6일 저녁 7시로 하죠."
        correction = "그 날짜는 취소하고 11월 8일 오후 2시로 바꾸겠습니다."
        history = [
            {"id": "first", "role": "user", "content": first, "sequence": 2},
            {"id": "ack1", "role": "assistant", "content": "알았다.", "sequence": 3},
            {"id": "correct", "role": "user", "content": correction, "sequence": 4},
            {
                "id": "ack2",
                "role": "assistant",
                "content": "바뀐 걸로 기억하마.",
                "sequence": 5,
            },
        ]
        for phase, proposal, close_reason in (
            ("accepted", correction, None),
            ("closed", None, "cancel"),
        ):
            with self.subTest(phase=phase):
                current_history = copy.deepcopy(history)
                if phase == "closed":
                    current_history[-2]["content"] = "바뀐 날짜의 약속도 취소합니다."
                result = self.builder.build_followup(
                    trigger={
                        "call_id": "call-1",
                        "reason": "idle",
                        "direction": "incoming",
                    },
                    **{
                        **self.kwargs,
                        "history": current_history,
                        "episode_context": episode(
                            phase=phase,
                            pending_proposal=proposal,
                            close_reason=close_reason,
                            evidence_message_ids=["first", "correct"],
                        ),
                    },
                )
                sources = result["metadata"]["outbound_fact_sources"]
                self.assertEqual(
                    sources["state_evidence_sources"],
                    [
                        {"message_id": "first", "role": "user"},
                        {"message_id": "correct", "role": "user"},
                    ],
                )
                self.assertIn(first, str(result["messages"]))
                self.assertIn(current_history[-2]["content"], str(result["messages"]))
                self.assertIn(
                    '"latest_evidence_message_id":"correct"',
                    result["messages"][-1]["content"],
                )
                if phase == "closed":
                    self.assertIsNone(sources["pending_proposal_source"])
                    self.assertIn(
                        '"close_reason":"cancel"', result["messages"][-1]["content"]
                    )

    def test_outbound_does_not_guess_proposal_provenance_or_modify_non_episode_inputs(
        self,
    ):
        result = self.builder.build_followup(
            trigger={"call_id": "call-1", "reason": "missed", "direction": "incoming"},
            **self.kwargs,
        )
        self.assertIsNone(
            result["metadata"]["outbound_fact_sources"]["pending_proposal_source"]
        )
        self.assertIn(
            self.kwargs["episode_context"]["pending_proposal"],
            result["messages"][-1]["content"],
        )
        normal = self.builder.build(
            user_message="형님", current_message_id="current", **self.kwargs
        )
        non_episode = self.builder.build_followup(
            trigger={"call_id": "call-1", "reason": "missed", "direction": "incoming"},
            **{**self.kwargs, "episode_context": None},
        )
        for unmodified in (normal, non_episode):
            self.assertNotIn("outbound_fact_sources", unmodified["metadata"])
            self.assertNotIn(OUTBOUND_FACTS_RULES, str(unmodified["messages"]))

    def test_outbound_repeated_same_text_does_not_guess_who_proposed_it(self):
        repeated = "토요일 오후 3시"
        result = self.builder.build_followup(
            trigger={"call_id": "call-1", "reason": "missed", "direction": "incoming"},
            **{
                **self.kwargs,
                "notices": [{**notice(), "content": repeated}],
                "history": [
                    {
                        "id": "repeated-user",
                        "role": "user",
                        "content": repeated,
                        "sequence": 2,
                    },
                    {
                        "id": "answer",
                        "role": "assistant",
                        "content": "그 말인가?",
                        "sequence": 3,
                    },
                ],
                "episode_context": episode(pending_proposal=repeated),
            },
        )
        self.assertIsNone(
            result["metadata"]["outbound_fact_sources"]["pending_proposal_source"]
        )

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
