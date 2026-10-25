"""One private, native-template Gemma runtime; never imports the MLX trainer.

The public bridge owns visitor authentication. This client only talks to an
authenticated loopback llama-server and never forwards prompts to an API vendor.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

CONTEXT_TOKENS = 4096
OUTPUT_TOKENS = 256
MODEL_ALIAS = "kiryu-gemma4-26b-a4b-q4km"
SAMPLING = {
    "temperature": 1.0,
    "top_p": 0.95,
    "top_k": 64,
    "min_p": 0.0,
    "repeat_penalty": 1.0,
    "presence_penalty": 0.0,
    "frequency_penalty": 0.0,
}
TEMPLATE_OPTIONS = {
    "chat_template_kwargs": {"enable_thinking": False},
    "reasoning_effort": "none",
}
CONTROL = re.compile(
    r"<\|[^>]*>|<[^<]*\|>|</?think>|</?thought>|<bos>|<eos>|<pad>|</s>",
    re.IGNORECASE,
)


class GemmaFailure(Exception):
    """Safe exception text; partial final output is available to private storage."""

    def __init__(self, code, result=None):
        super().__init__(code)
        self.code = code
        self.result = result or {}


def _messages(messages):
    if not isinstance(messages, list) or not messages:
        raise ValueError("messages must be a nonempty list")
    result = []
    for item in messages:
        if (
            not isinstance(item, dict)
            or item.get("role") not in {"system", "user", "assistant"}
            or not isinstance(item.get("content"), str)
            or not item["content"].strip()
        ):
            raise ValueError("Only nonempty text chat messages are accepted")
        if CONTROL.search(item["content"]):
            raise ValueError(
                "Raw model control delimiters cannot occur in message text"
            )
        result.append({"role": item["role"], "content": item["content"]})
    if result[0]["role"] != "system" or result[-1]["role"] != "user":
        raise ValueError("Input must begin with system and end with user")
    return result


def _private_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + "." + secrets.token_hex(6) + ".tmp")
    try:
        with os.fdopen(
            os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600),
            "w",
            encoding="utf-8",
        ) as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class GemmaEngine:
    def __init__(
        self,
        base_url="http://127.0.0.1:8791",
        *,
        api_key=None,
        api_key_file=None,
        timeout=60,
        manifest_path=None,
    ):
        parsed = urlsplit(base_url)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "::1"}
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Gemma endpoint must be an explicit loopback HTTP origin")
        self.host = parsed.hostname
        self.port = parsed.port or 8791
        if not 0 < timeout <= 60:
            raise ValueError("Generation timeout must be positive and at most 60s")
        self.timeout = timeout
        self.api_key = (
            Path(api_key_file).read_text().strip() if api_key_file else api_key
        )
        if not isinstance(self.api_key, str) or len(self.api_key) < 32:
            raise ValueError("A private model API key is required")
        self.manifest_path = Path(manifest_path) if manifest_path else None
        self.manifest = (
            json.loads(self.manifest_path.read_text())
            if self.manifest_path and self.manifest_path.exists()
            else {}
        )
        self._lock = threading.Lock()

    def _connect(self, path, body=None, *, timeout=None):
        connection = http.client.HTTPConnection(
            self.host, self.port, timeout=timeout or self.timeout
        )
        data = (
            json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        )
        headers = {
            "Authorization": "Bearer " + self.api_key,
            "Content-Type": "application/json",
            "Connection": "close",
        }
        connection.request("POST" if body is not None else "GET", path, data, headers)
        return connection

    def _json(self, path, body=None):
        connection = None
        try:
            connection = self._connect(path, body, timeout=min(self.timeout, 15))
            response = connection.getresponse()
            if response.status != 200:
                raise GemmaFailure("model_unavailable")
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise GemmaFailure("model_protocol")
            return json.loads(raw)
        except (OSError, http.client.HTTPException, ValueError) as error:
            raise GemmaFailure("model_unavailable") from error
        finally:
            if connection:
                connection.close()

    def health(self):
        return self._json("/health").get("status") == "ok"

    def record_template(self):
        """Record the actual embedded template, not a mutable upstream template."""
        props = self._json("/props")
        template = props.get("chat_template")
        if not isinstance(template, str) or not template:
            raise GemmaFailure("model_template_missing")
        self.manifest["template_sha256"] = hashlib.sha256(template.encode()).hexdigest()
        self.manifest["context_tokens"] = CONTEXT_TOKENS
        self.manifest["sampling"] = dict(SAMPLING)
        self.manifest["thinking"] = False
        self.manifest["cache_prompt"] = False
        if self.manifest_path:
            _private_text(
                self.manifest_path,
                json.dumps(self.manifest, ensure_ascii=False, indent=2) + "\n",
            )
        return self.manifest["template_sha256"]

    def count_tokens(self, messages):
        prompt = self._json(
            "/apply-template",
            {"messages": _messages(messages), **TEMPLATE_OPTIONS},
        ).get("prompt")
        if not isinstance(prompt, str) or not prompt:
            raise GemmaFailure("model_template_missing")
        # llama-server chat generation tokenizes its rendered prompt with both
        # add_special and parse_special enabled. The tokenizer avoids duplicate BOS.
        tokens = self._json(
            "/tokenize",
            {"content": prompt, "add_special": True, "parse_special": True},
        ).get("tokens")
        if not isinstance(tokens, list) or not all(type(t) is int for t in tokens):
            raise GemmaFailure("model_protocol")
        return len(tokens)

    def reply(self, messages, *, seed=None, max_tokens=OUTPUT_TOKENS):
        if not isinstance(max_tokens, int) or not 1 <= max_tokens <= OUTPUT_TOKENS:
            raise ValueError("Output budget must be 1–256 tokens")
        if seed is not None and (type(seed) is not int or not 0 <= seed < 2**32):
            raise ValueError("Seed must be a uint32 or None")
        messages = _messages(messages)
        # The HTTP bridge queues requests. This also prevents accidental overlap
        # from local callers of the same engine instance.
        with self._lock:
            token_count = self.count_tokens(messages)
            if token_count + max_tokens > CONTEXT_TOKENS:
                raise GemmaFailure("context_limit")
            return self._reply(messages, token_count, seed, max_tokens)

    def _reply(self, messages, token_count, seed, max_tokens):
        payload = {
            "model": MODEL_ALIAS,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_tokens": max_tokens,
            "cache_prompt": False,
            "id_slot": 0,
            "reasoning_format": "deepseek",
            **TEMPLATE_OPTIONS,
            **SAMPLING,
        }
        if seed is not None:
            payload["seed"] = seed
        started = time.monotonic()
        connection = None
        deadline_timer = None
        expired = threading.Event()
        parts = []
        first = None
        finish_reason = None
        usage = {}
        protocol_error = None

        def result():
            content = "".join(parts)
            return {
                "reply": content,
                "finish_reason": finish_reason,
                "total_seconds": time.monotonic() - started,
                "ttft_seconds": first,
                "prompt_tokens": usage.get("prompt_tokens", token_count),
                "completion_tokens": usage.get("completion_tokens"),
                "usage": dict(usage),
                "sampling": {**SAMPLING, "seed": seed},
                "model_manifest": dict(self.manifest),
            }

        try:
            connection = self._connect("/v1/chat/completions", payload)
            # A socket timeout alone only limits each read, not total duration.
            # Interrupt the owned request even if the server sends tiny heartbeats.
            owned_socket = connection.sock

            def deadline():
                expired.set()
                try:
                    owned_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

            deadline_timer = threading.Timer(
                max(0.001, self.timeout - (time.monotonic() - started)), deadline
            )
            deadline_timer.daemon = True
            deadline_timer.start()
            response = connection.getresponse()
            if response.status != 200:
                raise GemmaFailure("model_unavailable")
            while True:
                line = response.readline(1024 * 1024)
                if not line:
                    break
                if len(line) >= 1024 * 1024:
                    protocol_error = "model_protocol"
                    break
                if not line.startswith(b"data:"):
                    continue
                data = line[5:].strip()
                if data == b"[DONE]":
                    break
                event = json.loads(data)
                if event.get("error"):
                    protocol_error = "model_generation_failed"
                    break
                if event.get("usage"):
                    usage = event["usage"]
                for choice in event.get("choices", []):
                    delta = choice.get("delta", {})
                    if delta.get("reasoning_content") or delta.get("tool_calls"):
                        # Do not collect thought text, let alone return it as SMS.
                        protocol_error = "unexpected_reasoning"
                        break
                    content = delta.get("content")
                    if content:
                        if not isinstance(content, str):
                            protocol_error = "model_protocol"
                            break
                        if first is None:
                            first = time.monotonic() - started
                        parts.append(content)
                    finish_reason = choice.get("finish_reason") or finish_reason
                if protocol_error:
                    break
        except GemmaFailure:
            raise
        except (OSError, http.client.HTTPException, ValueError, TypeError) as error:
            raise GemmaFailure(
                "generation_timeout" if expired.is_set() else "model_connection_lost",
                result(),
            ) from error
        finally:
            if deadline_timer:
                deadline_timer.cancel()
            if connection:
                connection.close()
        output = result()
        if expired.is_set():
            raise GemmaFailure("generation_timeout", output)
        if protocol_error:
            raise GemmaFailure(protocol_error, output)
        if CONTROL.search(output["reply"]):
            # Retain malformed content only in the failure result for local review;
            # callers must not add failed results to the visible or model history.
            raise GemmaFailure("invalid_output", output)
        if finish_reason == "length":
            raise GemmaFailure("response_truncated", output)
        if finish_reason != "stop" or not output["reply"].strip():
            raise GemmaFailure("incomplete_response", output)
        output["reply"] = output["reply"].strip()
        return output


class GemmaProcess:
    """Own exactly one llama-server; never terminate unrelated local models."""

    def __init__(self, executable, model, directory, *, port=8791):
        self.executable = Path(executable).resolve()
        self.model = Path(model).resolve()
        self.directory = Path(directory).resolve()
        self.port = port
        self.process = None
        self.log = None
        self.api_key_file = self.directory / "model-api-key.txt"
        self.manifest_path = self.directory / "runtime-manifest.json"

    def command(self):
        return [
            str(self.executable),
            "--model",
            str(self.model),
            "--alias",
            MODEL_ALIAS,
            "--host",
            "127.0.0.1",
            "--port",
            str(self.port),
            "--ctx-size",
            str(CONTEXT_TOKENS),
            "--parallel",
            "1",
            "--n-predict",
            str(OUTPUT_TOKENS),
            "--gpu-layers",
            "all",
            "--fit",
            "off",
            "--jinja",
            "--reasoning",
            "off",
            "--reasoning-format",
            "deepseek",
            "--no-reasoning-preserve",
            "--no-context-shift",
            "--cache-ram",
            "0",
            "--no-cache-idle-slots",
            "--no-webui",
            "--no-mmproj",
            "--api-key-file",
            str(self.api_key_file),
            "--log-verbosity",
            "2",
        ]

    def start(self, timeout=180):
        if self.process is not None:
            raise RuntimeError("This process owner has already been started")
        if not self.executable.is_file() or not self.model.is_file():
            raise FileNotFoundError("Run bootstrap-gemma.sh before starting the model")
        from .gemma_assets import verify_runtime

        verify_runtime(self.directory, self.executable, self.model)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Fail before loading weights if a different process owns this port.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", self.port))
        _private_text(self.api_key_file, secrets.token_urlsafe(48) + "\n")
        self.log = os.fdopen(
            os.open(
                self.directory / "llama-server.log",
                os.O_WRONLY | os.O_CREAT | os.O_APPEND,
                0o600,
            ),
            "ab",
        )
        environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("LLAMA_", "MTMD_"))
        }
        self.process = subprocess.Popen(
            self.command(),
            stdin=subprocess.DEVNULL,
            stdout=self.log,
            stderr=self.log,
            env=environment,
        )
        engine = GemmaEngine(
            f"http://127.0.0.1:{self.port}",
            api_key_file=self.api_key_file,
            manifest_path=self.manifest_path,
        )
        until = time.monotonic() + timeout
        try:
            while time.monotonic() < until:
                if self.process.poll() is not None:
                    raise GemmaFailure("model_start_failed")
                try:
                    if engine.health():
                        engine.record_template()
                        return engine
                except GemmaFailure:
                    pass
                time.sleep(0.25)
            raise GemmaFailure("model_start_timeout")
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        if self.log:
            self.log.close()
            self.log = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--port", type=int, default=8791)
    args = parser.parse_args()
    from .gemma_assets import MODEL_FILE

    directory = Path(args.directory).resolve()
    process = GemmaProcess(
        directory / "llama-b11669" / "llama-server",
        directory / MODEL_FILE,
        directory,
        port=args.port,
    )
    stopped = threading.Event()
    for event in [signal.SIGINT, signal.SIGTERM]:
        signal.signal(event, lambda _signal, _frame: stopped.set())
    try:
        engine = process.start()
        print(
            json.dumps(
                {
                    "status": "ready",
                    "port": args.port,
                    "manifest": str(engine.manifest_path),
                }
            ),
            flush=True,
        )
        while not stopped.wait(0.5):
            if process.process.poll() is not None:
                raise GemmaFailure("model_process_exited")
    finally:
        process.close()


if __name__ == "__main__":
    main()
