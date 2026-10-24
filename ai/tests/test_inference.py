import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kiryu_ai.evaluation import validate_run_pair
from kiryu_ai.inference import artifact_hashes, run_batch
from kiryu_ai.runtime import main as chat_main


class InferenceEvidenceTests(unittest.TestCase):
    def test_weight_replacement_changes_identity_even_at_same_path(self):
        with tempfile.TemporaryDirectory() as directory:
            weight = Path(directory) / "adapters.safetensors"
            weight.write_bytes(b"first")
            original = artifact_hashes(directory)
            weight.write_bytes(b"second")
            self.assertNotEqual(original, artifact_hashes(directory))

    def test_comparison_requires_same_actual_model_and_serialization(self):
        base = {
            "model": "/local/model",
            "adapter": None,
            "adapter_files": None,
            "model_files": {"weights": "original"},
            "serialization_sha256": "serializer",
            "code_sha256": "runner",
        }
        trained = {
            **base,
            "adapter": "/adapter",
            "adapter_files": {"weights": "trained"},
        }
        validate_run_pair(base, trained)
        for field in ("model_files", "serialization_sha256", "code_sha256"):
            with self.assertRaisesRegex(ValueError, "artifact hashes"):
                validate_run_pair(base, {**trained, field: "changed"})

    def test_empty_one_shot_rejected_before_loading_model(self):
        with patch("sys.argv", ["chat", "--data-root", "/missing", "--message", "   "]):
            with self.assertRaises(SystemExit) as raised:
                chat_main()
            self.assertEqual(raised.exception.code, 2)

    def test_failed_request_retained_and_batch_fails(self):
        class Engine:
            load_seconds = 0.01

            def reply(self, messages, **kwargs):
                raise ValueError("invalid prompt")

        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "model.safetensors").write_bytes(b"test-only")
            requests = folder / "requests.jsonl"
            requests.write_text(json.dumps({"sample_id": "bad", "messages": []}) + "\n")
            args = argparse.Namespace(
                model=str(folder),
                adapter=None,
                requests=str(requests),
                output=str(folder / "results.jsonl"),
                limit=None,
                burst=1,
                seed=42,
                max_tokens=32,
                temperature=0.7,
                top_p=0.8,
                top_k=20,
            )
            with (
                patch("kiryu_ai.inference.LocalModel", return_value=Engine()),
                self.assertRaisesRegex(RuntimeError, "1 inference requests failed"),
            ):
                run_batch(args)
            row = json.loads(Path(args.output).read_text())
            self.assertEqual(row["status"], "error")
            self.assertNotIn("reply", row)
            with self.assertRaises(FileExistsError):
                run_batch(args)
            Path(args.output).unlink()
            with self.assertRaises(FileExistsError):
                run_batch(args)


if __name__ == "__main__":
    unittest.main()
