"""SQLite-backed anonymous chat API for the fixed Gemma deployment.

Legacy MLX experiments remain in web_server.py. This service exposes no owner,
model configuration, database, or prompt-writing endpoints.
"""

from __future__ import annotations

import argparse
import asyncio
import fcntl
import hashlib
import hmac
import json
import os
import re
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from .chat_db import (
    MAX_ACTIVE_PER_VISITOR,
    RELATIONSHIP_TONES,
    ChatDB,
    RequestConflict,
    VisitorBusy,
)
from .chat_policy import POLICY_MESSAGE, explicit_request, output_allowed
from .phone_events import NO_PHONE_EVENTS, validate_phone_events
from .web_server import ApiFailure, PrivacyMiddleware, WindowLimiter, json_body

CHARACTERS = ("haruka", "majima")
SCENARIO = "daily-if-v1"
PAGES_ORIGIN = "https://nam9nine.github.io"
CHAT_ASSETS = Path(__file__).resolve().parents[1] / "chat"
ERROR_TEXT = {
    "content_blocked": POLICY_MESSAGE,
    "output_limit": "답장이 끝나지 않았습니다. 다시 보내 주세요.",
    "context_limit": "메시지를 조금 짧게 나누어 보내 주세요. 기존 대화는 보관됩니다.",
    "timeout": "답장 시간이 초과되었습니다. 잠시 후 다시 보내 주세요.",
    "generation_timeout": "답장 시간이 초과되었습니다. 잠시 후 다시 보내 주세요.",
    "interrupted": "요청 처리가 중단되었습니다. 다시 보내 주세요.",
}


def verified_manifest(manifest_path, api_key_file):
    """Read an existing install record and verify the pinned files, never repair it."""
    from . import gemma_assets as assets
    from .gemma_engine import (
        CONTEXT_TOKENS,
        GENERATION_TIMEOUT,
        OUTPUT_TOKENS,
        REASONING_TOKENS,
        SAMPLING,
    )

    path = Path(manifest_path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1_000_000:
        raise ValueError("A complete verified runtime manifest is required")
    key = Path(api_key_file) if api_key_file else None
    if (
        key is None
        or key.is_symlink()
        or not key.is_file()
        or key.stat().st_mode & 0o077
        or not 32 <= len(key.read_text().strip()) <= 256
    ):
        raise ValueError("A private model API key file is required")
    manifest = json.loads(path.read_text())
    expected = {
        "schema_version": 1,
        "llama_version": assets.LLAMA_VERSION,
        "llama_commit": assets.LLAMA_COMMIT,
        "binary_tag": assets.BINARY_TAG,
        "archive_sha256": assets.BINARY_SHA256,
        "model_repo": assets.MODEL_REPO,
        "model_revision": assets.MODEL_REVISION,
        "model_file": assets.MODEL_FILE,
        "model_bytes": assets.MODEL_BYTES,
        "model_sha256": assets.MODEL_SHA256,
        "executable": f"llama-{assets.BINARY_TAG}/llama-server",
        "context_tokens": CONTEXT_TOKENS,
        "sampling": SAMPLING,
        "thinking": True,
        "reasoning_budget_tokens": REASONING_TOKENS,
        "max_output_tokens": OUTPUT_TOKENS,
        "generation_timeout_seconds": GENERATION_TIMEOUT,
        "cache_prompt": False,
    }
    if not isinstance(manifest, dict) or any(
        manifest.get(field) != value for field, value in expected.items()
    ):
        raise ValueError("Runtime manifest does not match the pinned deployment")
    if not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get("template_sha256", ""))):
        raise ValueError("The verified runtime must already record its template")
    directory = path.resolve().parent
    executable = directory / expected["executable"]
    model = directory / assets.MODEL_FILE
    # Verifies the archive pin, extracted executable/libraries and the full GGUF.
    assets.verify_runtime(directory, executable, model)
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise ValueError("Runtime file hashes are missing")
    actual_files = {
        str(file.relative_to(directory)): file
        for file in executable.parent.iterdir()
        if file.is_file() and not file.is_symlink()
    }
    recorded = set()
    for entry in entries:
        name = entry.get("path") if isinstance(entry, dict) else None
        if not isinstance(name, str) or name in recorded or name not in actual_files:
            raise ValueError("Runtime file inventory does not match the installation")
        file = actual_files[name]
        if entry.get("bytes") != file.stat().st_size or entry.get(
            "sha256"
        ) != assets.sha256(file):
            raise ValueError("Runtime file metadata does not match the verified file")
        recorded.add(name)
    if recorded != set(actual_files):
        raise ValueError("Runtime manifest omits installed files")
    return manifest, directory


def verify_native_server(engine, manifest, directory):
    """Compare the live server to the prior install record without rewriting it."""
    from .gemma_engine import CONTEXT_TOKENS, MODEL_ALIAS

    props = engine._json("/props")
    template = props.get("chat_template")
    settings = props.get("default_generation_settings", {})
    # v0.7.0 serializes a fresh task_params in /props: reasoning_format stays
    # NONE there even when CLI reasoning is on. The pinned native template and
    # per-request flags govern parsing; real reasoning is verified separately.
    if (
        not isinstance(template, str)
        or hashlib.sha256(template.encode()).hexdigest() != manifest["template_sha256"]
        or props.get("model_path") != str(directory / manifest["model_file"])
        or props.get("model_alias") != MODEL_ALIAS
        or props.get("build_info")
        != f"{manifest['binary_tag']}-{manifest['llama_commit'][:9]}"
        or props.get("total_slots") != 1
        or settings.get("n_ctx") != CONTEXT_TOKENS
        or settings.get("params", {}).get("reasoning_format") != "none"
        or settings.get("params", {}).get("lora") != []
        or props.get("modalities") != {"vision": False, "video": False, "audio": False}
    ):
        raise ValueError("Running model does not match the verified deployment")


def public_job(job):
    status = job["status"]
    result = {
        "job_id": job["job_id"],
        "character": job["character"],
        "status": status if status in {"queued", "generating", "complete"} else "error",
        "request": {
            "id": job["request_id"],
            "message": job["message"],
            "time": job["accepted_at"],
            "relationship_tone": job.get("relationship_tone", "neutral"),
            "phone_events": job.get("phone_events", []),
        },
    }
    if status == "complete":
        result["reply"] = job.get("reply", "")
    elif result["status"] == "error":
        code = job.get("error_code") or (job.get("error") or {}).get(
            "code", "generation_failed"
        )
        result["error"] = {
            "code": code,
            "message": ERROR_TEXT.get(
                code, "답장을 만들지 못했습니다. 다시 보내 주세요."
            ),
        }
    return result


class ChatService:
    def __init__(
        self,
        data_root,
        *,
        engine_factory=None,
        builder=None,
        queue_size=8,
        model_url="http://127.0.0.1:8791",
        manifest_path=None,
        api_key_file=None,
        embedding_dir=None,
        gateway_secret=None,
        push_sender=None,
    ):
        if not 1 <= queue_size <= 8:
            raise ValueError("queue_size must be 1–8")
        self.root = Path(data_root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = ChatDB(self.root / "chat.sqlite3")
        if engine_factory is None and (not manifest_path or not api_key_file):
            raise ValueError(
                "Production serving requires a manifest and private model key"
            )
        self.engine_factory = engine_factory
        self.builder = builder
        self.model_url = model_url
        self.manifest_path = manifest_path
        self.api_key_file = api_key_file
        self.embedding_dir = embedding_dir
        self.gateway_secret = gateway_secret
        self.queue = asyncio.Queue(maxsize=queue_size)
        self.pending = {}
        self.status = "loading"
        self.limiter = WindowLimiter(capacity=4096)
        self.engine = None
        self.executor = None
        self.worker = None
        self.backup_task = None
        self.push_worker = None
        self.push_executor = None
        self.push = None
        self.push_error = None
        try:
            from .chat_push import ChatPush

            self.push = ChatPush(self.root / "push", self.db, sender=push_sender)
        except (ImportError, OSError, ValueError, TypeError, sqlite3.Error):
            # Optional notifications cannot disable durable chat or expose keys.
            self.push_error = "initialization_failed"
        self.lock = None

    def address(self, request):
        # Only our Worker knows this value. Browser-supplied forwarded IP headers
        # are never trusted, including when the API is used directly on localhost.
        proof = request.headers.get("x-kiryu-gateway", "")
        if self.gateway_secret and hmac.compare_digest(proof, self.gateway_secret):
            return request.headers.get("x-kiryu-client-ip", "unknown")[:64]
        return request.client.host if request.client else "unknown"

    def authenticate(self, request):
        header = request.headers.get("authorization", "")
        record = (
            self.db.authenticate(header[7:])
            if header.startswith("Bearer ") and len(header) < 256
            else None
        )
        if record is None:
            raise ApiFailure(401, "unauthorized", "대화 연결이 만료되었습니다.")
        return record

    def issue_token(self, address):
        if not self.limiter.allow("session:global", 60, 60) or not self.limiter.allow(
            "session:" + address, 10, 60
        ):
            raise ApiFailure(429, "rate_limited", "잠시 후 다시 시도해 주세요.")
        return self.db.issue_session()["token"]

    def submit(
        self,
        record,
        character,
        message,
        request_id,
        address,
        relationship_tone="neutral",
        phone_events=NO_PHONE_EVENTS,
    ):
        visitor = record["visitor_id"]
        if relationship_tone not in RELATIONSHIP_TONES:
            raise ApiFailure(
                400, "invalid_relationship_tone", "지원하지 않는 인연 상태입니다."
            )
        try:
            phone_events = validate_phone_events(
                character, [] if phone_events is NO_PHONE_EVENTS else phone_events
            )
        except ValueError:
            raise ApiFailure(
                400, "invalid_phone_events", "올바른 전화·할 일 상태가 필요합니다."
            ) from None
        scope = (visitor, character, SCENARIO)
        # Existing UUIDs must remain discoverable even while the queue/model is
        # unavailable. accept() checks the fingerprint again in its transaction.
        previous = self.db.find_request(visitor, SCENARIO, request_id)
        if previous:
            if (
                previous["character"] != character
                or previous["message"] != message
                or previous.get("relationship_tone", "neutral") != relationship_tone
                or previous.get("phone_events", []) != phone_events
            ):
                raise ApiFailure(
                    409, "request_id_conflict", "다른 내용에 사용한 요청 ID입니다."
                )
            return previous
        if explicit_request(message):
            raise ApiFailure(400, "content_blocked", POLICY_MESSAGE)
        if self.status != "ready":
            raise ApiFailure(
                503,
                "model_unavailable",
                "지금은 답장을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.",
            )
        if (
            scope in self.pending
            or sum(key[0] == visitor for key in self.pending) >= MAX_ACTIVE_PER_VISITOR
        ):
            raise ApiFailure(
                409,
                "conversation_busy",
                "이 연락처의 답장을 기다려 주세요. 다른 연락처에는 보낼 수 있습니다.",
            )
        if self.queue.full():
            raise ApiFailure(
                503,
                "queue_full",
                "대기 중인 대화가 많습니다. 잠시 후 다시 보내 주세요.",
            )
        if not self.limiter.allow(
            "chat:ip:" + address, 36, 60
        ) or not self.limiter.allow("chat:" + visitor, 12, 60):
            raise ApiFailure(429, "rate_limited", "잠시 후 다시 보내 주세요.")
        try:
            job, created = self.db.accept(
                visitor,
                character,
                SCENARIO,
                message,
                request_id,
                relationship_tone=relationship_tone,
                phone_events=phone_events,
            )
        except RequestConflict:
            raise ApiFailure(
                409, "request_id_conflict", "다른 내용에 사용한 요청 ID입니다."
            ) from None
        except VisitorBusy:
            raise ApiFailure(
                409,
                "conversation_busy",
                "이 연락처의 답장을 기다려 주세요. 다른 연락처에는 보낼 수 있습니다.",
            ) from None
        if created:
            self.pending[scope] = job["job_id"]
            self.queue.put_nowait(job)
        return job

    def _load_engine(self):
        from .chat_prompt import ChatPromptBuilder
        from .gemma_engine import GemmaEngine

        if self.engine_factory:
            self.engine = self.engine_factory()
        else:
            manifest, directory = verified_manifest(
                self.manifest_path, self.api_key_file
            )
            self.engine = GemmaEngine(
                base_url=self.model_url,
                manifest_path=self.manifest_path,
                api_key_file=self.api_key_file,
            )
            if self.engine.manifest != manifest:
                raise ValueError("Runtime manifest changed while connecting")
            verify_native_server(self.engine, manifest, directory)
        if self.builder is None:
            from .chat_reader import EvidenceReader
            from .chat_retrieval import E5Onnx, HybridRetriever

            if not self.embedding_dir:
                raise ValueError(
                    "Production chat requires the pinned embedding directory"
                )
            retriever = HybridRetriever(
                CHAT_ASSETS / "registry.json", E5Onnx(self.embedding_dir)
            )
            self.builder = ChatPromptBuilder(
                CHAT_ASSETS / "registry.json",
                CHAT_ASSETS / "cards.json",
                retriever,
                reader=EvidenceReader(
                    GemmaEngine(
                        base_url=self.model_url,
                        api_key_file=self.api_key_file,
                        manifest_path=self.manifest_path,
                        thinking=False,
                    )
                ),
            )
        # Connection only validates existing provenance; the process owner records
        # the initial template after verifying and starting its pinned binary.
        self.engine.count_tokens(
            [
                {"role": "system", "content": "한국어 문자로 답한다."},
                {"role": "user", "content": "준비 확인"},
            ]
        )

    def _generate(self, job):
        from .chat_prompt import InputBudgetError
        from .gemma_engine import CONTEXT_TOKENS, OUTPUT_TOKENS, SAMPLING, GemmaFailure

        started = time.monotonic()
        queue_seconds = max(
            0, time.time() - datetime.fromisoformat(job["accepted_at"]).timestamp()
        )

        def timings(partial=None):
            metrics = {k: v for k, v in (partial or {}).items() if k != "reply"}
            metrics["generation_seconds"] = metrics.get("total_seconds")
            metrics["service_seconds"] = metrics["total_seconds"] = (
                time.monotonic() - started
            )
            metrics["queue_seconds"] = queue_seconds
            return metrics

        run_started = False

        def record_stage(assembled):
            nonlocal run_started
            manifest = getattr(self.engine, "manifest", {})
            metadata = {
                **assembled["metadata"],
                "model": manifest.get("model_file", "test-engine"),
                "model_manifest": manifest,
                "sampling": SAMPLING,
                "seed": None,
            }
            record = self.db.record_run_input if run_started else self.db.begin_run
            record(
                job["job_id"],
                assembled["messages"],
                metadata,
                assembled["retrieval_hits"],
            )
            run_started = True

        try:
            history = self.db.history(job["visitor_id"], job["character"], SCENARIO)
            assembled = self.builder.build(
                visitor_id=job["visitor_id"],
                character_id=job["character"],
                scenario_version=SCENARIO,
                user_message=job["message"],
                relationship_tone=job.get("relationship_tone", "neutral"),
                phone_events=job.get("phone_events", []),
                history=history,
                count_tokens=self.engine.count_tokens,
                context_limit=CONTEXT_TOKENS,
                max_tokens=OUTPUT_TOKENS,
                on_stage=record_stage,
            )
            record_stage(assembled)
            result = self.engine.reply(assembled["messages"], max_tokens=OUTPUT_TOKENS)
            metrics = timings(result)
            if result.get("finish_reason") not in {"stop", "eos"}:
                code = (
                    "output_limit"
                    if result.get("finish_reason") == "length"
                    else "generation_failed"
                )
                self.db.fail(
                    job["job_id"], code, output=result.get("reply", ""), metrics=metrics
                )
            elif (
                not isinstance(result.get("reply"), str) or not result["reply"].strip()
            ):
                self.db.fail(job["job_id"], "empty_reply", metrics=metrics)
            elif not output_allowed(result["reply"]):
                self.db.fail(
                    job["job_id"],
                    "content_blocked",
                    output=result["reply"],
                    metrics=metrics,
                )
            else:
                self.db.complete(job["job_id"], result["reply"], metrics=metrics)
        except GemmaFailure as error:
            partial = getattr(error, "result", {}) or {}
            self.db.fail(
                job["job_id"],
                error.code,
                output=partial.get("reply", ""),
                metrics=timings(partial),
            )
        except InputBudgetError:
            self.db.fail(job["job_id"], "context_limit", metrics=timings())
        except Exception:  # noqa: BLE001 -- never log private prompts or provider errors
            self.db.fail(job["job_id"], "generation_failed", metrics=timings())

    async def run(self):
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(self.executor, self._load_engine)
        except Exception:  # noqa: BLE001 -- model exceptions can contain prompts
            self.status = "error"
            return
        self.status = "ready"
        while True:
            job = await self.queue.get()
            try:
                await loop.run_in_executor(self.executor, self._generate, job)
            except Exception:  # noqa: BLE001 -- DB failures stop acceptance
                self.status = "error"
                self.db.recover_interrupted()
                return
            finally:
                scope = (job["visitor_id"], job["character"], job["scenario_version"])
                if self.pending.get(scope) == job["job_id"]:
                    self.pending.pop(scope)
                self.queue.task_done()

    async def backups(self):
        while True:
            try:
                await asyncio.to_thread(self.db.backup, self.root / "backups")
                self.backup_failed = False
            except Exception:  # noqa: BLE001 -- do not expose private storage paths
                self.backup_failed = True
            await asyncio.sleep(3600)

    async def pushes(self):
        loop = asyncio.get_running_loop()
        while True:
            try:
                await loop.run_in_executor(self.push_executor, self.push.tick)
                self.push_error = None
            except (OSError, sqlite3.Error, ValueError, TypeError, RuntimeError):
                # Retain only a fixed diagnostic code, never provider bodies.
                self.push_error = "delivery_failed"
            await asyncio.sleep(1)

    async def start(self):
        self.lock = await asyncio.to_thread(open, self.root / "chat.lock", "a")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lock.close()
            raise RuntimeError("Another chat service owns this database") from None
        self.db.recover_interrupted()
        self.executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="gemma-chat"
        )
        self.worker = asyncio.create_task(self.run())
        self.backup_task = asyncio.create_task(self.backups())
        if self.push:
            self.push_executor = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="chat-push"
            )
            self.push_worker = asyncio.create_task(self.pushes())

    async def close(self):
        self.status = "error"
        for task in (self.worker, self.backup_task, self.push_worker):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        if self.executor:
            await asyncio.to_thread(
                self.executor.shutdown, wait=True, cancel_futures=True
            )
        if self.push_executor:
            await asyncio.to_thread(
                self.push_executor.shutdown, wait=True, cancel_futures=True
            )
        self.db.recover_interrupted()
        if self.lock:
            self.lock.close()


def create_app(data_root, *, allow_origins=(), **options):
    origins = [PAGES_ORIGIN]
    for origin in allow_origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or not parsed.port
        ):
            raise ValueError("Extra origins must be explicit loopback origins")
        origins.append(origin)
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
                "service": "kiryu-character-chat-v2",
                "status": service.status,
                "characters": list(CHARACTERS),
            }
        )

    async def sessions(request):
        if await json_body(request):
            raise ApiFailure(400, "invalid_body", "지원하지 않는 요청 항목입니다.")
        return JSONResponse({"token": service.issue_token(service.address(request))})

    async def history(request):
        record = service.authenticate(request)
        character = request.query_params.get("character")
        if character not in CHARACTERS:
            raise ApiFailure(400, "invalid_character", "지원하지 않는 대화 상대입니다.")
        try:
            page = service.db.history_page(
                record["visitor_id"],
                character,
                SCENARIO,
                cursor=request.query_params.get("cursor"),
                limit=50,
            )
        except ValueError:
            raise ApiFailure(
                400, "invalid_cursor", "대화 페이지를 다시 불러와 주세요."
            ) from None
        pending = service.pending.get((record["visitor_id"], character, SCENARIO))
        return JSONResponse({**page, "pending_job": pending})

    async def chat(request):
        record = service.authenticate(request)
        body = await json_body(request)
        required = {"character", "message", "request_id"}
        if not required <= set(body) or set(body) - required - {
            "relationship_tone",
            "phone_events",
        }:
            raise ApiFailure(400, "invalid_body", "지원하지 않는 요청 항목입니다.")
        character, message = body["character"], body["message"]
        relationship_tone = body.get("relationship_tone", "neutral")
        if relationship_tone not in RELATIONSHIP_TONES:
            raise ApiFailure(
                400, "invalid_relationship_tone", "지원하지 않는 인연 상태입니다."
            )
        if character not in CHARACTERS:
            raise ApiFailure(400, "invalid_character", "지원하지 않는 대화 상대입니다.")
        if not isinstance(message, str) or not message.strip() or "\x00" in message:
            raise ApiFailure(400, "invalid_message", "보낼 문자를 입력해 주세요.")
        try:
            valid = len(message) <= 1000 and len(message.encode()) <= 4096
            request_id = str(UUID(body["request_id"]))
        except (ValueError, TypeError, AttributeError, UnicodeEncodeError):
            raise ApiFailure(
                400, "invalid_request", "올바른 문자와 UUID가 필요합니다."
            ) from None
        if not valid:
            raise ApiFailure(
                413, "message_too_long", "문자는 1,000자 이내로 보내 주세요."
            )
        from .gemma_engine import CONTROL

        if CONTROL.search(message):
            raise ApiFailure(400, "invalid_message", "지원하지 않는 제어 구문입니다.")
        job = service.submit(
            record,
            character,
            message,
            request_id,
            service.address(request),
            relationship_tone=relationship_tone,
            phone_events=body.get("phone_events", []),
        )
        return JSONResponse(
            {"job_id": job["job_id"], "status": public_job(job)["status"]},
            status_code=202,
        )

    async def job_status(request):
        record = service.authenticate(request)
        try:
            job_id = str(UUID(request.path_params["job_id"]))
        except (ValueError, TypeError):
            raise ApiFailure(404, "job_not_found", "요청을 찾을 수 없습니다.") from None
        job = service.db.get_request(job_id, visitor=record["visitor_id"])
        if not job or job["scenario_version"] != SCENARIO:
            raise ApiFailure(404, "job_not_found", "요청을 찾을 수 없습니다.")
        return JSONResponse(public_job(job))

    def push_access(request, *, foreground=False):
        record = service.authenticate(request)
        if service.push is None:
            raise ApiFailure(
                503, "push_unavailable", "알림 연결을 준비하지 못했습니다."
            )
        if not service.limiter.allow(
            ("presence:" if foreground else "push:") + record["visitor_id"],
            90 if foreground else 20,
            60,
        ):
            raise ApiFailure(429, "rate_limited", "잠시 후 다시 시도해 주세요.")
        return record

    async def push_key(request):
        push_access(request)
        return JSONResponse({"public_key": service.push.public_key})

    async def push_subscriptions(request):
        from .chat_push import SubscriptionConflict

        body = await json_body(request)
        foreground = request.method == "POST" and set(body) == {"presence"}
        record = push_access(request, foreground=foreground)
        try:
            if foreground:
                service.push.foreground(record["visitor_id"], body["presence"])
                return JSONResponse({"ok": True})
            if request.method == "DELETE":
                if set(body) != {"endpoint"}:
                    raise ValueError("Invalid unsubscribe body")
                service.push.unsubscribe(record["visitor_id"], body["endpoint"])
                return JSONResponse({"ok": True})
            if set(body) != {"subscription", "platform"} or body["platform"] != "web":
                raise ValueError("Invalid subscription body")
            identifier = service.push.subscribe(
                record["visitor_id"], body["subscription"]
            )
            return JSONResponse({"id": identifier})
        except SubscriptionConflict:
            raise ApiFailure(
                409,
                "push_subscription_conflict",
                "기존 알림 연결을 끈 뒤 다시 연결해 주세요.",
            ) from None
        except (ValueError, TypeError):
            raise ApiFailure(
                400, "invalid_push_subscription", "알림 연결 정보를 확인해 주세요."
            ) from None

    app = Starlette(
        routes=[
            Route("/v1/health", health),
            Route("/v1/sessions", sessions, methods=["POST"]),
            Route("/v1/history", history),
            Route("/v1/chat", chat, methods=["POST"]),
            Route("/v1/jobs/{job_id}", job_status),
            Route("/v1/push/key", push_key),
            Route(
                "/v1/push/subscriptions", push_subscriptions, methods=["POST", "DELETE"]
            ),
        ],
        lifespan=lifespan,
    )
    app.state.service = service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=0,
    )
    app.add_middleware(PrivacyMiddleware, allowed_origins=origins)
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--model-url", default="http://127.0.0.1:8791")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--api-key-file")
    parser.add_argument("--embedding-dir", required=True)
    parser.add_argument("--allow-origin", action="append", default=[])
    args = parser.parse_args()
    app = create_app(
        args.data_root,
        model_url=args.model_url,
        manifest_path=args.manifest,
        api_key_file=args.api_key_file,
        embedding_dir=args.embedding_dir,
        allow_origins=args.allow_origin,
        gateway_secret=os.environ.get("KIRYU_GATEWAY_SECRET"),
    )
    import uvicorn

    uvicorn.run(
        app, host="127.0.0.1", port=args.port, access_log=False, proxy_headers=False
    )


if __name__ == "__main__":
    main()
