"""The stack must own cleanup and keep gateway proof out of unrelated children."""

import argparse
import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from kiryu_ai.chat_stack import ensure_ports_available, run, wait_manifest
from kiryu_ai.gemma_engine import DEPLOYMENT_PROFILE


class StackTests(unittest.TestCase):
    def test_port_probe_rejects_live_listener_but_allows_closed_connection(self):
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            address = listener.getsockname()
            with self.assertRaises(OSError):
                ensure_ports_available((address[1],))
            with socket.create_connection(address, timeout=2) as client:
                connection, _ = listener.accept()
                connection.close()
                self.assertEqual(client.recv(1), b"")
        ensure_ports_available((address[1],))

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
                json.dumps({"template_sha256": "fixture", **DEPLOYMENT_PROFILE})
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

    def test_old_manifest_is_not_ready_until_current_profile_is_published(self):
        path, child, stopped = MagicMock(), MagicMock(), MagicMock()
        child.poll.return_value = None
        stopped.is_set.return_value = False
        path.read_text.side_effect = [
            json.dumps({"template_sha256": "same-template", "thinking": False}),
            json.dumps({"template_sha256": "same-template", **DEPLOYMENT_PROFILE}),
        ]
        wait_manifest(path, child, stopped)
        self.assertEqual(path.read_text.call_count, 2)
        stopped.wait.assert_called_once_with(0.1)

    def test_stale_manifest_timeout_never_starts_api(self):
        path, child, stopped = MagicMock(), MagicMock(), MagicMock()
        child.poll.return_value = None
        stopped.is_set.return_value = False
        path.read_text.return_value = '{"template_sha256":"old"}'
        with (
            patch("kiryu_ai.chat_stack.time.monotonic", side_effect=[0, 0, 2]),
            self.assertRaisesRegex(RuntimeError, "current runtime profile"),
        ):
            wait_manifest(path, child, stopped, timeout=1)


if __name__ == "__main__":
    unittest.main()
