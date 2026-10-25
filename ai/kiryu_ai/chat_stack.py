"""Run the owned model, chat API, owner UI and named tunnel as one local stack."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path


def wait_ready(url, child, stopped, timeout=240):
    end = time.monotonic() + timeout
    while time.monotonic() < end and not stopped.is_set():
        if child.poll() is not None:
            raise RuntimeError(
                "An owned service exited before becoming ready; inspect its private log"
            )
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                body = json.load(response)
            if body.get("status") in {"ok", "ready"}:
                return
            if body.get("status") == "error":
                raise RuntimeError(
                    "Chat startup failed; inspect the private service log"
                )
        except (OSError, urllib.error.URLError, ValueError):
            pass
        stopped.wait(0.25)
    raise RuntimeError("Service startup interrupted or timed out")


def run(args):
    os.umask(0o077)
    repository = Path(__file__).resolve().parents[2]
    tooling = Path(args.tooling).resolve()
    state = Path(args.state).resolve()
    cloudflare = Path(args.cloudflare).resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    logs = state / "logs"
    logs.mkdir(exist_ok=True, mode=0o700)
    # A second stack must fail before replacing the model key or loading weights.
    for port in (8791, 8766, 8767):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    for path in (cloudflare / "gateway-secret.txt", cloudflare / "tunnel-token.txt"):
        if not path.is_file() or path.stat().st_mode & 0o077:
            raise ValueError(
                "Cloudflare credential files must exist with owner-only permissions"
            )
    environment = dict(os.environ)
    environment.pop("KIRYU_GATEWAY_SECRET", None)
    environment["PYTHONPATH"] = str(repository / "ai")
    stopped = threading.Event()
    for event in (signal.SIGINT, signal.SIGTERM):
        signal.signal(event, lambda _signum, _frame: stopped.set())
    lock = (state / "stack.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        raise
    children, handles = [], []

    def start(name, command, env=None):
        handle = (logs / (name + ".log")).open("ab")
        handles.append(handle)
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=handle,
            stderr=handle,
            env=env or environment,
            cwd=repository,
            start_new_session=True,
        )
        children.append(process)
        return process

    try:
        model = start(
            "model",
            [
                sys.executable,
                "-m",
                "kiryu_ai.gemma_engine",
                "--directory",
                str(tooling),
            ],
        )
        # Health does not expose model credentials or visitor data.
        wait_ready("http://127.0.0.1:8791/health", model, stopped)
        # GemmaProcess writes template identity just after /health is ready.
        manifest = tooling / "runtime-manifest.json"
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                if json.loads(manifest.read_text()).get("template_sha256"):
                    break
            except (OSError, ValueError):
                pass
            stopped.wait(0.1)
        api_environment = dict(environment)
        api_environment["KIRYU_GATEWAY_SECRET"] = (
            (cloudflare / "gateway-secret.txt").read_text().strip()
        )
        api = start(
            "api",
            [
                sys.executable,
                "-m",
                "kiryu_ai.chat_server",
                "--data-root",
                str(state),
                "--manifest",
                str(manifest),
                "--api-key-file",
                str(tooling / "model-api-key.txt"),
                "--embedding-dir",
                str(tooling / "embeddings"),
            ],
            api_environment,
        )
        wait_ready("http://127.0.0.1:8766/v1/health", api, stopped)
        start(
            "owner",
            [
                sys.executable,
                "-m",
                "kiryu_ai.chat_admin",
                "--database",
                str(state / "chat.sqlite3"),
            ],
        )
        start(
            "tunnel",
            [
                str(Path(args.cloudflared).resolve()),
                "tunnel",
                "--no-autoupdate",
                "--protocol",
                "quic",
                "run",
                "--token-file",
                str(cloudflare / "tunnel-token.txt"),
            ],
        )
        print(
            json.dumps(
                {
                    "status": "local-ready",
                    "api": "http://127.0.0.1:8766/v1/health",
                    "owner_link_log": str(logs / "owner.log"),
                    "note": "Tunnel registration and public health must be verified separately",
                }
            ),
            flush=True,
        )
        while not stopped.wait(1):
            if any(child.poll() is not None for child in children):
                raise RuntimeError(
                    "An owned service exited; stopping this stack, no alternate model"
                )
    finally:
        # Stop inbound tunnel/admin first, drain API, and stop model last.
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=75)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
        for handle in handles:
            handle.close()
        lock.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tooling", default=".tooling/gemma")
    parser.add_argument("--state", default="references/local/gemma-chat/state")
    parser.add_argument("--cloudflare", default=".tooling/cloudflare")
    parser.add_argument("--cloudflared", default=shutil.which("cloudflared"))
    args = parser.parse_args()
    if not args.cloudflared:
        parser.error("Install cloudflared or provide --cloudflared PATH")
    run(args)


if __name__ == "__main__":
    main()
