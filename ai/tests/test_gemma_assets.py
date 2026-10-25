import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kiryu_ai.gemma_assets import fetch


class GemmaAssetsTests(unittest.TestCase):
    def test_complete_verified_partial_is_promoted_without_network(self):
        data = b"pinned test artifact"
        digest = hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "model.gguf"
            partial = target.with_name(target.name + ".part")
            partial.write_bytes(data)
            with patch("kiryu_ai.gemma_assets.subprocess.run") as command:
                self.assertEqual(
                    fetch("https://example.invalid/model", target, digest, len(data)),
                    target,
                )
                command.assert_not_called()
            self.assertEqual(target.read_bytes(), data)
            self.assertFalse(partial.exists())

    def test_existing_wrong_model_is_not_overwritten_or_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "model.gguf"
            target.write_bytes(b"wrong artifact")
            with (
                patch("kiryu_ai.gemma_assets.subprocess.run") as command,
                self.assertRaises(ValueError),
            ):
                fetch("https://example.invalid/model", target, "0" * 64)
            command.assert_not_called()
            self.assertEqual(target.read_bytes(), b"wrong artifact")

    def test_download_hash_mismatch_cannot_produce_model_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "model.gguf"
            partial = target.with_name(target.name + ".part")
            partial.write_bytes(b"bad")
            with (
                patch("kiryu_ai.gemma_assets.subprocess.run"),
                self.assertRaises(ValueError),
            ):
                fetch("https://example.invalid/model", target, "0" * 64, 3)
            self.assertFalse(target.exists())
            self.assertTrue(partial.exists())


if __name__ == "__main__":
    unittest.main()
