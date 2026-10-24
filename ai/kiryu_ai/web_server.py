"""Private, invite-gated HTTP bridge to one local character model.

The public web client only submits a character, message and request UUID. Model
configuration, IF context, facts and conversation history stay on this machine.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import json
import os
import secrets
import time
from collections import OrderedDict, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from .data import load_profiles
from .masking import validate_messages
from .runtime import assemble_input, load_scenario_facts
from .session import SessionStore, scope_key

CHARACTERS = ("haruka", "majima")
PAGES_ORIGIN = "https://nam9nine.github.io"
MAX_BODY_BYTES = 16 * 1024
REQUEST_BODY_SECONDS = 10
KNOWN_CONTEXT = {
    "haruka": (
        "이 대화는 공식 원작 대사가 아닌 창작 IF 설정이다. 상대는 키류다. "
        "화면의 기존 문자에서 오늘 저녁은 카레로 정했고, 당근은 아직 남아 있으며, "
        "키류가 장을 보러 가기로 했다. 이 설정 이후 새로 온 문자에 답한다."
    ),
    "majima": (
        "이 대화는 공식 원작 대사가 아닌 창작 IF 설정이다. 상대는 키류다. "
        "화면의 기존 문자에서 마지마가 오늘 저녁 메뉴를 물었고 아이들의 안부를 "
        "궁금해했다. 아직 전달받지 않은 메뉴나 아이들의 상태는 지어내지 않는다."
    ),
}


def private_json(path, value):
    """Atomically replace a private local file without a world-readable window."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + "." + secrets.token_hex(8) + ".tmp")
    try:
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def read_private_json(path):
    if path.is_symlink():
        raise ValueError("Private state must not be a symbolic link")
    path.chmod(0o600)
    return json.loads(path.read_text(encoding="utf-8"))


def secret_digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def api_error(status, code, message):
    return JSONResponse(
        {"error": {"code": code, "message": message}},
        status_code=status,
        headers={"Cache-Control": "no-store"},
    )


class ApiFailure(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


class PrivacyMiddleware:
    """Reject foreign origins and suppress exceptions that might contain text."""

    def __init__(self, app, allowed_origins):
        self.app = app
        self.allowed_origins = set(allowed_origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def private_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"cache-control"
                ]
                message["headers"] = headers + [(b"cache-control", b"no-store")]
                if (
                    origins
                    and origins[0].decode("latin-1") in self.allowed_origins
                    and not any(
                        name.lower() == b"access-control-allow-origin"
                        for name, _ in headers
                    )
                ):
                    message["headers"].extend(
                        [
                            (b"access-control-allow-origin", origins[0]),
                            (b"vary", b"Origin"),
                        ]
                    )
            await send(message)

        origins = [value for name, value in scope["headers"] if name == b"origin"]
        if len(origins) > 1 or (
            origins and origins[0].decode("latin-1") not in self.allowed_origins
        ):
            response = api_error(403, "origin_denied", "허용되지 않은 웹 주소입니다.")
            await response(scope, receive, private_send)
            return
        try:
            await self.app(scope, receive, private_send)
        except ApiFailure as error:
            if not started:
                await api_error(error.status, error.code, error.message)(
                    scope, receive, private_send
                )
        except Exception:  # noqa: BLE001 -- exceptions can contain private prompts
            # Never send/log exception strings: upstream errors can include prompts.
            if not started:
                await api_error(500, "server_error", "서버 처리에 실패했습니다.")(
                    scope, receive, private_send
                )


class WindowLimiter:
    def __init__(self, capacity=256):
        self.capacity = capacity
        self.entries = OrderedDict()

    def allow(self, key, limit, window):
        now = time.monotonic()
        samples = self.entries.pop(key, deque())
        while samples and now - samples[0] >= window:
            samples.popleft()
        allowed = len(samples) < limit
        if allowed:
            samples.append(now)
        self.entries[key] = samples
        while len(self.entries) > self.capacity:
            self.entries.popitem(last=False)
        return allowed


class WebSessionStore(SessionStore):
    def append_generated(self, visitor, character, scenario, user, reply, job_id):
        key = scope_key(visitor, character, scenario)
        messages = self.history(*key)
        timestamp = datetime.now(UTC).isoformat()
        messages.extend(
            [
                {
                    "id": job_id + "-user",
                    "role": "user",
                    "content": user,
                    "time": timestamp,
                },
                {
                    "id": job_id + "-assistant",
                    "role": "assistant",
                    "content": reply,
                    "time": timestamp,
                },
            ]
        )
        private_json(self._path(key), {"scope": list(key), "messages": messages})
        self.sessions[key] = messages
        return messages


class ChatService:
    def __init__(
        self,
        data_root,
        *,
        model=None,
        adapter=None,
        engine_factory=None,
        access_file=None,
        queue_size=8,
        max_tokens=128,
        max_sessions=128,
        max_jobs_per_session=128,
        session_lifetime=30 * 24 * 60 * 60,
    ):
        if not 1 <= queue_size <= 8 or not 1 <= max_tokens < 2048:
            raise ValueError("Queue size must be 1–8 and output budget 1–2047")
        self.root = Path(data_root)
        self.directory = self.root / "web-sessions"
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory.chmod(0o700)
        self.jobs_directory = self.directory / "jobs"
        self.jobs_directory.mkdir(exist_ok=True, mode=0o700)
        self.access_file = Path(access_file or self.root / "web-access.json")
        if self.access_file.exists():
            self.invite_key = read_private_json(self.access_file)["invite_key"]
            if not isinstance(self.invite_key, str) or len(self.invite_key) < 32:
                raise ValueError("The access file requires a strong invite key")
        else:
            self.invite_key = secrets.token_urlsafe(32)
            private_json(self.access_file, {"invite_key": self.invite_key})
        self.auth_path = self.directory / "auth.json"
        self.tokens = (
            read_private_json(self.auth_path) if self.auth_path.exists() else {}
        )
        self.max_sessions = max_sessions
        self.max_jobs_per_session = max_jobs_per_session
        self.session_lifetime = session_lifetime
        self._expire_tokens()
        if len(self.tokens) > max_sessions:
            raise ValueError("Existing session count exceeds the configured limit")
        self.profiles = load_profiles(self.root / "data" / "profiles.json")
        self.registry, self.facts = load_scenario_facts(self.root)
        for character in CHARACTERS:
            if character not in self.registry.get("active_characters", CHARACTERS):
                raise ValueError("Both web characters must be active")
            if (
                self.profiles[character]["scenario_version"]
                != self.registry["scenario_version"]
            ):
                raise ValueError("Profile and knowledge scenario versions differ")
        selected_path = self.root / "selected-model.json"
        selected = (
            json.loads(selected_path.read_text()) if selected_path.exists() else {}
        )
        self.model = model or selected.get("model")
        self.adapter = adapter if model else adapter or selected.get("adapter")
        if not self.model:
            raise ValueError("Provide --model or an evaluated selected-model.json")
        self.engine_factory = engine_factory
        self.engine = None
        self.store = WebSessionStore(self.directory / "history")
        self.max_tokens = max_tokens
        self.status = "loading"
        self.pending = {}
        self.queue = asyncio.Queue(maxsize=queue_size)
        self.current_job = None
        # A stopped worker cannot accept new jobs, so this fallback is bounded
        # by one active job plus the configured queue size (at most nine jobs).
        self.failed_jobs = {}
        self.limiter = WindowLimiter()
        self.executor = None
        self.worker = None
        self._recover_jobs()

    def _expire_tokens(self):
        cutoff = time.time() - self.session_lifetime
        self.tokens = {
            digest: record
            for digest, record in self.tokens.items()
            if record["issued_at"] > cutoff
        }
        private_json(self.auth_path, self.tokens)

    def job_path(self, job_id):
        return self.jobs_directory / (str(UUID(job_id)) + ".json")

    def read_job(self, job_id):
        path = self.job_path(job_id)
        job_id = path.stem
        if job_id in self.failed_jobs:
            return self.failed_jobs[job_id]
        return read_private_json(path) if path.exists() else None

    def _saved_exchange(self, job):
        history = WebSessionStore(self.store.directory).history(
            job["visitor_id"], job["character"], job["scenario_version"]
        )
        for index in range(0, len(history) - 1, 2):
            user, assistant = history[index : index + 2]
            if (
                user["id"] == job["job_id"] + "-user"
                and user["role"] == "user"
                and user["content"] == job["message"]
                and assistant["id"] == job["job_id"] + "-assistant"
                and assistant["role"] == "assistant"
            ):
                return assistant["content"], history
        return None

    def _release_job(self, job):
        self.pending.pop(job["visitor_id"], None)
        self.queue.task_done()

    def _stop_jobs(self, code="server_unavailable"):
        """Terminate accepted work even when the job filesystem cannot be written."""
        self.status = "error"
        jobs = []
        if self.current_job is not None:
            jobs.append(self.current_job)
            self.current_job = None
        while not self.queue.empty():
            jobs.append(self.queue.get_nowait())
        for job in jobs:
            if job["status"] not in {"complete", "error"}:
                try:
                    saved = self._saved_exchange(job)
                except Exception:  # noqa: BLE001 -- storage failure has no public detail
                    saved = None
                if saved is not None:
                    job.update(status="complete", reply=saved[0], messages=saved[1])
                else:
                    job.update(
                        status="error",
                        error={
                            "code": code,
                            "message": "서버 처리 중 요청이 중단되었습니다. 서버 연결을 확인해 주세요.",
                        },
                    )
            self.failed_jobs[job["job_id"]] = job
            try:
                private_json(self.job_path(job["job_id"]), job)
            except Exception:  # noqa: BLE001, S110 -- fallback is retained; errors may contain private text
                pass
            self._release_job(job)

    def _recover_jobs(self):
        # Jobs are loaded one at a time; completed jobs never accumulate in RAM.
        for path in self.jobs_directory.glob("*.json"):
            job = read_private_json(path)
            if job["status"] not in {"queued", "generating"}:
                continue
            saved = self._saved_exchange(job)
            if saved is not None:
                job.update(status="complete", reply=saved[0], messages=saved[1])
            else:
                job.update(
                    status="error",
                    error={
                        "code": "server_restarted",
                        "message": "서버가 재시작되어 요청이 중단되었습니다. 다시 보내 주세요.",
                    },
                )
            private_json(path, job)

    def history(self, visitor, character):
        # Separate reader avoids cross-thread cache mutation during generation.
        return WebSessionStore(self.store.directory).history(
            visitor, character, self.profiles[character]["scenario_version"]
        )

    def authenticate(self, request):
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer ") or len(header) > 256:
            raise ApiFailure(401, "unauthorized", "연결 키로 먼저 연결해 주세요.")
        record = self.tokens.get(secret_digest(header[7:]))
        if not record or time.time() - record["issued_at"] >= self.session_lifetime:
            raise ApiFailure(
                401, "unauthorized", "연결이 만료되었습니다. 다시 연결해 주세요."
            )
        return record

    def issue_token(self, invite, address):
        # Both success and failure consume a bounded rate budget. Forwarded IP
        # headers are not trusted; the loopback tunnel is one shared budget.
        if not self.limiter.allow("invite:global", 60, 60) or not self.limiter.allow(
            "invite:" + address, 10, 60
        ):
            raise ApiFailure(429, "rate_limited", "잠시 후 다시 연결해 주세요.")
        if not hmac.compare_digest(invite.encode(), self.invite_key.encode()):
            raise ApiFailure(401, "invalid_invite", "연결 키를 확인해 주세요.")
        self._expire_tokens()
        if len(self.tokens) >= self.max_sessions:
            raise ApiFailure(
                503, "session_limit", "서버의 연결 수 한도에 도달했습니다."
            )
        token = secrets.token_urlsafe(32)
        self.tokens[secret_digest(token)] = {
            "visitor_id": uuid4().hex,
            "issued_at": time.time(),
            "job_count": 0,
        }
        private_json(self.auth_path, self.tokens)
        return token

    def submit(self, record, character, message, request_id):
        visitor = record["visitor_id"]
        identity = hashlib.sha256(
            (
                visitor
                + ":"
                + self.profiles[character]["scenario_version"]
                + ":"
                + request_id
            ).encode()
        ).digest()[:16]
        job_id = str(UUID(bytes=identity, version=4))
        path = self.job_path(job_id)
        fingerprint = secret_digest(
            json.dumps([character, message], ensure_ascii=False)
        )
        previous = self.read_job(job_id)
        if previous is not None:
            if previous["fingerprint"] != fingerprint:
                raise ApiFailure(
                    409, "request_id_conflict", "이미 다른 내용에 사용한 요청 ID입니다."
                )
            return previous
        if self.status != "ready":
            raise ApiFailure(
                503, "model_" + self.status, "로컬 모델이 아직 준비되지 않았습니다."
            )
        if visitor in self.pending:
            raise ApiFailure(
                409, "visitor_busy", "앞서 보낸 문자의 답변을 기다려 주세요."
            )
        if self.queue.full():
            raise ApiFailure(
                503, "queue_full", "대기열이 가득 찼습니다. 잠시 후 다시 보내 주세요."
            )
        if record["job_count"] >= self.max_jobs_per_session:
            raise ApiFailure(
                429, "session_limit", "이 연결의 요청 한도에 도달했습니다."
            )
        if not self.limiter.allow("chat:" + visitor, 12, 60):
            raise ApiFailure(429, "rate_limited", "잠시 후 다시 보내 주세요.")
        job = {
            "job_id": job_id,
            "visitor_id": visitor,
            "character": character,
            "scenario_version": self.profiles[character]["scenario_version"],
            "fingerprint": fingerprint,
            "request_id": request_id,
            "message": message,
            "accepted_at": datetime.now(UTC).isoformat(),
            "status": "queued",
        }
        # Write before queueing so disconnects cannot undo accepted requests.
        record["job_count"] += 1
        private_json(self.auth_path, self.tokens)
        private_json(path, job)
        self.pending[visitor] = job_id
        self.queue.put_nowait(job)
        return job

    def _load_engine(self):
        factory = self.engine_factory
        if factory is None:
            from .inference import LocalModel

            factory = LocalModel
        self.engine = factory(self.model, self.adapter)

    def _unload_engine(self):
        self.engine = None

    def _generate(self, job):
        character = job["character"]
        profile = self.profiles[character]
        store = WebSessionStore(self.store.directory)
        messages, _ = assemble_input(
            profile,
            store,
            job["visitor_id"],
            job["message"],
            known_context=KNOWN_CONTEXT[character],
            facts=self.facts,
            allowed_fact_ids=[item["id"] for item in self.registry["adopted_facts"]],
        )
        try:
            result = self.engine.reply(messages, seed=42, max_tokens=self.max_tokens)
        except ValueError:
            raise ApiFailure(
                422,
                "context_limit",
                "대화가 모델의 입력 한도를 넘었습니다. 기존 대화는 삭제하지 않았습니다.",
            ) from None
        if result.get("finish_reason") == "length":
            raise ApiFailure(
                422,
                "output_limit",
                "답변이 출력 한도에서 중단되어 저장하지 않았습니다.",
            )
        reply = result.get("reply")
        if not isinstance(reply, str) or not reply.strip() or "\x00" in reply:
            raise ApiFailure(502, "empty_reply", "모델이 답변을 생성하지 못했습니다.")
        if result.get("finish_reason") not in {"stop", "eos"}:
            raise ApiFailure(
                502, "generation_failed", "모델의 답변이 정상적으로 끝나지 않았습니다."
            )
        try:
            # Validate the exact contract render_prompt will use on the next
            # turn before making this generated answer part of durable history.
            validate_messages(
                messages
                + [
                    {"role": "assistant", "content": reply},
                    {"role": "user", "content": "다음 문자"},
                ],
                final_role="user",
            )
        except (ValueError, TypeError):
            raise ApiFailure(
                502,
                "generation_error",
                "모델의 답변 형식이 올바르지 않아 대화에 저장하지 않았습니다.",
            ) from None
        history = store.append_generated(
            job["visitor_id"],
            character,
            profile["scenario_version"],
            job["message"],
            reply,
            job["job_id"],
        )
        return reply, history

    async def run(self):
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(self.executor, self._load_engine)
        except Exception:  # noqa: BLE001 -- expose only a sanitized readiness state
            self.status = "error"
            return
        self.status = "ready"
        try:
            while True:
                job = self.current_job = await self.queue.get()
                job["status"] = "generating"
                private_json(self.job_path(job["job_id"]), job)
                try:
                    reply, history = await loop.run_in_executor(
                        self.executor, self._generate, job
                    )
                    job.update(status="complete", reply=reply, messages=history)
                except ApiFailure as error:
                    job.update(
                        status="error",
                        error={"code": error.code, "message": error.message},
                    )
                except OSError:
                    # Storage failures are fatal; do not consume further GPU work.
                    raise
                except Exception:  # noqa: BLE001 -- never expose model exception text
                    job.update(
                        status="error",
                        error={
                            "code": "generation_failed",
                            "message": "로컬 모델의 응답 생성에 실패했습니다.",
                        },
                    )
                private_json(self.job_path(job["job_id"]), job)
                self._release_job(job)
                self.current_job = None
        except Exception:  # noqa: BLE001 -- terminalize all accepted work on worker failure
            self._stop_jobs()

    async def start(self):
        self.executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="character-model"
        )
        self.worker = asyncio.create_task(self.run())
        self.worker.add_done_callback(self._worker_done)

    def _worker_done(self, task):
        if not task.cancelled() and task.exception() is not None:
            self._stop_jobs()

    async def close(self):
        self.worker.cancel()
        try:
            await self.worker
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001 -- worker errors must not skip model cleanup
            self.status = "error"
        finally:
            try:
                # Destruction runs on the model thread after any active reply.
                await asyncio.get_running_loop().run_in_executor(
                    self.executor, self._unload_engine
                )
            finally:
                try:
                    await asyncio.to_thread(
                        self.executor.shutdown, wait=True, cancel_futures=True
                    )
                finally:
                    self._stop_jobs("server_stopped")


async def json_body(request):
    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip()
        != "application/json"
    ):
        raise ApiFailure(415, "content_type", "JSON 요청이 필요합니다.")
    length = request.headers.get("content-length")
    if length is not None:
        try:
            too_large = int(length) > MAX_BODY_BYTES or int(length) < 0
        except ValueError:
            raise ApiFailure(400, "invalid_body", "잘못된 요청입니다.") from None
        if too_large:
            raise ApiFailure(413, "body_too_large", "요청 크기가 너무 큽니다.")
    body = bytearray()
    try:
        async with asyncio.timeout(REQUEST_BODY_SECONDS):
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_BODY_BYTES:
                    raise ApiFailure(413, "body_too_large", "요청 크기가 너무 큽니다.")
                body.extend(chunk)
    except TimeoutError:
        raise ApiFailure(
            408, "request_timeout", "요청 전송 시간이 초과되었습니다."
        ) from None
    try:
        value = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise ApiFailure(
            400, "invalid_body", "올바른 JSON 요청이 필요합니다."
        ) from None
    if not isinstance(value, dict):
        raise ApiFailure(400, "invalid_body", "JSON 객체가 필요합니다.")
    return value


def public_job(job):
    result = {
        key: job[key]
        for key in ("job_id", "character", "status", "reply", "error", "messages")
        if key in job
    }
    # Older job files predate request metadata; never invent their UUID or time.
    if "request_id" in job and "accepted_at" in job:
        result["request"] = {
            "id": job["request_id"],
            "message": job["message"],
            "time": job["accepted_at"],
        }
    return result


def create_app(data_root, *, allow_origins=(), **options):
    origins = [PAGES_ORIGIN, *allow_origins]
    for origin in allow_origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.port is None
        ):
            raise ValueError(
                "Additional origins must be explicit localhost origins with ports"
            )
    service = ChatService(data_root, **options)

    @asynccontextmanager
    async def lifespan(app):
        await service.start()
        try:
            yield
        finally:
            await service.close()

    async def health(request):
        return JSONResponse(
            {
                "service": "kiryu-character-chat-v1",
                "status": service.status,
                "characters": list(CHARACTERS),
            }
        )

    async def sessions(request):
        body = await json_body(request)
        invite = body.get("invite_key")
        if not isinstance(invite, str) or not 1 <= len(invite) <= 256:
            raise ApiFailure(400, "invalid_invite", "연결 키를 입력해 주세요.")
        try:
            invite.encode("utf-8")
        except UnicodeEncodeError:
            raise ApiFailure(
                400, "invalid_invite", "연결 키를 확인해 주세요."
            ) from None
        if set(body) - {"invite_key", "visitor_id"}:
            raise ApiFailure(400, "invalid_body", "지원하지 않는 요청 항목입니다.")
        token = service.issue_token(
            invite, request.client.host if request.client else "unknown"
        )
        return JSONResponse({"token": token})

    async def history(request):
        record = service.authenticate(request)
        character = request.query_params.get("character")
        if character not in CHARACTERS:
            raise ApiFailure(400, "invalid_character", "지원하지 않는 대화 상대입니다.")
        pending_job = service.pending.get(record["visitor_id"])
        if pending_job:
            pending = service.read_job(pending_job)
            if pending["character"] != character:
                pending_job = None
        return JSONResponse(
            {
                "messages": service.history(record["visitor_id"], character),
                "pending_job": pending_job,
            }
        )

    async def chat(request):
        record = service.authenticate(request)
        body = await json_body(request)
        if set(body) - {"character", "message", "request_id", "visitor_id"}:
            raise ApiFailure(
                400,
                "invalid_body",
                "대화 이력이나 시스템 설정을 직접 보낼 수 없습니다.",
            )
        character, message = body.get("character"), body.get("message")
        if character not in CHARACTERS:
            raise ApiFailure(400, "invalid_character", "지원하지 않는 대화 상대입니다.")
        if not isinstance(message, str) or not message.strip() or "\x00" in message:
            raise ApiFailure(400, "invalid_message", "보낼 문자를 입력해 주세요.")
        try:
            valid_size = len(message) <= 1000 and len(message.encode("utf-8")) <= 4096
            request_id = str(UUID(body["request_id"]))
        except (ValueError, TypeError, KeyError, AttributeError, UnicodeEncodeError):
            raise ApiFailure(
                400, "invalid_request", "올바른 문자와 요청 UUID가 필요합니다."
            ) from None
        if not valid_size:
            raise ApiFailure(
                413,
                "message_too_long",
                "문자는 1,000자와 4,096바이트 이내로 보내 주세요.",
            )
        try:
            validate_messages([{"role": "user", "content": message}], final_role="user")
        except (ValueError, TypeError):
            raise ApiFailure(
                400,
                "invalid_message",
                "문자에 지원하지 않는 제어 구문이 포함되어 있습니다.",
            ) from None
        job = service.submit(record, character, message, request_id)
        return JSONResponse(
            {"job_id": job["job_id"], "status": job["status"]}, status_code=202
        )

    async def job_status(request):
        record = service.authenticate(request)
        try:
            job = service.read_job(request.path_params["job_id"])
        except ValueError:
            job = None
        if (
            not job
            or job["visitor_id"] != record["visitor_id"]
            or job["scenario_version"]
            != service.profiles[job["character"]]["scenario_version"]
        ):
            raise ApiFailure(404, "job_not_found", "요청을 찾을 수 없습니다.")
        return JSONResponse(public_job(job))

    app = Starlette(
        routes=[
            Route("/v1/health", health),
            Route("/v1/sessions", sessions, methods=["POST"]),
            Route("/v1/history", history),
            Route("/v1/chat", chat, methods=["POST"]),
            Route("/v1/jobs/{job_id}", job_status),
        ],
        lifespan=lifespan,
    )
    app.state.service = service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=0,
    )
    app.add_middleware(PrivacyMiddleware, allowed_origins=origins)
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--model")
    parser.add_argument("--adapter")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--allow-origin", action="append", default=[])
    parser.add_argument("--access-file")
    parser.add_argument("--max-tokens", type=int, default=128)
    args = parser.parse_args()
    if args.max_tokens < 1 or args.max_tokens >= 2048:
        parser.error("max-tokens must be between 1 and 2047")
    app = create_app(
        args.data_root,
        model=args.model,
        adapter=args.adapter,
        access_file=args.access_file,
        allow_origins=args.allow_origin,
        max_tokens=args.max_tokens,
    )
    import uvicorn

    # Access logs can include arbitrary request paths. Do not record them.
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        access_log=False,
        proxy_headers=False,
        limit_concurrency=64,
        backlog=64,
        timeout_keep_alive=5,
        timeout_graceful_shutdown=15,
    )


if __name__ == "__main__":
    main()
