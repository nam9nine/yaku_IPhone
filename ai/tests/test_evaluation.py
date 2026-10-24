import copy
import json
import tempfile
import unittest
from pathlib import Path

from kiryu_ai.data import digest, read_jsonl
from kiryu_ai.evaluation import (
    blind_pack,
    comparison_summary,
    distribution,
    latency_summary,
    prepare,
    quality_summary,
)


def result(sid="case::facts-off", **changes):
    row = {
        "sample_id": sid,
        "character_id": "majima",
        "condition": "facts-off",
        "status": "ok",
        "reply": "두 시다.",
        "prompt_sha256": "same-token-input",
        "sampling": {"temperature": 0.7, "max_tokens": 128},
        "generation_seed": 42,
        "finish_reason": "stop",
        "prompt_cache": "fresh_per_request",
        "ttft_seconds": 0.5,
        "first_text_seconds": 0.75,
        "queue_seconds": 1,
        "total_seconds": 2,
        "arrival_to_finish_seconds": 3,
        "generation_tokens": 6,
        "prompt_tokens": 50,
    }
    return {**row, **changes}


def request(sid="case::facts-off"):
    messages = [
        {"role": "system", "content": "마지마"},
        {"role": "user", "content": "언제?"},
    ]
    return {
        "sample_id": sid,
        "character_id": "majima",
        "condition": "facts-off",
        "messages": messages,
        "input_sha256": digest(messages),
        "profile_sha256": "profile",
    }


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.profiles = [
            {"character_id": cid, "scenario_version": "if-v1", "system_prompt": cid}
            for cid in ("majima", "haruka")
        ]
        self.cases = [
            {
                "sample_id": "dev-1",
                "split": "dev",
                "character_id": "majima",
                "scenario_version": "if-v1",
                "category": "provided_fact",
                "known_context": "番号は47",
                "history": [],
                "user_message": "몇 번?",
                "target_response": "TARGET_SENTINEL",
                "expected_behavior": "RUBRIC_SENTINEL",
            }
        ]
        self.knowledge = [
            {
                "id": "adopted",
                "textKo": "허용된 근거",
                "knownBy": [],
                "characterIds": [],
            },
            {"id": "other", "textKo": "다른 인물의 근거", "characterIds": ["majima"]},
            {"id": "unadopted", "textKo": "미채택 근거", "known_by": ["majima"]},
        ]
        self.scenario = {
            "scenario_version": "if-v1",
            "active_characters": ["majima", "haruka"],
            "adopted_facts": [
                {"id": "adopted", "known_by": ["majima"]},
                {"id": "other", "known_by": ["haruka"]},
            ],
        }

    def tearDown(self):
        self.tmp.cleanup()

    def run_prepare(self):
        for name, rows in (
            ("cases.jsonl", self.cases),
            ("knowledge.jsonl", self.knowledge),
        ):
            (self.root / name).write_text(
                "".join(json.dumps(row) + "\n" for row in rows)
            )
        (self.root / "profiles.json").write_text(json.dumps(self.profiles))
        (self.root / "scenario.json").write_text(json.dumps(self.scenario))
        return prepare(
            self.root / "cases.jsonl",
            self.root / "profiles.json",
            self.root / "knowledge.jsonl",
            self.root / "scenario.json",
            self.root / "prepared",
        )

    def test_only_explicitly_scoped_facts_and_no_targets(self):
        manifest = self.run_prepare()
        rows = read_jsonl(self.root / "prepared/requests.jsonl")
        self.assertEqual(manifest["requests"], 2)
        self.assertEqual(rows[0]["fact_ids"], [])
        self.assertEqual(rows[1]["fact_ids"], ["adopted"])
        encoded = json.dumps(rows, ensure_ascii=False)
        for hidden in (
            "TARGET_SENTINEL",
            "RUBRIC_SENTINEL",
            "다른 인물의 근거",
            "미채택 근거",
        ):
            self.assertNotIn(hidden, encoded)
        for row in rows:
            self.assertEqual(row["messages"][-1]["role"], "user")
            self.assertIn("番号は47", row["messages"][0]["content"])
            self.assertEqual(row["input_sha256"], digest(row["messages"]))
        key = read_jsonl(self.root / "prepared/private-key.jsonl")
        self.assertEqual(key[0]["reference_response"], "TARGET_SENTINEL")
        self.assertEqual(key[0]["expected_behavior"], "RUBRIC_SENTINEL")

    def test_final_holdout_rejected(self):
        self.cases[0]["split"] = "final"
        with self.assertRaisesRegex(ValueError, "Only dev"):
            self.run_prepare()

    def test_missing_fact_source_rejected(self):
        self.scenario["adopted_facts"][0]["id"] = "not-present"
        with self.assertRaisesRegex(ValueError, "no source"):
            self.run_prepare()

    def test_scenario_mismatch_rejected(self):
        self.cases[0]["scenario_version"] = "wrong"
        with self.assertRaisesRegex(ValueError, "version mismatch"):
            self.run_prepare()

    def test_duplicate_case_and_overwrite_rejected(self):
        self.cases.append(copy.deepcopy(self.cases[0]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.run_prepare()
        self.cases.pop()
        self.run_prepare()
        with self.assertRaises(FileExistsError):
            self.run_prepare()


class SummaryTests(unittest.TestCase):
    def test_latency_is_queue_inclusive_and_reports_actual_count(self):
        rows = [result(), result("case2", status="error")]
        summary = latency_summary(
            rows, {"loading_included_in_request_latency": False, "burst": 2}
        )
        self.assertEqual(summary["executed_requests"], 2)
        self.assertEqual(summary["errors"], 1)
        self.assertEqual(summary["ttft_service_seconds"]["p50"], 0.5)
        self.assertEqual(summary["ttft_queue_inclusive_seconds"]["p50"], 1.5)
        self.assertEqual(summary["first_text_service_seconds"]["p50"], 0.75)
        self.assertEqual(summary["first_text_queue_inclusive_seconds"]["p50"], 1.75)
        self.assertEqual(summary["actual_generation_tokens"]["n"], 1)
        self.assertEqual(summary["actual_generation_tokens"]["p50"], 6)
        self.assertIsNone(summary["automatic_quality_verdict"])

    def test_percentile_reports_n_and_missing_values(self):
        summary = distribution([1, 2, 3, None])
        self.assertEqual(summary["n"], 3)
        self.assertEqual(summary["p50"], 2)
        self.assertAlmostEqual(summary["p95"], 2.9)
        self.assertIsNone(distribution([])["p95"])

    def test_reviews_denominators_pair_success_and_fan_pending(self):
        ids = ["a", "b", "fact", "unknown"]
        rows = [result(sid) for sid in ids]
        keys = [
            {
                "sample_id": sid,
                "character_id": "majima",
                "condition": "facts-off",
                "category": cat,
                "pair_id": "pair" if cat == "context_pair" else None,
            }
            for sid, cat in zip(
                ids, ["context_pair", "context_pair", "provided_fact", "unknown"]
            )
        ]
        reviews = [
            {
                "sample_id": "a",
                "reviewer_kind": "independent_agent",
                "reviewer": "reviewer",
                "basis": "provided time used",
                "result_sha256": digest(rows[0]),
                "context_correct": True,
            },
            {
                "sample_id": "b",
                "reviewer_kind": "independent_agent",
                "reviewer": "reviewer",
                "basis": "correction ignored",
                "result_sha256": digest(rows[1]),
                "context_correct": False,
            },
            {
                "sample_id": "fact",
                "reviewer_kind": "independent_agent",
                "reviewer": "reviewer",
                "basis": "grounded answer",
                "result_sha256": digest(rows[2]),
                "fact_correct": True,
            },
        ]
        report = quality_summary(rows, keys, reviews)["groups"]["majima:facts-off"]
        self.assertEqual(report["metrics"]["context_pair"]["accuracy_on_reviewed"], 0.5)
        self.assertEqual(report["context_pairs"]["both_correct"], 0)
        self.assertEqual(report["context_pairs"]["reviewed"], 1)
        self.assertEqual(report["metrics"]["provided_fact"]["reviewed"], 1)
        self.assertEqual(report["metrics"]["unknown"]["pending"], 1)
        self.assertIsNone(report["metrics"]["unknown"]["accuracy_on_reviewed"])
        self.assertEqual(report["fan_style"]["status"], "pending")
        self.assertEqual(report["fan_style"]["reviewed"], 0)
        reviews[0]["context_correct"] = "true"
        with self.assertRaisesRegex(ValueError, "literal boolean"):
            quality_summary(rows, keys, reviews)

    def test_stale_review_and_unknown_result_rejected(self):
        row = result()
        key = {
            "sample_id": row["sample_id"],
            "character_id": "majima",
            "condition": "facts-off",
            "category": "provided_fact",
        }
        review = {
            "sample_id": row["sample_id"],
            "reviewer_kind": "fan",
            "reviewer": "human",
            "basis": "tone",
            "result_sha256": "stale",
            "style_score": 4,
        }
        with self.assertRaisesRegex(ValueError, "Stale"):
            quality_summary([row], [key], [review])
        with self.assertRaisesRegex(ValueError, "unknown"):
            quality_summary([row], [])


class BlindComparisonTests(unittest.TestCase):
    def test_exact_join_and_no_model_labels_in_public_pack(self):
        inputs = [request("one"), request("two")]
        base = [result("one", reply="base response"), result("two", reply="second")]
        trained = [
            result("two", reply="trained second"),
            result("one", reply="trained first"),
        ]
        pack, mapping = blind_pack(inputs, base, trained)
        self.assertEqual(len(pack), 2)
        self.assertEqual({row["sample_id"] for row in mapping}, {"one", "two"})
        for row in pack:
            self.assertEqual(set(row["responses"]), {"A", "B"})
            self.assertNotIn("sample_id", row)
            self.assertNotIn("model", row)
            self.assertNotIn("adapter", row)
        for hidden in mapping:
            shown = next(row for row in pack if row["blind_id"] == hidden["blind_id"])
            for label, name in hidden["labels"].items():
                outputs = base if name == "base" else trained
                expected = next(
                    row["reply"]
                    for row in outputs
                    if row["sample_id"] == hidden["sample_id"]
                )
                self.assertEqual(shown["responses"][label], expected)

    def test_mismatched_id_prompt_seed_profile_rejected(self):
        with self.assertRaises(ValueError):
            blind_pack([request()], [result()], [result("other")])
        for change in (
            {"prompt_sha256": "other"},
            {"generation_seed": 43},
            {"profile_sha256": "wrong"},
            {"status": "error"},
        ):
            with self.assertRaises(ValueError):
                blind_pack([request()], [result()], [result(**change)])
        with self.assertRaises(ValueError):
            blind_pack([request()], [result(), result()], [result()])

    def test_one_win_nineteen_ties_not_success(self):
        mapping = [
            {
                "blind_id": str(i),
                "comparison_sha256": "pair-" + str(i),
                "labels": {"A": "trained", "B": "base"},
            }
            for i in range(20)
        ]
        votes = [
            {
                "blind_id": str(i),
                "preference": "A" if i == 0 else "tie",
                "comparison_sha256": "pair-" + str(i),
                "reviewer": "fan-one",
                "reviewer_kind": "fan",
                "basis": "Compared reactions",
            }
            for i in range(20)
        ]
        summary = comparison_summary(mapping, votes)
        self.assertEqual(summary["trained_wins"], 1)
        self.assertEqual(summary["trained_losses"], 0)
        self.assertEqual(summary["ties"], 19)
        self.assertEqual(summary["net_win_fraction_of_all_reviewed"], 0.05)
        self.assertEqual(summary["tie_adjusted_win_fraction"], 0.525)
        self.assertEqual(summary["effect_status"], "unclear")
        self.assertIsNone(summary["automatic_quality_verdict"])
        votes[0]["comparison_sha256"] = "stale"
        with self.assertRaisesRegex(ValueError, "stale"):
            comparison_summary(mapping, votes)


if __name__ == "__main__":
    unittest.main()
