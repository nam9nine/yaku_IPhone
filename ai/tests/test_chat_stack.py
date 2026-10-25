"""The stack must own cleanup and keep gateway proof out of unrelated children."""

import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from kiryu_ai.chat_stack import run


class StackTests(unittest.TestCase):
    def test_missing_credentials_do_not_spawn_or_replace_model_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = argparse.Namespace(
                tooling=root,
                state=root / "state",
                cloudflare=root,
                cloudflared="/bin/false",
            )
            key = root / "model-api-key.txt"
            key.write_text("UNCHANGED")
            with (
                patch("kiryu_ai.chat_stack.socket.socket"),
                patch("kiryu_ai.chat_stack.subprocess.Popen") as spawn,
            ):
                with self.assertRaises(ValueError):
                    run(args)
                spawn.assert_not_called()
            self.assertEqual(key.read_text(), "UNCHANGED")

    def test_startup_failure_stops_only_owned_children_in_reverse_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = argparse.Namespace(
                tooling=root,
                state=root / "state",
                cloudflare=root,
                cloudflared="/bin/false",
            )
            for name in ("gateway-secret.txt", "tunnel-token.txt"):
                path = root / name
                path.write_text("PRIVATE_FIXTURE")
                path.chmod(0o600)
            (root / "runtime-manifest.json").write_text(
                json.dumps({"template_sha256": "fixture"})
            )
            stopped = []
            model, api = MagicMock(), MagicMock()
            for child, name in ((model, "model"), (api, "api")):
                child.poll.return_value = None
                child.terminate.side_effect = lambda name=name: stopped.append(name)
            with (
                patch("kiryu_ai.chat_stack.socket.socket"),
                patch("kiryu_ai.chat_stack.signal.signal"),
                patch("kiryu_ai.chat_stack.wait_ready"),
                patch(
                    "kiryu_ai.chat_stack.subprocess.Popen",
                    side_effect=[model, api, OSError("owner startup")],
                ) as spawn,
                self.assertRaises(OSError),
            ):
                run(args)
            self.assertEqual(stopped, ["api", "model"])
            self.assertNotIn(
                "KIRYU_GATEWAY_SECRET", spawn.call_args_list[0].kwargs["env"]
            )
            self.assertEqual(
                spawn.call_args_list[1].kwargs["env"]["KIRYU_GATEWAY_SECRET"],
                "PRIVATE_FIXTURE",
            )
            self.assertNotIn("PRIVATE_FIXTURE", str(spawn.call_args_list[1].args))


if __name__ == "__main__":
    unittest.main()
