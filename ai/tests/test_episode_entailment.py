import copy
import json
import unittest

from episode_verifier_fixture import VerifierEngine
from kiryu_ai.chat_prompt import ChatPromptBuilder
from kiryu_ai.chat_reader import EvidenceReader
from kiryu_ai.chat_retrieval import stable_hash
from kiryu_ai.episode_entailment import (
    CLAIM_HEADER,
    EpisodeEntailment,
    compose,
    validate_verdict,
)
from kiryu_ai.episode_reader import LAYOUT_NOTE, EpisodeInterpreter
from kiryu_ai.gemma_engine import GemmaEngine, GemmaFailure
from test_episode_reader import Engine, context, decision


class EpisodeEntailmentTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.verifier_engine = VerifierEngine()
        self.verifier = EpisodeEntailment(self.verifier_engine)
        self.arguments = {
            "character": "majima",
            "question": "현재 사용자의 실제 문자",
            "context": context(),
            "current_message_id": "current",
            "recent": [],
            "notices": [
                {
                    "id": "notice",
                    "role": "assistant",
                    "content": "제안 원문",
                    "sequence": 1,
                }
            ],
        }

    def classified(self):
        return EpisodeInterpreter(self.engine, seed=42).read(**self.arguments)

    def verified(self, proposed, audit, **kwargs):
        return self.verifier.verify(
            classifier_audit=audit,
            proposed=proposed,
            episode=self.arguments["context"],
            current_id="current",
            question=self.arguments["question"],
            **kwargs,
        )

    def build(self, callbacks, stages=None):
        return ChatPromptBuilder(
            reader=EvidenceReader(self.engine, episode_verifier=self.verifier)
        ).build(
            visitor_id="isolated-test-visitor",
            character_id="majima",
            scenario_version="daily-if-v1",
            user_message=self.arguments["question"],
            current_message_id="current",
            history=self.arguments["recent"],
            notices=self.arguments["notices"],
            episode_context=self.arguments["context"],
            count_tokens=lambda _: 100,
            on_episode_decision=callbacks.append,
            on_stage=stages.append if stages is not None else None,
        )

    def test_supported_preserves_exact_transition_and_raw_consensus(self):
        proposed, before = self.classified()
        original = copy.deepcopy(before)
        result, interpretation, audit = self.verified(proposed, before)
        self.assertEqual((result, interpretation), (proposed, before["interpretation"]))
        self.assertEqual(before, original)
        self.assertEqual(
            audit["generation"], {"seed": 42, "max_tokens": 2048, "temperature": 0}
        )
        self.assertEqual(audit["input_sha256"], stable_hash(audit["input_messages"]))
        self.assertEqual(audit["status"], "supported")
        self.assertFalse(audit["meaning_correctness_established"])

    def test_non_support_holds_pending_without_applying_no_change(self):
        for verdict in ("contradicted", "insufficient"):
            with self.subTest(verdict=verdict):
                self.engine = Engine()
                self.verifier_engine.verdict = verdict
                callbacks = []
                output = self.build(callbacks)
                grounding = output["metadata"]["grounding"]
                original = grounding["episode_classifier"]["pre_veto_interpretation"]
                final = grounding["episode_interpretation"]
                self.assertEqual(original["status"], "agreed")
                self.assertEqual(original["validated_transition"]["decision"], "accept")
                self.assertEqual(
                    final, grounding["episode_classifier"]["interpretation"]
                )
                self.assertEqual(final["status"], "abstained")
                self.assertEqual(final["validated_transition"]["decision"], "no_change")
                self.assertIsNone(final["validated_transition"]["evidence_message_id"])
                self.assertIsNone(final["reader_act"])
                self.assertEqual(callbacks, [])
                self.assertEqual(
                    len(self.engine.calls), 3
                )  # Two classifiers + normal RAG reader.

    def test_original_no_change_or_abstention_is_never_promoted(self):
        for responses in (("none", "none"), ("agreement", "rejection")):
            with self.subTest(responses=responses):
                self.engine = Engine()
                self.engine.classifier_outputs = [
                    decision(response=response) for response in responses
                ]
                proposed, before = self.classified()
                result, interpretation, audit = self.verified(proposed, before)
                self.assertEqual(result, proposed)
                self.assertEqual(interpretation, before["interpretation"])
                self.assertEqual(audit["status"], "skipped")
                self.assertEqual(self.verifier_engine.calls, [])
                self.assertEqual(self.verifier_engine.counted, [])
                with self.assertRaises(ValueError):
                    compose(
                        proposed,
                        interpretation,
                        {"verdict": "supported"},
                        self.arguments["context"],
                        "current",
                    )

    def test_compatible_raw_acts_use_explicit_or_and_keep_reader_act_none(self):
        self.engine.classifier_outputs = [
            decision(target="other", response="topic_change"),
            decision(response="decision_postponed"),
        ]
        proposed, before = self.classified()
        result, interpretation, audit = self.verified(proposed, before)
        self.assertEqual(result["decision"], "defer")
        self.assertIsNone(interpretation["reader_act"])
        request = audit["request"]
        self.assertEqual(request["claim_operator"], "inclusive_or")
        self.assertFalse(request["both_clauses_verified"])
        self.assertEqual(
            [row["response"] for row in request["clauses"]],
            ["topic_change", "decision_postponed"],
        )
        self.assertIn("논리적 OR", request["claim_text"])

    def test_same_raw_claim_deduplicates_without_changing_native_turns(self):
        self.arguments["recent"] = [
            {"id": "prior-u", "role": "user", "content": "이전 문자", "sequence": 2},
            {
                "id": "prior-a",
                "role": "assistant",
                "content": "이전 답장",
                "sequence": 3,
            },
        ]
        proposed, before = self.classified()
        _, _, audit = self.verified(proposed, before)
        request = audit["request"]
        self.assertEqual(len(request["clauses"]), 1)
        self.assertEqual(
            request["clauses"][0]["contributing_arms"], ["primary", "secondary"]
        )
        self.assertEqual(
            request["messages"][1:], before["arms"]["primary"]["input_messages"][1:]
        )
        quoted = json.loads(
            request["messages"][0]["content"]
            .split(LAYOUT_NOTE, 1)[1]
            .split(CLAIM_HEADER, 1)[0]
        )
        self.assertEqual(
            quoted["current_user_message"], {"id": "current", "native_message_index": 3}
        )
        self.assertEqual(
            set(request["scope"]["source_message_ids"]),
            {"notice", "prior-u", "prior-a", "current"},
        )
        self.assertEqual(request["additional_omissions"], [])

    def test_last_resort_omission_does_not_restore_old_sources(self):
        old = "LONG_PRIVATE_PROMISE"
        self.arguments["recent"] = [
            {"id": "old-u", "role": "user", "content": old},
            {"id": "old-a", "role": "assistant", "content": "old-answer"},
        ]
        self.engine.count_tokens = lambda messages: (
            10000 if old in json.dumps(messages) else 100
        )
        proposed, before = self.classified()
        _, _, audit = self.verified(proposed, before)
        self.assertTrue(before["past_context_omission"])
        self.assertNotIn(old, json.dumps(audit["input_messages"]))
        self.assertEqual(
            audit["request"]["classifier_context_omission"],
            before["past_context_omission"],
        )
        self.assertEqual(audit["request"]["additional_omissions"], [])

    def test_changed_original_scope_or_current_id_fails_before_inference(self):
        proposed, before = self.classified()
        for mutate in (
            lambda audit: audit["arms"]["primary"]["output_json"].update(
                evidence_message_id="another-user"
            ),
            lambda audit: audit["arms"]["primary"]["input_messages"][-1].update(
                content="another user text"
            ),
            lambda audit: audit["interpretation"].update(status="abstained"),
        ):
            with self.subTest(mutate=mutate):
                changed = copy.deepcopy(before)
                mutate(changed)
                with self.assertRaises(GemmaFailure) as caught:
                    self.verified(proposed, changed)
                self.assertEqual(caught.exception.code, "grounding_invalid")
                self.assertEqual(self.verifier_engine.calls, [])

    def test_invalid_quote_or_schema_is_failure_not_semantic_veto(self):
        invalid = (
            {"verdict": "supported", "evidence_quote": None},
            {"verdict": "supported", "evidence_quote": "unrelated"},
            {"verdict": "insufficient", "evidence_quote": "unrelated"},
            {"verdict": "supported", "evidence_quote": "현재", "decision": "accept"},
            {"verdict": "accept", "evidence_quote": "현재"},
        )
        for output in invalid:
            with self.subTest(output=output):
                self.engine = Engine()
                self.verifier_engine.result = {
                    "reply": json.dumps(output),
                    "finish_reason": "stop",
                }
                callbacks = []
                with self.assertRaises(GemmaFailure) as caught:
                    self.build(callbacks)
                self.assertEqual(caught.exception.code, "grounding_invalid")
                audit = caught.exception.result["grounding"]
                self.assertEqual(audit["episode_entailment"]["status"], "failed")
                self.assertEqual(audit["episode_interpretation"]["status"], "failed")
                self.assertEqual(callbacks, [])
                self.assertEqual(len(self.engine.calls), 2)

    def test_engine_failure_and_truncation_propagate_without_source_or_writer(self):
        for code in (
            "generation_timeout",
            "response_truncated",
            "interrupted",
            "episode_superseded",
        ):
            with self.subTest(code=code):
                self.engine = Engine()
                self.verifier_engine.result = GemmaFailure(
                    code, {"reply": "partial-private-json"}
                )
                callbacks = []
                with self.assertRaises(GemmaFailure) as caught:
                    self.build(callbacks)
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(callbacks, [])
                self.assertEqual(len(self.engine.calls), 2)
                self.assertEqual(
                    caught.exception.result["grounding"]["episode_entailment"][
                        "model_result"
                    ]["reply"],
                    "partial-private-json",
                )

    def test_oversize_verifier_input_fails_without_eviction(self):
        self.verifier_engine.count = 3073
        proposed, before = self.classified()
        with self.assertRaises(GemmaFailure) as caught:
            self.verified(proposed, before)
        self.assertEqual(caught.exception.code, "context_limit")
        self.assertEqual(self.verifier_engine.calls, [])
        self.assertEqual(
            caught.exception.result["episode_entailment"]["request"][
                "additional_omissions"
            ],
            [],
        )

    def test_stage_cancellation_stops_before_next_model_or_state_work(self):
        class Stale(Exception):
            pass

        for stage, calls in (
            ("episode_verifier_preparing", 0),
            ("episode_verifier_generating", 0),
            ("episode_verifier_returned", 1),
            ("episode_verifier_complete", 1),
        ):
            with self.subTest(stage=stage):
                self.engine = Engine()
                self.verifier_engine.calls.clear()
                proposed, before = self.classified()

                def stop(audit, expected=stage):
                    if audit["stage"] == expected:
                        raise Stale

                with self.assertRaises(Stale):
                    self.verified(proposed, before, on_stage=stop)
                self.assertEqual(len(self.verifier_engine.calls), calls)

    def test_missing_or_wrong_verifier_profile_cannot_silently_commit(self):
        proposed, before = self.classified()
        for thinking, budget in ((False, 1024), (True, -1), (True, 512)):
            with self.subTest(thinking=thinking, budget=budget):
                self.verifier_engine.thinking = thinking
                self.verifier_engine.reasoning_tokens = budget
                with self.assertRaises(GemmaFailure) as caught:
                    self.verified(proposed, before)
                self.assertEqual(caught.exception.code, "grounding_invalid")
        with self.assertRaises(GemmaFailure):
            EvidenceReader(self.engine).read(
                character="majima",
                question=self.arguments["question"],
                candidates=[],
                relationships=[],
                recent=[],
                memories=[],
                initial_state=None,
                episode_context=context(),
                current_message_id="current",
                notices=self.arguments["notices"],
            )

    def test_verdict_validator_does_not_infer_meaning_from_an_exact_quote(self):
        # Schema/provenance validation is not a semantic correctness test.
        value = {"verdict": "supported", "evidence_quote": "현재"}
        self.assertEqual(validate_verdict(value, self.arguments["question"]), value)

    def test_profile_clone_preserves_runtime_identity_and_does_not_mutate_reader(self):
        reader = GemmaEngine(api_key="private-test-key-not-real-" * 2, thinking=False)
        reader.manifest = {"model_file": "test-pinned", "sha256": "test-only"}
        separate = reader.with_generation_profile(
            thinking=True, reasoning_tokens=1024, context_tokens=6144, timeout=120
        )
        self.assertEqual(
            (separate.host, separate.port, separate.api_key),
            (reader.host, reader.port, reader.api_key),
        )
        self.assertEqual(separate.manifest, reader.manifest)
        self.assertIsNot(separate.manifest, reader.manifest)
        self.assertFalse(reader.thinking)
        self.assertEqual(reader.reasoning_tokens, 0)
        self.assertTrue(separate.thinking)
        self.assertEqual(separate.reasoning_tokens, 1024)
        self.assertIsNot(reader._lock, separate._lock)
        configured = EvidenceReader(reader)
        self.assertEqual(configured.episode_verifier.engine.reasoning_tokens, 1024)
        self.assertEqual(configured.episode_verifier.seed, 42)
