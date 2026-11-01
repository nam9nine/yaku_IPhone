import copy
import json
import unittest

from kiryu_ai.chat_prompt import ChatPromptBuilder, reconstruct_input
from kiryu_ai.chat_reader import EvidenceReader
from kiryu_ai.chat_retrieval import stable_hash
from kiryu_ai.episode_reader import (
    EXAMPLES,
    INPUT_TOKENS,
    LAYOUT_NOTE,
    OUTPUT_TOKENS,
    EpisodeInterpreter,
    consensus,
    interpretation_schema,
    validate_interpretation,
)
from kiryu_ai.gemma_engine import GemmaFailure


def context(**changes):
    return {
        "episode_id": "majima-bowling-v1",
        "version": 7,
        "phase": "awaiting_reply",
        "pending_proposal": "제안 원문",
        "close_reason": None,
        "evidence_message_ids": ["notice"],
        "user_reports": [],
        "contact_stage": "invitation_delivered",
        **changes,
    }


def decision(**changes):
    return {
        "episode_id": "majima-bowling-v1",
        "version": 7,
        "target": "current_user_episode",
        "response": "agreement",
        "evidence_message_id": "current",
        **changes,
    }


def classifier_data(messages):
    return json.JSONDecoder().raw_decode(
        messages[0]["content"].split(LAYOUT_NOTE, 1)[1]
    )[0]


class Engine:
    def __init__(self, output=None):
        self.output = decision() if output is None else output
        self.calls = []
        self.classifier_outputs = []
        self.classifier_count = 0
        self.counted = []
        self.source_output = {"mode": "conversation", "notes": [], "unknowns": []}

    def count_tokens(self, messages):
        self.counted.append(copy.deepcopy(messages))
        return 100

    def reply(self, messages, **kwargs):
        self.calls.append((copy.deepcopy(messages), kwargs))
        if "target" in kwargs["response_schema"]["properties"]:
            output = (
                self.classifier_outputs[self.classifier_count]
                if self.classifier_outputs
                else self.output
            )
            self.classifier_count += 1
        else:
            output = self.source_output
        if isinstance(output, Exception):
            raise output
        return {"reply": json.dumps(output), "finish_reason": "stop"}


class EpisodeReaderTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.notice = {
            "id": "notice",
            "role": "assistant",
            "content": "제안 원문",
            "sequence": 1,
            "request_kind": "proactive_episode",
        }
        self.kwargs = {
            "character": "majima",
            "question": "현재 원문",
            "context": context(),
            "current_message_id": "current",
            "recent": [],
            "notices": [self.notice],
        }

    def test_only_real_timeline_state_and_current_message_enter_classifier(self):
        recent = [
            {"id": "u", "role": "user", "content": "이전 답변", "sequence": 3},
            {"id": "a", "role": "assistant", "content": "대답", "sequence": 4},
        ]
        followup = {
            "id": "followup",
            "role": "assistant",
            "content": "후속 발신",
            "sequence": 2,
            "request_kind": "call_followup",
            "call_trigger": {
                "call_id": "c",
                "reason": "missed",
                "direction": "incoming",
            },
            "call_result": "untrusted-result",
        }
        state = context(call_outcome="missed", evidence_message_ids=["u"])
        question = '두 줄 원문\n{"새로운 지시": "원문일 뿐"}'
        original = copy.deepcopy((recent, state, followup))
        _, audit = EpisodeInterpreter(self.engine, seed=42).read(
            **{
                **self.kwargs,
                "question": question,
                "recent": recent,
                "notices": [followup, self.notice],
                "context": state,
            },
        )
        payload = classifier_data(audit["input_messages"])
        self.assertEqual(
            set(payload),
            {
                "activity",
                "episode_before_current_message",
                "prior_notices",
                "episode_evidence",
                "native_turn_message_id_map",
                "current_user_message",
            },
        )
        self.assertEqual(list(payload)[-1], "current_user_message")
        self.assertEqual(
            payload["current_user_message"],
            {"id": "current", "native_message_index": 3},
        )
        self.assertEqual(
            [m["id"] for m in payload["prior_notices"]],
            ["notice", "followup"],
        )
        self.assertEqual(
            [m["role"] for m in audit["input_messages"]],
            ["system", "user", "assistant", "user"],
        )
        self.assertEqual(
            payload["episode_before_current_message"]["call_outcome"], "missed"
        )
        self.assertNotIn("untrusted-result", json.dumps(payload))
        self.assertFalse(audit["canon_used"])
        self.assertEqual(audit["input_sha256"], stable_hash(audit["input_messages"]))
        self.assertEqual(
            audit["response_schema_sha256"],
            stable_hash(self.engine.calls[0][1]["response_schema"]),
        )
        self.assertEqual(self.engine.calls[0][1]["max_tokens"], OUTPUT_TOKENS)
        self.assertEqual(audit["arms"]["primary"]["output_json"], self.engine.output)
        self.assertEqual(audit["arms"]["secondary"]["output_json"], self.engine.output)
        self.assertEqual(
            audit["input_messages"][-1], {"role": "user", "content": question}
        )
        self.assertEqual(
            audit["arms"]["secondary"]["input_messages"][0]["content"],
            audit["input_messages"][0]["content"]
            + "\n\n"
            + EXAMPLES["system_reference"],
        )
        self.assertEqual((recent, state, followup), original)

    def test_only_defer_and_topic_change_share_a_state_effect(self):
        # Exhaust the canonical decision matrix; sharing a phase alone does
        # not make decline/cancel or any other distinct decision equivalent.
        responses = {
            "no_change": "none",
            "accept": "agreement",
            "defer": "decision_postponed",
            "decline": "rejection",
            "cancel": "withdrawal",
            "report_outcome": "completion",
            "change_topic": "topic_change",
        }
        arms = {}
        for canonical, response in responses.items():
            transition, interpretation = validate_interpretation(
                decision(
                    response=response,
                    target="other"
                    if canonical == "change_topic"
                    else "current_user_episode",
                ),
                context(),
                "current",
            )
            arms[canonical] = {
                "canonical_transition": transition,
                "interpretation": interpretation,
            }
        for left, left_arm in arms.items():
            for right, right_arm in arms.items():
                with self.subTest(left=left, right=right):
                    transition, audit = consensus(
                        left_arm, right_arm, context(), "current"
                    )
                    equivalent = {left, right} == {"defer", "change_topic"}
                    if left == right:
                        self.assertEqual(transition["decision"], left)
                        self.assertEqual(
                            audit["reason"], "canonical_decision_agreement"
                        )
                    elif equivalent:
                        self.assertEqual(transition["decision"], "defer")
                        self.assertEqual(audit["reason"], "state_effect_agreement")
                        self.assertEqual(audit["status"], "agreed")
                        self.assertIsNone(audit["reader_act"])
                        self.assertTrue(audit["mutation_eligible"])
                    else:
                        self.assertEqual(transition["decision"], "no_change")
                        self.assertEqual(audit["status"], "abstained")
                        self.assertFalse(audit["mutation_eligible"])
        self.assertEqual(
            arms["change_topic"]["canonical_transition"]["decision"], "change_topic"
        )

    def test_state_effect_equivalence_never_relaxes_scope_or_current_evidence(self):
        def arm(response, target="current_user_episode"):
            transition, interpretation = validate_interpretation(
                decision(response=response, target=target), context(), "current"
            )
            return {
                "canonical_transition": transition,
                "interpretation": interpretation,
            }

        left, right = arm("decision_postponed"), arm("topic_change", "other")
        for side in (0, 1):
            for changes in (
                {"version": 6},
                {"version": True},
                {"episode_id": "foreign"},
                {"evidence_message_id": "foreign"},
                {"evidence_message_id": None},
                {"extra": "not-allowed"},
            ):
                with self.subTest(side=side, changes=changes):
                    pair = copy.deepcopy([left, right])
                    pair[side]["canonical_transition"].update(changes)
                    with self.assertRaises(ValueError):
                        consensus(*pair, context(), "current")

    def test_target_guard_and_topic_change_have_distinct_semantics(self):
        # These validate typed output mapping, not a model's understanding of text.
        for target in ("other", "unclear"):
            for response in (
                "agreement",
                "rejection",
                "withdrawal",
                "completion",
                "temporary_unavailability",
                "terms_change",
            ):
                with self.subTest(target=target, response=response):
                    value, audit = validate_interpretation(
                        decision(target=target, response=response), context(), "current"
                    )
                    self.assertEqual(value["decision"], "no_change")
                    self.assertIsNone(value["evidence_message_id"])
                    self.assertEqual(audit["raw_transition"]["response"], response)
                    self.assertIn("target_guard", audit)
        for target, expected in (("other", "change_topic"), ("unclear", "no_change")):
            value, _ = validate_interpretation(
                decision(target=target, response="topic_change"), context(), "current"
            )
            self.assertEqual(value["decision"], expected)

    def test_typed_response_mapping_does_not_conflate_constraint_intent_or_progress(
        self,
    ):
        expected = {
            "agreement": "accept",
            "temporary_unavailability": "defer",
            "decision_postponed": "defer",
            "rejection": "decline",
            "withdrawal": "cancel",
            "discussion": "no_change",
            "terms_change": "accept",
            "progress": "no_change",
            "completion": "report_outcome",
            "none": "no_change",
        }
        for response, canonical in expected.items():
            with self.subTest(response=response):
                value, _ = validate_interpretation(
                    decision(response=response), context(), "current"
                )
                self.assertEqual(value["decision"], canonical)

    def test_normalization_never_accepts_foreign_scope_or_unknown_fields(self):
        schema = interpretation_schema(context(), "current")
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(
            schema["properties"]["evidence_message_id"]["enum"], ["current", None]
        )
        for change in (
            {"version": True},
            {"version": 6},
            {"episode_id": "other"},
            {"evidence_message_id": "previous"},
            {"response": "accept"},
            {"target": "guessed"},
            {"extra": "unsupported"},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_interpretation(
                    decision(**{"target": "unclear", **change}),
                    context(),
                    "current",
                )
        with self.assertRaises(ValueError):
            validate_interpretation(
                decision(evidence_message_id=None), context(), "current"
            )

    def test_whole_past_omission_cannot_retain_a_promise_without_its_correction(self):
        history = [
            {"id": "old", "role": "user", "content": "원래 약속 전체", "sequence": 2},
            {"id": "a", "role": "assistant", "content": "응답", "sequence": 3},
            {
                "id": "correction",
                "role": "user",
                "content": "수정된 약속 전체",
                "sequence": 4,
            },
            {"id": "b", "role": "assistant", "content": "응답2", "sequence": 5},
        ]
        self.engine.count_tokens = lambda messages: (
            INPUT_TOKENS + 1
            if "수정된 약속 전체" in json.dumps(messages, ensure_ascii=False)
            else 100
        )
        _, audit = EpisodeInterpreter(self.engine).read(
            **{
                **self.kwargs,
                "recent": history,
                "context": context(
                    pending_proposal=history[0]["content"],
                    evidence_message_ids=["old", "correction"],
                ),
            }
        )
        payload = classifier_data(audit["input_messages"])
        self.assertEqual(payload["prior_notices"], [])
        self.assertEqual(len(audit["input_messages"]), 2)
        self.assertEqual(payload["episode_evidence"], [])
        self.assertNotIn(history[0]["content"], audit["input_messages"][-1]["content"])
        self.assertTrue(
            payload["episode_before_current_message"]["pending_proposal"][
                "content_omitted"
            ]
        )
        self.assertEqual(
            audit["input_messages"][-1]["content"], self.kwargs["question"]
        )
        self.assertIn("correction", audit["past_context_omission"]["message_ids"])

    def test_large_current_message_fails_then_short_request_recovers(self):
        long = "LONG_CURRENT" * 200
        self.engine.count_tokens = lambda messages: (
            INPUT_TOKENS + 1 if long in messages[-1]["content"] else 100
        )
        interpreter = EpisodeInterpreter(self.engine)
        with self.assertRaises(GemmaFailure) as caught:
            interpreter.read(**{**self.kwargs, "question": long})
        self.assertEqual(caught.exception.code, "context_limit")
        self.assertEqual(self.engine.calls, [])
        interpreter.read(**self.kwargs)
        self.assertEqual(len(self.engine.calls), 2)

    def test_invalid_native_count_is_not_treated_as_a_budget_pass(self):
        for count in (-1, True, 0.5, None):
            with self.subTest(count=count):
                self.engine.count_tokens = lambda _, count=count: count
                with self.assertRaises(GemmaFailure):
                    EpisodeInterpreter(self.engine).read(**self.kwargs)
        self.assertEqual(self.engine.calls, [])

    def test_same_engine_runs_classifier_then_source_reader_with_separate_audits(self):
        stages = []
        notes, audit = EvidenceReader(self.engine, seed=42).read(
            character="majima",
            question="현재 원문",
            candidates=[],
            relationships=[],
            recent=[],
            memories=[],
            initial_state=None,
            notices=[self.notice],
            episode_context=context(),
            current_message_id="current",
            on_stage=stages.append,
        )
        self.assertEqual(len(self.engine.calls), 3)
        classifier_payload = classifier_data(self.engine.calls[0][0])
        source_payload = json.loads(self.engine.calls[2][0][-1]["content"])
        self.assertIn("prior_notices", classifier_payload)
        self.assertNotIn("canon", classifier_payload)
        self.assertIn("canon", source_payload)
        self.assertNotIn(
            "episode_transition",
            self.engine.calls[2][1]["response_schema"]["properties"],
        )
        self.assertNotIn(
            "answer", self.engine.calls[2][1]["response_schema"]["properties"]
        )
        self.assertEqual(notes["episode_transition"]["decision"], "accept")
        self.assertNotEqual(
            audit["input_sha256"], audit["episode_classifier"]["input_sha256"]
        )
        self.assertEqual(
            [s["stage"] for s in stages],
            [
                "episode_preparing",
                "episode_interpreting",
                "episode_arm_complete",
                "episode_interpreting",
                "episode_arm_complete",
                "episode_complete",
                "reader_preparing",
                "reader_generating",
                "reader_complete",
            ],
        )

    def test_supersession_callback_propagates_without_further_model_work(self):
        class Superseded(Exception):
            pass

        for stop_stage, expected_calls in (
            ("episode_preparing", 0),
            ("episode_arm_complete", 1),
            ("episode_complete", 2),
            ("reader_preparing", 2),
        ):
            with self.subTest(stage=stop_stage):
                self.engine.calls.clear()
                stages = []

                def stop(audit, stages=stages, stop_stage=stop_stage):
                    stages.append(audit["stage"])
                    if audit["stage"] == stop_stage:
                        raise Superseded

                with self.assertRaises(Superseded):
                    EvidenceReader(self.engine).read(
                        character="majima",
                        question="현재 원문",
                        candidates=[],
                        relationships=[],
                        recent=[],
                        memories=[],
                        initial_state=None,
                        notices=[self.notice],
                        episode_context=context(),
                        current_message_id="current",
                        on_stage=stop,
                    )
                self.assertEqual(len(self.engine.calls), expected_calls)
                self.assertEqual(stages[-1], stop_stage)

    def test_failed_source_cannot_commit_classifier_transition(self):
        self.engine.source_output["episode_transition"] = {"decision": "accept"}
        callbacks = []
        with self.assertRaises(GemmaFailure) as caught:
            ChatPromptBuilder(reader=EvidenceReader(self.engine)).build(
                visitor_id="v",
                character_id="majima",
                scenario_version="daily-if-v1",
                history=[],
                user_message="원문",
                current_message_id="current",
                episode_context=context(),
                notices=[self.notice],
                count_tokens=lambda _: 100,
                context_limit=6144,
                max_tokens=3072,
                on_episode_decision=callbacks.append,
            )
        self.assertEqual(caught.exception.code, "grounding_invalid")
        self.assertEqual(callbacks, [])
        self.assertEqual(
            caught.exception.result["grounding"]["episode_classifier"]["stage"],
            "episode_complete",
        )

    def test_conflicting_decisions_abstain_without_changing_state_or_writer_intent(
        self,
    ):
        self.engine.classifier_outputs = [
            decision(response="rejection"),
            decision(response="temporary_unavailability"),
        ]
        callbacks = []
        result = ChatPromptBuilder(reader=EvidenceReader(self.engine)).build(
            visitor_id="v",
            character_id="majima",
            scenario_version="daily-if-v1",
            history=[],
            user_message="원문",
            current_message_id="current",
            episode_context=context(phase="deferred"),
            notices=[self.notice],
            count_tokens=lambda _: 100,
            context_limit=6144,
            max_tokens=3072,
            on_episode_decision=callbacks.append,
        )
        self.assertEqual(callbacks, [])
        audit = result["metadata"]["grounding"]
        interpretation = audit["episode_interpretation"]
        self.assertEqual(interpretation["status"], "abstained")
        self.assertIsNone(interpretation["reader_act"])
        self.assertEqual(
            interpretation["validated_transition"]["decision"], "no_change"
        )
        self.assertEqual(
            result["metadata"]["episode_turn_task"]["policy_id"],
            "clarify_unresolved_participation",
        )
        self.assertIn('"status":"abstained"', result["messages"][0]["content"])
        self.assertIn(
            '"current_episode_speech_act":null', result["messages"][0]["content"]
        )
        for arm, expected in (("primary", "decline"), ("secondary", "defer")):
            self.assertEqual(
                audit["episode_classifier"]["arms"][arm]["canonical_transition"][
                    "decision"
                ],
                expected,
            )

    def test_same_canonical_with_different_acts_has_no_primary_act_fallback(self):
        self.engine.classifier_outputs = [
            decision(response="discussion"),
            decision(response="progress"),
        ]
        value, audit = EpisodeInterpreter(self.engine).read(**self.kwargs)
        self.assertEqual(value["decision"], "no_change")
        self.assertEqual(audit["interpretation"]["status"], "agreed")
        self.assertFalse(audit["interpretation"]["reader_act_agreement"])
        self.assertIsNone(audit["interpretation"]["reader_act"])

    def test_one_invalid_arm_records_both_and_cannot_commit(self):
        for bad in (
            decision(version=99),
            GemmaFailure("truncated", {"reply": "partial"}),
        ):
            with self.subTest(bad=bad):
                engine = Engine()
                engine.classifier_outputs = [bad, decision()]
                callbacks = []
                with self.assertRaises(GemmaFailure) as caught:
                    ChatPromptBuilder(reader=EvidenceReader(engine)).build(
                        visitor_id="v",
                        character_id="majima",
                        scenario_version="daily-if-v1",
                        history=[],
                        user_message="원문",
                        current_message_id="current",
                        episode_context=context(),
                        notices=[self.notice],
                        count_tokens=lambda _: 100,
                        context_limit=6144,
                        max_tokens=3072,
                        on_episode_decision=callbacks.append,
                    )
                self.assertEqual(callbacks, [])
                self.assertEqual(len(engine.calls), 2)
                audit = caught.exception.result["grounding"]["episode_classifier"]
                self.assertEqual(audit["arms"]["primary"]["stage"], "failed")
                self.assertEqual(audit["arms"]["secondary"]["stage"], "complete")
                self.assertEqual(audit["interpretation"]["status"], "failed")

    def test_control_failure_stops_before_secondary(self):
        for code in ("episode_superseded", "interrupted"):
            with self.subTest(code=code):
                engine = Engine()
                engine.classifier_outputs = [GemmaFailure(code), decision()]
                with self.assertRaises(GemmaFailure) as caught:
                    EpisodeInterpreter(engine).read(**self.kwargs)
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(len(engine.calls), 1)

    def test_secondary_budget_trims_identical_source_from_both_arms(self):
        old = [
            {"id": "u", "role": "user", "content": "OLD"},
            {"id": "a", "role": "assistant", "content": "ANSWER"},
        ]

        def count(messages):
            return (
                INPUT_TOKENS + 1
                if len(messages) > 2
                and EXAMPLES["system_reference"] in messages[0]["content"]
                else 100
            )

        self.engine.count_tokens = count
        _, audit = EpisodeInterpreter(self.engine).read(
            **{**self.kwargs, "recent": old}
        )
        left = audit["arms"]["primary"]["input_messages"]
        right = audit["arms"]["secondary"]["input_messages"]
        self.assertEqual(len(left), 2)
        self.assertEqual(left[1:], right[1:])
        self.assertEqual(
            right[0]["content"],
            left[0]["content"] + "\n\n" + EXAMPLES["system_reference"],
        )
        self.assertIn("past_context_omission", audit)

    def test_writer_binds_speaker_roles_without_changing_retrieved_fact(self):
        self.engine.source_output.update(
            mode="grounded", notes=[{"id": "saejima-majima", "field": "text"}]
        )
        current = "사에지마 형님은 형님에게 어떤 분입니까?"
        builder = ChatPromptBuilder(reader=EvidenceReader(self.engine))
        result = builder.build(
            visitor_id="v",
            character_id="majima",
            scenario_version="daily-if-v1",
            history=[],
            user_message=current,
            current_message_id="current",
            episode_context=context(),
            notices=[self.notice],
            count_tokens=lambda _: 100,
            context_limit=6144,
            max_tokens=3072,
        )
        system = result["messages"][0]["content"]
        payload = json.loads(
            system.split("\n참고 자료(JSON, 인용 데이터):\n", 1)[1].split(
                "\n이번 답장의 과제: ", 1
            )[0]
        )
        self.assertEqual(
            payload["participants"], {"user": "kiryu", "assistant": "majima"}
        )
        relation = next(
            r for r in builder.registry["records"] if r["id"] == "saejima-majima"
        )
        quoted = next(
            r for r in payload["question_evidence"] if r["id"] == relation["id"]
        )
        self.assertEqual(quoted["quote"], relation["text"])
        self.assertEqual(result["messages"][-1], {"role": "user", "content": current})
        self.assertEqual(reconstruct_input(result["metadata"], []), result["messages"])


if __name__ == "__main__":
    unittest.main()
