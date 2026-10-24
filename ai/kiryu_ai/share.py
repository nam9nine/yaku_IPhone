"""Start an owned local API and a temporary HTTPS tunnel; keep invites private."""

import argparse
import json
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import urlopen


def tunnel_endpoint(log):
    matches = re.findall(
        r"https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com(?![a-z0-9.-])", log
    )
    return matches[-1] if matches else None


def invite_url(endpoint, key):
    url = urlsplit(endpoint)
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.path not in {"", "/"}
        or url.port not in {None, 443}
        or not isinstance(key, str)
        or not key
    ):
        raise ValueError("An HTTPS origin and nonempty invite key are required")
    origin = f"https://{url.hostname}"
    return "https://nam9nine.github.io/yaku_IPhone/#" + urlencode(
        {"aiEndpoint": origin, "aiInvite": key}
    )


def private_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        path.chmod(0o600)
        handle.write(content)


def stop_owned(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def run(args):
    binary = shutil.which("cloudflared")
    if not binary:
        raise RuntimeError("Install cloudflared before sharing this local API")
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", args.port)) == 0:
            raise RuntimeError(
                "The port is already in use; refusing to tunnel another service"
            )
    root = Path(args.data_root).resolve()
    folder = root / "web-share" / datetime.now(UTC).strftime("%Y%m%dT%H%M%S.%fZ")
    folder.mkdir(parents=True)
    folder.chmod(0o700)
    access = root / "web-access.json"
    server = tunnel = None
    server_log = (folder / "server.log").open("w")
    tunnel_log = (folder / "tunnel.log").open("w")
    state = {"status": "starting", "started_at": datetime.now(UTC).isoformat()}
    state_path = folder / "state.json"

    def save_state():
        private_write(
            state_path, json.dumps(state, ensure_ascii=False, indent=2) + "\n"
        )

    try:
        command = [
            sys.executable,
            "-m",
            "kiryu_ai.web_server",
            "--data-root",
            str(root),
            "--host",
            "127.0.0.1",
            "--port",
            str(args.port),
            "--access-file",
            str(access),
        ]
        for option in ("model", "adapter"):
            if getattr(args, option):
                command.extend(["--" + option, getattr(args, option)])
        for origin in args.allow_origin:
            command.extend(["--allow-origin", origin])
        server = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=server_log,
            stderr=subprocess.STDOUT,
        )
        state["server_pid"] = server.pid
        save_state()
        ready = False
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if server.poll() is not None:
                raise RuntimeError(f"API process exited; see {folder / 'server.log'}")
            try:
                with urlopen(
                    f"http://127.0.0.1:{args.port}/v1/health", timeout=2
                ) as response:
                    health = json.load(response)
                if health.get("service") != "kiryu-character-chat-v1":
                    raise RuntimeError(
                        "Unexpected service responded on the requested port"
                    )
                if health.get("status") == "error":
                    raise RuntimeError(
                        "Local model failed to load; inspect the private server log"
                    )
                if health.get("status") == "ready":
                    ready = True
                    break
            except (URLError, TimeoutError):
                pass
            time.sleep(0.5)
        if not ready:
            raise TimeoutError("Local model did not become ready within 180 seconds")
        tunnel = subprocess.Popen(
            [
                binary,
                "tunnel",
                "--no-autoupdate",
                "--config",
                "/dev/null",
                "--url",
                f"http://127.0.0.1:{args.port}",
            ],
            stdin=subprocess.DEVNULL,
            stdout=tunnel_log,
            stderr=subprocess.STDOUT,
        )
        state["tunnel_pid"] = tunnel.pid
        save_state()
        endpoint = None
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if tunnel.poll() is not None:
                raise RuntimeError(
                    f"Tunnel process exited; see {folder / 'tunnel.log'}"
                )
            endpoint = tunnel_endpoint((folder / "tunnel.log").read_text())
            if endpoint:
                break
            time.sleep(0.5)
        if not endpoint:
            raise TimeoutError("A temporary HTTPS endpoint was not assigned")
        key = json.loads(access.read_text())["invite_key"]
        invitation = invite_url(endpoint, key)
        invite_path = folder / "invite.txt"
        private_write(invite_path, invitation + "\n")
        state.update(status="running", endpoint=endpoint, invite_file=str(invite_path))
        save_state()
        private_write(
            root / "web-share" / "current.json", json.dumps(state, indent=2) + "\n"
        )
        print(f"접속 링크 파일: {invite_path}", flush=True)
        print(
            "이 프로세스와 Mac이 실행되는 동안 공개 사이트에서 채팅할 수 있습니다. Ctrl+C로 종료합니다.",
            flush=True,
        )
        while server.poll() is None and tunnel.poll() is None:
            time.sleep(1)
        raise RuntimeError(
            "The API or tunnel stopped unexpectedly; the public connection is no longer active"
        )
    finally:
        stop_owned(tunnel)
        stop_owned(server)
        server_log.close()
        tunnel_log.close()
        state.update(status="stopped", stopped_at=datetime.now(UTC).isoformat())
        save_state()
        current_path = root / "web-share" / "current.json"
        if current_path.exists() and json.loads(current_path.read_text()).get(
            "server_pid"
        ) == state.get("server_pid"):
            private_write(current_path, json.dumps(state, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--model")
    parser.add_argument("--adapter")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--allow-origin", action="append", default=[])
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")

    def interrupted(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        run(args)
    except KeyboardInterrupt:
        print("채팅 연결을 종료했습니다.")


if __name__ == "__main__":
    main()
