import json
import unittest

from episode_verifier_fixture import VerifierEngine
from kiryu_ai.chat_prompt import ChatPromptBuilder
from kiryu_ai.chat_reader import EvidenceReader
from kiryu_ai.episode_entailment import EpisodeDeliberation, EpisodeEntailment
from kiryu_ai.episode_reader import EpisodeInterpreter
from kiryu_ai.gemma_engine import GemmaFailure
from test_episode_reader import Engine, context, decision


class ScriptedBounded(VerifierEngine):
    def __init__(self, verdicts, responses=()):
        super().__init__()
        self.verdicts = list(verdicts)
        self.classifier_outputs = [
            decision(response=value) if isinstance(value, str) else value
            for value in responses
        ]

    def reply(self, messages, **kwargs):
        if "target" not in kwargs["response_schema"]["properties"]:
            verdict = self.verdicts.pop(0)
            self.result = (
                verdict
                if isinstance(verdict, Exception)
                else {
                    "reply": json.dumps(
                        {"verdict": verdict, "evidence_quote": messages[-1]["content"]}
                    ),
                    "finish_reason": "stop",
                }
            )
        return super().reply(messages, **kwargs)


class SelectiveDeliberationTests(unittest.TestCase):
    def setUp(self):
        self.base_engine = Engine()
        self.args = {
            "character": "majima",
            "question": "검사용 실제 현재 문자",
            "context": context(),
            "current_message_id": "current",
            "recent": [],
            "notices": [{"id": "notice", "role": "assistant", "content": "제안 원문"}],
        }

    def run_policy(self, engine, *, stages=None):
        proposed, audit = EpisodeInterpreter(self.base_engine, seed=42).read(
            **self.args
        )
        result = EpisodeDeliberation(EpisodeEntailment(engine)).decide(
            classifier_audit=audit,
            proposed=proposed,
            episode=self.args["context"],
            current_id="current",
            question=self.args["question"],
            on_stage=stages,
        )
        return result

    def test_base_abstention_no_change_and_supported_skip_extra_work(self):
        for responses, verdicts, expected_calls, path in [
            (("agreement", "rejection"), [], 0, "base_skipped"),
            (("none", "none"), [], 0, "base_skipped"),
            (("agreement", "agreement"), ["supported"], 1, "base_supported"),
        ]:
            with self.subTest(path=path, responses=responses):
                self.base_engine = Engine()
                self.base_engine.classifier_outputs = [
                    decision(response=response) for response in responses
                ]
                engine = ScriptedBounded(verdicts)
                _, _, audit = self.run_policy(engine)
                self.assertEqual(audit["path"], path)
                self.assertEqual(audit["extra_passes"], 0)
                self.assertEqual(len(engine.calls), expected_calls)
                self.assertNotIn("reclassification", audit)

    def test_verified_reclassification_can_replace_proposal_but_keeps_all_attempts(
        self,
    ):
        self.base_engine.output = decision(response="withdrawal")
        engine = ScriptedBounded(
            ["insufficient", "supported"], ["rejection", "rejection"]
        )
        transition, interpretation, audit = self.run_policy(engine)
        self.assertEqual(audit["base_transition"]["decision"], "cancel")
        self.assertEqual(audit["first_verifier"]["status"], "abstained")
        self.assertEqual(transition["decision"], "decline")
        self.assertEqual(interpretation["status"], "agreed")
        self.assertEqual(audit["path"], "reclassified_supported")
        self.assertEqual(audit["extra_passes"], 1)
        self.assertEqual(len(engine.calls), 4)
        for name, call in zip(("primary", "secondary"), engine.calls[1:3], strict=True):
            self.assertEqual(
                call[0], audit["base_classifier"]["arms"][name]["input_messages"]
            )
            self.assertEqual(
                call[1]["response_schema"], audit["base_classifier"]["response_schema"]
            )
            self.assertEqual(
                (call[1]["max_tokens"], call[1]["seed"], call[1]["temperature"]),
                (2048, 42, 0),
            )

    def test_reclassified_no_change_always_abstains_to_keep_pending(self):
        for responses in (("none", "none"), ("rejection", "none")):
            with self.subTest(responses=responses):
                engine = ScriptedBounded(["insufficient"], responses)
                transition, meaning, audit = self.run_policy(engine)
                self.assertEqual(transition["decision"], "no_change")
                self.assertIsNone(transition["evidence_message_id"])
                self.assertEqual(meaning["status"], "abstained")
                self.assertEqual(audit["path"], "reclassified_abstained")
                self.assertEqual(len(engine.calls), 3)
                self.assertNotIn("second_verifier", audit)

    def test_identical_claim_reuses_first_negative_without_another_model_call(self):
        engine = ScriptedBounded(["insufficient"], ["agreement", "agreement"])
        transition, _, audit = self.run_policy(engine)
        self.assertEqual(transition["decision"], "no_change")
        self.assertEqual(audit["second_verifier"]["status"], "reused_non_support")
        self.assertEqual(
            audit["verification_request_identity"]["first"],
            audit["verification_request_identity"]["second"],
        )
        self.assertEqual(len(engine.calls), 3)

    def test_first_identity_keeps_actual_model_snapshot_after_runtime_mutation(self):
        engine = ScriptedBounded(
            ["insufficient", "supported"], ["agreement", "agreement"]
        )
        engine.manifest = {"model_file": "original-test-runtime"}

        def change_runtime(audit):
            if audit["stage"] == "episode_reconsider_complete":
                engine.manifest["model_file"] = "different-test-runtime"

        transition, _, audit = self.run_policy(engine, stages=change_runtime)
        self.assertEqual(
            audit["first_verifier"]["model_manifest"]["model_file"],
            "original-test-runtime",
        )
        self.assertEqual(
            audit["second_verifier"]["model_manifest"]["model_file"],
            "different-test-runtime",
        )
        self.assertNotEqual(
            audit["verification_request_identity"]["first"],
            audit["verification_request_identity"]["second"],
        )
        self.assertEqual(len(engine.calls), 4)
        self.assertEqual(transition["decision"], "accept")

    def test_same_canonical_different_claim_does_not_reuse_verdict(self):
        engine = ScriptedBounded(
            ["insufficient", "supported"], ["terms_change", "terms_change"]
        )
        transition, _, audit = self.run_policy(engine)
        self.assertEqual(audit["base_transition"]["decision"], "accept")
        self.assertEqual(transition["decision"], "accept")
        self.assertNotEqual(
            audit["verification_request_identity"]["first"],
            audit["verification_request_identity"]["second"],
        )
        self.assertEqual(audit["second_verifier"]["status"], "supported")
        self.assertEqual(len(engine.calls), 4)

    def test_second_negative_never_restores_original_or_starts_third_pass(self):
        engine = ScriptedBounded(
            ["contradicted", "insufficient"], ["rejection", "rejection"]
        )
        transition, meaning, audit = self.run_policy(engine)
        self.assertEqual(transition["decision"], "no_change")
        self.assertEqual(meaning["status"], "abstained")
        self.assertEqual(audit["base_transition"]["decision"], "accept")
        self.assertEqual(audit["reclassification"]["proposal"]["decision"], "decline")
        self.assertEqual(audit["extra_passes"], 1)
        self.assertEqual(len(engine.calls), 4)

    def test_first_engine_failure_never_reclassifies(self):
        for code in (
            "generation_timeout",
            "grounding_invalid",
            "context_limit",
            "response_truncated",
            "episode_superseded",
        ):
            with self.subTest(code=code):
                engine = ScriptedBounded([GemmaFailure(code)])
                with self.assertRaises(GemmaFailure) as caught:
                    self.run_policy(engine)
                self.assertEqual(caught.exception.code, code)
                audit = caught.exception.result["episode_deliberation"]
                self.assertEqual(audit["extra_passes"], 0)
                self.assertEqual(audit["path"], "execution_failed")
                self.assertEqual(len(engine.calls), 1)

    def test_reclassification_or_second_verifier_error_is_not_successful_abstention(
        self,
    ):
        for phase in ("reclassification", "second_verifier"):
            with self.subTest(phase=phase):
                failure = GemmaFailure(
                    "response_truncated", {"reply": "PRIVATE_PARTIAL"}
                )
                engine = ScriptedBounded(
                    ["insufficient", failure]
                    if phase == "second_verifier"
                    else ["insufficient"],
                    ["rejection", "rejection"]
                    if phase == "second_verifier"
                    else [failure],
                )
                with self.assertRaises(GemmaFailure) as caught:
                    self.run_policy(engine)
                audit = caught.exception.result["episode_deliberation"]
                self.assertEqual(audit["path"], "execution_failed")
                self.assertEqual(audit["final_interpretation"]["status"], "failed")
                self.assertIsNone(audit["final_transition"])
                self.assertEqual(
                    len(engine.calls), 4 if phase == "second_verifier" else 2
                )

    def test_cancellation_after_trigger_does_not_start_reclassification(self):
        class Cancelled(Exception):
            pass

        engine = ScriptedBounded(["insufficient"], ["rejection", "rejection"])

        def stage(audit):
            if audit["stage"] == "episode_reconsider_selected":
                raise Cancelled

        with self.assertRaises(Cancelled):
            self.run_policy(engine, stages=stage)
        self.assertEqual(len(engine.calls), 1)

    def test_false_state_callback_stops_writer_assembly(self):
        self.base_engine.output = decision(response="withdrawal")
        engine = ScriptedBounded(
            ["insufficient", "supported"], ["rejection", "rejection"]
        )
        calls = []

        def reject_stale(transition):
            calls.append(transition)
            return False

        with self.assertRaises(GemmaFailure) as caught:
            ChatPromptBuilder(
                reader=EvidenceReader(
                    self.base_engine, episode_verifier=EpisodeEntailment(engine)
                )
            ).build(
                visitor_id="test-only",
                character_id="majima",
                scenario_version="daily-if-v1",
                user_message=self.args["question"],
                current_message_id="current",
                history=[],
                notices=self.args["notices"],
                episode_context=self.args["context"],
                count_tokens=lambda _: 100,
                on_episode_decision=reject_stale,
            )
        self.assertEqual(caught.exception.code, "episode_superseded")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["decision"], "decline")

    def test_builder_commits_only_supported_final_decision_once(self):
        self.base_engine.output = decision(response="withdrawal")
        engine = ScriptedBounded(
            ["insufficient", "supported"], ["rejection", "rejection"]
        )
        calls = []
        result = ChatPromptBuilder(
            reader=EvidenceReader(
                self.base_engine, episode_verifier=EpisodeEntailment(engine)
            )
        ).build(
            visitor_id="test-only",
            character_id="majima",
            scenario_version="daily-if-v1",
            user_message=self.args["question"],
            current_message_id="current",
            history=[],
            notices=self.args["notices"],
            episode_context=self.args["context"],
            count_tokens=lambda _: 100,
            on_episode_decision=calls.append,
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["decision"], "decline")
        grounding = result["metadata"]["grounding"]
        self.assertEqual(
            grounding["episode_classifier"]["pre_veto_transition"]["decision"], "cancel"
        )
        self.assertEqual(
            grounding["episode_classifier"]["interpretation"],
            grounding["episode_interpretation"],
        )
        self.assertEqual(
            grounding["episode_deliberation"]["path"], "reclassified_supported"
        )
