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
from uuid import UUID, uuid4

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from .chat_db import (
    MAX_ACTIVE_PER_VISITOR,
    RELATIONSHIP_TONES,
    ChatDB,
    InvalidTransition,
    RequestConflict,
    VisitorBusy,
)
from .chat_policy import POLICY_MESSAGE, explicit_request, output_allowed
from .chat_queue import CancellableFIFO
from .episodes import EPISODE_ID, EpisodeStore, validate_command
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
    result["request_kind"] = job.get("request_kind", "chat")
    if result["request_kind"] == "call_followup":
        result["request"].pop("message")
        result["request"].update(kind="call_followup", trigger=job["trigger"])
    if result["request_kind"] == "proactive_episode":
        result["request"].pop("message")
        result["request"].update(kind="proactive_episode", episode=job["episode_ref"])
    if job.get("episode_ref"):
        result["episode"] = job["episode_ref"]
        result["request"]["episode"] = job["episode_ref"]
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


class EpisodeSuperseded(Exception):
    """A new actual user input made a queued or in-flight episode obsolete."""


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
        episodes_enabled=None,
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
        self.queue = CancellableFIFO(maxsize=queue_size)
        self.episodes_enabled = (
            os.environ.get("KIRYU_EPISODES_ENABLED") == "1"
            if episodes_enabled is None
            else bool(episodes_enabled)
        )
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
        trigger=None,
        episode_ref=None,
    ):
        from .call_followups import validate_trigger
        from .phone_events import is_call_events

        visitor = record["visitor_id"]
        if trigger is not None:
            try:
                trigger = validate_trigger(trigger)
            except ValueError:
                raise ApiFailure(
                    400, "invalid_trigger", "올바른 통화 상태가 필요합니다."
                ) from None
            if message is not None:
                raise ApiFailure(
                    400,
                    "invalid_trigger",
                    "통화 후속 요청에는 문자를 넣을 수 없습니다.",
                )
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
        if trigger is not None and is_call_events(phone_events):
            raise ApiFailure(
                400, "invalid_phone_events", "종료된 통화 상태가 필요합니다."
            )
        scope = (visitor, character, SCENARIO)
        # Existing UUIDs must remain discoverable even while the queue/model is
        # unavailable. accept() checks the fingerprint again in its transaction.
        previous = self.db.find_request(visitor, SCENARIO, request_id)
        if previous:
            if (
                previous.get("trigger") != trigger
                or previous.get("episode_ref") != episode_ref
                or previous["character"] != character
                or previous["message"] != message
                or previous.get("relationship_tone", "neutral") != relationship_tone
                or previous.get("phone_events", []) != phone_events
            ):
                raise ApiFailure(
                    409, "request_id_conflict", "다른 내용에 사용한 요청 ID입니다."
                )
            return previous
        if trigger is not None:
            prior_call = self.db.find_followup(
                visitor, character, SCENARIO, trigger["call_id"]
            )
            if prior_call:
                return prior_call
        if message is not None and explicit_request(message):
            raise ApiFailure(400, "content_blocked", POLICY_MESSAGE)
        if self.status != "ready":
            raise ApiFailure(
                503,
                "model_unavailable",
                "지금은 답장을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.",
            )
        pending_id = self.pending.get(scope)
        pending_job = self.db.get_request(pending_id) if pending_id else None
        replacing = bool(
            message is not None and pending_job and pending_job.get("episode_ref")
        )
        if (scope in self.pending and not replacing) or sum(
            key[0] == visitor for key in self.pending
        ) - int(replacing) >= MAX_ACTIVE_PER_VISITOR:
            raise ApiFailure(
                409,
                "conversation_busy",
                "이 연락처의 답장을 기다려 주세요. 다른 연락처에는 보낼 수 있습니다.",
            )
        if self.queue.full() and not (
            replacing and any(item["job_id"] == pending_id for item in self.queue.items)
        ):
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
                trigger=trigger,
                episode_ref=episode_ref,
                supersede_episode=message is not None,
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
            for superseded in job.get("superseded_job_ids", []):
                self.queue.cancel(superseded)
            self.pending[scope] = job["job_id"]
            self.queue.put_nowait(job)
        return job

    def schedule_episode(self, visitor, *, address="episode", now=None):
        """Dispatch only eligible foreground work; one model queue remains shared."""
        if (
            not self.episodes_enabled
            or self.status != "ready"
            or not hasattr(self.builder, "build_episode")
        ):
            return
        state = self.db.episodes.get(visitor, SCENARIO)
        if not EpisodeStore.is_active(state, now) or state["interpretation_pending"]:
            return
        if state["contact_stage"] == "initial" and state["remaining_ms"] == 0:
            stage, trigger = "invite", None
        elif state["contact_stage"] == "followup_due":
            stage = "followup"
            trigger = {
                "call_id": state["call_id"],
                "reason": state["call_outcome"],
                "direction": "incoming",
            }
        else:
            return
        # Never fill scarce visitor or queue capacity with unsolicited work while
        # accepted user work exists. An arriving user may still supersede it.
        if self.pending or not self.queue.empty():
            return
        ref = {
            "episode_id": EPISODE_ID,
            "instance_id": state["instance_id"],
            "version": state["version"],
            "stage": stage,
        }
        try:
            self.submit(
                {"visitor_id": visitor},
                "majima",
                None,
                str(uuid4()),
                address,
                relationship_tone=state["relationship_tone"],
                trigger=trigger,
                episode_ref=ref,
            )
        except ApiFailure as error:
            if error.status not in {409, 429, 503}:
                raise

    def episode_command(self, record, body, *, address="episode", now=None):
        command = validate_command(body)
        visitor = record["visitor_id"]
        if not self.episodes_enabled:
            return self.db.episodes.response(
                visitor, SCENARIO, enabled=False, accepted=False
            )
        # A followup or an invitation itself is not user activity and must not
        # invalidate its own foreground lease.
        busy = bool(self.pending)
        existing = self.db.episodes.get(visitor, SCENARIO)
        previous = (
            self.db.get_request(existing["job_id"])
            if existing and existing["job_id"]
            else None
        )
        if (
            previous
            and previous.get("episode_ref")
            and previous.get("error_code") in {"interrupted", "episode_inactive"}
        ):
            self.db.episodes.retry_inactive(previous)
        accepted = self.db.episodes.command(
            visitor, SCENARIO, command, busy=busy, now=now
        )
        if command["kind"] == "presence" and not command["active"]:
            state = self.db.episodes.get(visitor, SCENARIO)
            job = (
                self.db.get_request(state["job_id"])
                if state and state["job_id"]
                else None
            )
            if (
                job
                and job.get("episode_ref")
                and job["status"] == "queued"
                and not EpisodeStore.is_active(state, now)
            ):
                self.db.interrupt_episode(job["job_id"], "episode_inactive")
                self.queue.cancel(job["job_id"])
                scope = (visitor, "majima", SCENARIO)
                if self.pending.get(scope) == job["job_id"]:
                    self.pending.pop(scope)
                self.db.episodes.retry_inactive(job)
        if command["kind"] in {"presence", "call_result"}:
            self.schedule_episode(visitor, address=address, now=now)
        return self.db.episodes.response(visitor, SCENARIO, accepted=accepted)

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
        self.followup_engine = (
            self.engine
            if self.engine_factory
            else GemmaEngine(
                base_url=self.model_url,
                manifest_path=self.manifest_path,
                api_key_file=self.api_key_file,
                thinking=False,
            )
        )
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
        from .call_followups import FOLLOWUP_TOKENS
        from .chat_prompt import InputBudgetError
        from .gemma_engine import CONTEXT_TOKENS, OUTPUT_TOKENS, SAMPLING, GemmaFailure

        followup = job.get("request_kind") == "call_followup"
        proactive = job.get("request_kind") == "proactive_episode"
        episode_job = bool(job.get("episode_ref"))
        if episode_job:
            if not self.db.episode_job_current(job["job_id"]):
                return
            state = self.db.episodes.get(job["visitor_id"], SCENARIO)
            if not self.episodes_enabled or not EpisodeStore.is_active(state):
                self.db.interrupt_episode(job["job_id"], "episode_inactive")
                self.db.episodes.retry_inactive(job)
                return
        engine = (
            getattr(self, "followup_engine", self.engine) if followup else self.engine
        )
        output_budget = FOLLOWUP_TOKENS if followup else OUTPUT_TOKENS
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
            if episode_job and (
                not self.episodes_enabled
                or not self.db.episode_job_current(job["job_id"])
            ):
                self.db.interrupt_episode(job["job_id"])
                raise EpisodeSuperseded
            manifest = getattr(engine, "manifest", {})
            metadata = {
                **assembled["metadata"],
                "model": manifest.get("model_file", "test-engine"),
                "model_manifest": manifest,
                "sampling": SAMPLING,
                "seed": None,
                "request_kind": job.get("request_kind", "chat"),
                "generation_options": {
                    "thinking": getattr(engine, "thinking", not followup),
                    "max_tokens": output_budget,
                },
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
            history = self.db.history(
                job["visitor_id"], job["character"], SCENARIO, with_sequence=True
            )
            build = (
                self.builder.build_followup
                if followup
                else (self.builder.build_episode if proactive else self.builder.build)
            )
            request_input = (
                {"trigger": job["trigger"]}
                if followup
                else ({} if proactive else {"user_message": job["message"]})
            )
            episode_state = (
                self.db.episodes.get(job["visitor_id"], SCENARIO)
                if job["character"] == "majima"
                else None
            )
            if (
                self.episodes_enabled
                and episode_state
                and (episode_job or episode_state["phase"] != "not_started")
            ):
                request_input["episode_context"] = EpisodeStore.context(episode_state)
                if not followup and not proactive:
                    request_input["current_message_id"] = job["job_id"] + "-user"
                    request_input["on_episode_decision"] = lambda decision: (
                        self.db.episodes.apply_decision(
                            job["visitor_id"],
                            SCENARIO,
                            decision,
                            job["job_id"] + "-user",
                        )
                    )
            assembled = build(
                visitor_id=job["visitor_id"],
                character_id=job["character"],
                scenario_version=SCENARIO,
                **request_input,
                notices=self.db.recent_notices(
                    job["visitor_id"], job["character"], SCENARIO
                ),
                relationship_tone=job.get("relationship_tone", "neutral"),
                phone_events=job.get("phone_events", []),
                history=history,
                count_tokens=engine.count_tokens,
                context_limit=CONTEXT_TOKENS,
                max_tokens=output_budget,
                on_stage=record_stage,
            )
            record_stage(assembled)
            result = engine.reply(assembled["messages"], max_tokens=output_budget)
            metrics = timings(result)
            if episode_job and (
                not self.episodes_enabled
                or not self.db.episode_job_current(job["job_id"])
            ):
                self.db.interrupt_episode(job["job_id"])
                self.db.save_discarded_output(
                    job["job_id"], result.get("reply", ""), metrics
                )
                return
            if result.get("finish_reason") not in {"stop", "eos"}:
                code = (
                    "output_limit"
                    if result.get("finish_reason") == "length"
                    else "generation_failed"
                )
                self._fail_job(
                    job, code, output=result.get("reply", ""), metrics=metrics
                )
            elif (
                not isinstance(result.get("reply"), str) or not result["reply"].strip()
            ):
                self._fail_job(job, "empty_reply", metrics=metrics)
            elif not output_allowed(result["reply"]):
                self._fail_job(
                    job,
                    "content_blocked",
                    output=result["reply"],
                    metrics=metrics,
                )
            else:
                completed = self.db.complete(
                    job["job_id"], result["reply"], metrics=metrics
                )
                if not completed:
                    self.db.save_discarded_output(
                        job["job_id"], result["reply"], metrics
                    )
        except EpisodeSuperseded:
            return
        except InvalidTransition:
            if episode_job and not self.db.episode_job_current(job["job_id"]):
                return
            raise
        except GemmaFailure as error:
            partial = getattr(error, "result", {}) or {}
            self._fail_job(
                job,
                error.code,
                output=partial.get("reply", ""),
                metrics=timings(partial),
            )
        except InputBudgetError:
            self._fail_job(job, "context_limit", metrics=timings())
        except Exception:  # noqa: BLE001 -- never log private prompts or provider errors
            self._fail_job(job, "generation_failed", metrics=timings())

    def _fail_job(self, job, code, output="", metrics=None):
        try:
            self.db.fail(job["job_id"], code, output=output, metrics=metrics)
        except InvalidTransition:
            if not job.get("episode_ref") or self.db.episode_job_current(job["job_id"]):
                raise
            self.db.save_discarded_output(job["job_id"], output, metrics)

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

    async def recording(request):
        from .call_recordings import save_recording

        return await save_recording(request, service)

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
                include_episodes=request.query_params.get("episodes") == "1",
            )
        except ValueError:
            raise ApiFailure(
                400, "invalid_cursor", "대화 페이지를 다시 불러와 주세요."
            ) from None
        pending = service.pending.get((record["visitor_id"], character, SCENARIO))
        if pending and request.query_params.get("episodes") != "1":
            pending_record = service.db.get_request(pending)
            if (
                pending_record
                and pending_record.get("request_kind") == "proactive_episode"
            ):
                pending = None
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

    async def call_followup(request):
        record = service.authenticate(request)
        body = await json_body(request)
        required = {"character", "request_id", "call_id", "reason", "direction"}
        if not required <= set(body) or set(body) - required - {
            "relationship_tone",
            "phone_events",
        }:
            raise ApiFailure(400, "invalid_body", "지원하지 않는 요청 항목입니다.")
        if body["character"] not in CHARACTERS:
            raise ApiFailure(400, "invalid_character", "지원하지 않는 대화 상대입니다.")
        try:
            request_id = str(UUID(body["request_id"]))
        except (ValueError, TypeError, AttributeError):
            raise ApiFailure(
                400, "invalid_request", "올바른 요청 UUID가 필요합니다."
            ) from None
        episode_state = (
            service.db.episodes.get(record["visitor_id"], SCENARIO)
            if body["character"] == "majima"
            else None
        )
        if episode_state and body["call_id"] == episode_state["call_id"]:
            prior = service.db.find_followup(
                record["visitor_id"], "majima", SCENARIO, body["call_id"]
            )
            if prior:
                return JSONResponse(
                    {"job_id": prior["job_id"], "status": public_job(prior)["status"]},
                    status_code=202,
                )
            raise ApiFailure(
                409, "episode_managed", "이 통화의 후속 연락을 처리하고 있습니다."
            )
        job = service.submit(
            record,
            body["character"],
            None,
            request_id,
            service.address(request),
            relationship_tone=body.get("relationship_tone", "neutral"),
            phone_events=body.get("phone_events", []),
            trigger={key: body[key] for key in ("call_id", "reason", "direction")},
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
        if (
            job.get("request_kind") == "proactive_episode"
            and request.query_params.get("episodes") != "1"
        ):
            raise ApiFailure(404, "job_not_found", "요청을 찾을 수 없습니다.")
        return JSONResponse(public_job(job))

    async def episode(request):
        record = service.authenticate(request)
        if not service.limiter.allow("episode:" + record["visitor_id"], 90, 60):
            raise ApiFailure(429, "rate_limited", "잠시 후 다시 시도해 주세요.")
        if request.method == "GET":
            if request.query_params.get("protocol") != "1":
                raise ApiFailure(400, "invalid_protocol", "지원하지 않는 요청입니다.")
            return JSONResponse(
                service.db.episodes.response(
                    record["visitor_id"], SCENARIO, enabled=service.episodes_enabled
                )
            )
        try:
            result = service.episode_command(
                record, await json_body(request), address=service.address(request)
            )
        except (ValueError, TypeError, KeyError):
            raise ApiFailure(
                400, "invalid_episode", "지원하지 않는 요청입니다."
            ) from None
        return JSONResponse(result)

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
            Route("/v1/episodes/majima", episode, methods=["GET", "POST"]),
            Route(
                "/v1/recordings/{character}/{recording_id}", recording, methods=["POST"]
            ),
            Route("/v1/chat", chat, methods=["POST"]),
            Route("/v1/call-followups", call_followup, methods=["POST"]),
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
