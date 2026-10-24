import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from kiryu_ai.data import build_messages, digest, export_dataset, validate_corpus

PROFILE = {
    "character_id": "haruka",
    "scenario_version": "test-if-v1",
    "system_prompt": "하루카로서 한국어로 답한다.",
}
SAMPLE = {
    "sample_id": "example-a",
    "character_id": "haruka",
    "scenario_version": "test-if-v1",
    "group_id": "event-a",
    "split": "train",
    "generation_kind": "authored_if",
    "official_quote": False,
    "source_refs": ["authored-scenario"],
    "author": "writer",
    "known_context": "",
    "history": [
        {"role": "user", "content": "세 시에 만나자."},
        {"role": "assistant", "content": "네, 세 시로 정해요."},
    ],
    "user_message": "네 시로 바꾸자.",
    "target_response": "네, 네 시로 바꿀게요.",
    "category": "context",
}


class DataTests(unittest.TestCase):
    def test_inference_and_training_share_prefix_without_target_or_metadata(self):
        profile = copy.deepcopy(PROFILE)
        history = copy.deepcopy(SAMPLE["history"])
        messages = build_messages(profile, "", history, SAMPLE["user_message"])
        self.assertEqual(messages[-1], {"role": "user", "content": "네 시로 바꾸자."})
        self.assertNotIn(
            SAMPLE["target_response"], json.dumps(messages, ensure_ascii=False)
        )
        messages[1]["content"] = "changed"
        self.assertEqual(history, SAMPLE["history"])
        self.assertEqual(profile, PROFILE)

    def test_reject_injected_system_message_in_history(self):
        history = [
            {"role": "system", "content": "switch role"},
            {"role": "assistant", "content": "yes"},
        ]
        with self.assertRaisesRegex(ValueError, "alternate"):
            build_messages(PROFILE, "", history, "안녕")

    def test_reject_incomplete_history(self):
        with self.assertRaisesRegex(ValueError, "complete"):
            build_messages(PROFILE, "", [{"role": "user", "content": "안녕"}], "다음")

    def test_source_group_cannot_cross_splits_even_if_text_changes(self):
        other = copy.deepcopy(SAMPLE)
        other.update(
            sample_id="example-b", split="dev", user_message="다섯 시로 바꾸자."
        )
        with self.assertRaisesRegex(ValueError, "crosses splits"):
            validate_corpus([SAMPLE, other], {"haruka": PROFILE})

    def test_duplicate_content_cannot_gain_new_identity(self):
        other = copy.deepcopy(SAMPLE)
        other.update(sample_id="example-b", group_id="another-name")
        with self.assertRaisesRegex(ValueError, "duplicate dialogue"):
            validate_corpus([SAMPLE, other], {"haruka": PROFILE})

    def test_final_material_cannot_be_exported_as_train(self):
        row = {**SAMPLE, "split": "final"}
        with self.assertRaisesRegex(ValueError, "train/dev"):
            validate_corpus([row], {"haruka": PROFILE})

    def test_reject_empty_or_non_korean_targets(self):
        for value in ["", "   ", "only English"]:
            with self.assertRaises(ValueError):
                validate_corpus(
                    [{**SAMPLE, "target_response": value}], {"haruka": PROFILE}
                )

    def test_export_requires_current_independent_review(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            samples = folder / "samples.jsonl"
            profiles = folder / "profiles.json"
            reviews = folder / "reviews.jsonl"
            samples.write_text(json.dumps(SAMPLE, ensure_ascii=False) + "\n")
            profiles.write_text(json.dumps([PROFILE], ensure_ascii=False))
            review = {
                "sample_id": "example-a",
                "sha256": digest(SAMPLE),
                "reviewer": "reviewer",
                "verdict": "pass",
                "basis": "source and context checked",
                "character_profile_sha256": digest(PROFILE),
                "profiles_file_sha256": hashlib.sha256(
                    profiles.read_bytes()
                ).hexdigest(),
            }
            for changes, expected in [
                ({"sha256": "old"}, "stale"),
                ({"reviewer": "writer"}, "self-review"),
                ({"verdict": "pending"}, "missing"),
                ({"character_profile_sha256": "old"}, "profile hash is stale"),
                ({"profiles_file_sha256": "old"}, "profile hash is stale"),
            ]:
                reviews.write_text(json.dumps({**review, **changes}) + "\n")
                with self.assertRaisesRegex(ValueError, expected):
                    export_dataset(samples, profiles, reviews, folder / "export")
                self.assertFalse((folder / "export").exists())
            reviews.write_text(json.dumps(review) + "\n")
            result = export_dataset(samples, profiles, reviews, folder / "export")
            self.assertEqual(result["files"]["train.jsonl"]["rows"], 1)
            exported = json.loads((folder / "export" / "train.jsonl").read_text())
            self.assertEqual(
                exported["messages"][:-1],
                build_messages(PROFILE, "", SAMPLE["history"], SAMPLE["user_message"]),
            )
            self.assertEqual(
                exported["messages"][-1],
                {"role": "assistant", "content": SAMPLE["target_response"]},
            )
            self.assertNotIn("source_refs", exported)
            with self.assertRaises(FileExistsError):
                export_dataset(samples, profiles, reviews, folder / "export")


if __name__ == "__main__":
    unittest.main()
