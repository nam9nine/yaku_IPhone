import asyncio
import copy
import hashlib
import json
import stat
import tempfile
import threading
import time
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from kiryu_ai.masking import RESERVED_MARKERS
from kiryu_ai.web_server import (
    KNOWN_CONTEXT,
    PAGES_ORIGIN,
    WebSessionStore,
    WindowLimiter,
    create_app,
    private_json,
)
from starlette.testclient import TestClient


class FakeEngine:
    """CPU-only engine; gates make queue and shutdown tests deterministic."""

    def __init__(self):
        self.calls = []
        self.load_threads = []
        self.reply_threads = []
        self.load_gate = threading.Event()
        self.reply_gate = threading.Event()
        self.started = threading.Event()
        self.load_gate.set()
        self.reply_gate.set()
        self.load_error = False
        self.result = {"reply": "실제생성대역답변", "finish_reason": "stop"}
        self.error = None
        self.active = 0
        self.max_active = 0

    def factory(self, model, adapter):
        self.load_threads.append(threading.get_ident())
        if not self.load_gate.wait(5):
            raise RuntimeError("Test load gate timed out")
        if self.load_error:
            raise RuntimeError("PRIVATE_LOAD_DIAGNOSTIC")
        return self

    def reply(self, messages, **options):
        self.reply_threads.append(threading.get_ident())
        self.calls.append(copy.deepcopy(messages))
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.started.set()
        try:
            if not self.reply_gate.wait(5):
                raise RuntimeError("Test reply gate timed out")
            if self.error:
                raise self.error
            return dict(self.result)
        finally:
            self.active -= 1


class WebServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "data").mkdir()
        (self.root / "sources").mkdir()
        self.write_scenario("if-v1")
        (self.root / "sources/knowledge.jsonl").write_text(
            json.dumps({"id": "h", "textKo": "HARUKA_ALLOWED_FACT"})
            + "\n"
            + json.dumps({"id": "m", "textKo": "MAJIMA_ONLY_FACT"})
            + "\n"
        )
        self.engine = FakeEngine()
        self.clients = []

    def tearDown(self):
        self.engine.load_gate.set()
        self.engine.reply_gate.set()
        for client in reversed(self.clients):
            client.__exit__(None, None, None)
        self.temporary.cleanup()

    def write_scenario(self, version):
        (self.root / "data/profiles.json").write_text(
            json.dumps(
                [
                    {
                        "character_id": character,
                        "scenario_version": version,
                        "system_prompt": f"당신은 {character}. 한국어 문자로 답한다.",
                    }
                    for character in ("haruka", "majima")
                ]
            )
        )
        (self.root / "data/scenario-facts.json").write_text(
            json.dumps(
                {
                    "scenario_version": version,
                    "active_characters": ["haruka", "majima"],
                    "adopted_facts": [
                        {"id": "h", "known_by": ["haruka"]},
                        {"id": "m", "known_by": ["majima"]},
                    ],
                }
            )
        )

    def client(self, wait_ready=True, **options):
        app = create_app(
            self.root,
            model="CPU_TEST_ONLY",
            engine_factory=self.engine.factory,
            **options,
        )
        client = TestClient(app)
        client.__enter__()
        self.clients.append(client)
        if wait_ready:
            self.wait(lambda: client.get("/v1/health").json()["status"] == "ready")
        return client

    def stop(self, client):
        client.__exit__(None, None, None)
        self.clients.remove(client)

    def wait(self, condition):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = condition()
            if result:
                return result
            time.sleep(0.005)
        self.fail("CPU server condition did not become true")

    def token(self, client, **extra):
        key = json.loads((self.root / "web-access.json").read_text())["invite_key"]
        response = client.post("/v1/sessions", json={"invite_key": key, **extra})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["token"]

    def headers(self, token):
        return {"Authorization": "Bearer " + token}

    def submit(
        self,
        client,
        token,
        message="안녕",
        character="haruka",
        request_id=None,
        **extra,
    ):
        return client.post(
            "/v1/chat",
            headers=self.headers(token),
            json={
                "character": character,
                "message": message,
                "request_id": request_id or str(uuid4()),
                **extra,
            },
        )

    def completed(self, client, token, job_id):
        def terminal():
            response = client.get("/v1/jobs/" + job_id, headers=self.headers(token))
            self.assertEqual(response.status_code, 200, response.text)
            value = response.json()
            return value if value["status"] in {"complete", "error"} else None

        return self.wait(terminal)

    def history(self, client, token, character="haruka"):
        response = client.get(
            "/v1/history", params={"character": character}, headers=self.headers(token)
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_invite_auth_hash_permissions_and_client_visitor_are_not_identity(self):
        client = self.client()
        self.assertEqual(client.get("/v1/history?character=haruka").status_code, 401)
        self.assertEqual(
            client.post("/v1/sessions", json={"invite_key": "wrong"}).status_code, 401
        )
        a = self.token(client, visitor_id="attacker-chosen")
        b = self.token(client, visitor_id="attacker-chosen")
        self.assertNotEqual(a, b)
        self.assertGreaterEqual(len(a), 43)
        stored = (self.root / "web-sessions/auth.json").read_text()
        self.assertNotIn(a, stored)
        self.assertNotIn(b, stored)
        self.assertNotIn("attacker-chosen", stored)
        auth = json.loads(stored)
        self.assertIn(hashlib.sha256(a.encode()).hexdigest(), auth)
        self.assertEqual(len({row["visitor_id"] for row in auth.values()}), 2)
        for path in (
            self.root / "web-access.json",
            self.root / "web-sessions/auth.json",
        ):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(
            stat.S_IMODE((self.root / "web-sessions").stat().st_mode), 0o700
        )

    def test_cors_exact_origin_preflight_and_all_errors_are_no_store(self):
        client = self.client(allow_origins=["http://localhost:5173"])
        for origin in (PAGES_ORIGIN, "http://localhost:5173"):
            response = client.options(
                "/v1/chat",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["access-control-allow-origin"], origin)
            self.assertEqual(response.headers["cache-control"], "no-store")
            unauthorized = client.get(
                "/v1/history?character=haruka", headers={"Origin": origin}
            )
            self.assertEqual(unauthorized.status_code, 401)
            self.assertEqual(
                unauthorized.headers["access-control-allow-origin"], origin
            )
            self.assertEqual(unauthorized.headers["cache-control"], "no-store")
        for origin in (
            "https://evil.example",
            PAGES_ORIGIN + ".evil.example",
            "http://localhost:3000",
            "null",
        ):
            response = client.get("/v1/health", headers={"Origin": origin})
            self.assertEqual(response.status_code, 403)
            self.assertNotIn("access-control-allow-origin", response.headers)
            self.assertEqual(response.headers["cache-control"], "no-store")
        response = client.options(
            "/v1/chat",
            headers={
                "Origin": PAGES_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "x-custom-history",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_loading_and_failed_load_are_observable_without_model_exception_text(self):
        self.engine.load_gate.clear()
        self.engine.load_error = True
        client = self.client(wait_ready=False)
        self.assertEqual(
            client.get("/v1/health").json(),
            {
                "service": "kiryu-character-chat-v1",
                "status": "loading",
                "characters": ["haruka", "majima"],
            },
        )
        token = self.token(client)
        response = self.submit(client, token)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "model_loading")
        self.engine.load_gate.set()
        self.wait(lambda: client.get("/v1/health").json()["status"] == "error")
        response = self.submit(client, token)
        self.assertEqual(response.json()["error"]["code"], "model_error")
        self.assertNotIn("PRIVATE_LOAD_DIAGNOSTIC", response.text)

    def test_generated_history_is_scoped_and_only_server_context_enters_prompt(self):
        client = self.client()
        a, b = self.token(client), self.token(client)
        first = self.submit(client, a, "VISITOR_A_PRIVATE_CANARY").json()["job_id"]
        result = self.completed(client, a, first)
        self.assertEqual(result["status"], "complete")
        history = self.history(client, a)["messages"]
        self.assertEqual([m["role"] for m in history], ["user", "assistant"])
        self.assertEqual(history[1]["content"], "실제생성대역답변")
        self.assertEqual(set(history[0]), {"id", "role", "content", "time"})
        self.assertEqual(self.history(client, b)["messages"], [])
        self.assertEqual(self.history(client, a, "majima")["messages"], [])
        second = self.submit(client, a, "기억해?", visitor_id="override").json()[
            "job_id"
        ]
        self.completed(client, a, second)
        self.assertEqual(
            self.engine.calls[1][2],
            {"role": "assistant", "content": "실제생성대역답변"},
        )
        third = self.submit(client, b, "내 대화야").json()["job_id"]
        self.completed(client, b, third)
        self.assertNotIn("VISITOR_A_PRIVATE_CANARY", str(self.engine.calls[2]))
        self.assertIn(KNOWN_CONTEXT["haruka"], self.engine.calls[0][0]["content"])
        self.assertIn("HARUKA_ALLOWED_FACT", self.engine.calls[0][0]["content"])
        self.assertNotIn("MAJIMA_ONLY_FACT", self.engine.calls[0][0]["content"])
        self.assertFalse((self.root / "sessions").exists())
        for path in (self.root / "web-sessions/history").glob("*.json"):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_job_ownership_idempotency_and_cross_character_pending(self):
        self.engine.reply_gate.clear()
        client = self.client()
        a, b = self.token(client), self.token(client)
        request_id = str(uuid4())
        first = self.submit(client, a, request_id=request_id)
        self.assertEqual(first.status_code, 202)
        job_id = first.json()["job_id"]
        self.assertTrue(self.engine.started.wait(1))
        duplicate = self.submit(client, a, request_id=request_id)
        self.assertEqual(duplicate.status_code, 202)
        self.assertEqual(duplicate.json()["job_id"], job_id)
        self.assertEqual(self.history(client, a)["pending_job"], job_id)
        self.assertIsNone(self.history(client, a, "majima")["pending_job"])
        conflict = self.submit(client, a, "다른 문자", request_id=request_id)
        self.assertEqual(conflict.json()["error"]["code"], "request_id_conflict")
        busy = self.submit(client, a, character="majima")
        self.assertEqual(busy.status_code, 409)
        self.assertEqual(busy.json()["error"]["code"], "visitor_busy")
        self.assertEqual(
            client.get("/v1/jobs/" + job_id, headers=self.headers(b)).status_code, 404
        )
        self.assertEqual(
            client.get("/v1/jobs/not-a-uuid", headers=self.headers(a)).status_code, 404
        )
        self.engine.reply_gate.set()
        self.completed(client, a, job_id)
        again = self.submit(client, a, request_id=request_id)
        self.assertEqual(again.json(), {"job_id": job_id, "status": "complete"})
        self.assertEqual(len(self.engine.calls), 1)
        self.assertIsNone(self.history(client, a)["pending_job"])

    def test_one_model_thread_fifo_and_bounded_queue(self):
        self.engine.reply_gate.clear()
        client = self.client(queue_size=2)
        tokens = [self.token(client) for _ in range(4)]
        jobs = [self.submit(client, tokens[0], "FIRST").json()["job_id"]]
        self.assertTrue(self.engine.started.wait(1))
        for index in (1, 2):
            response = self.submit(client, tokens[index], f"MESSAGE_{index}")
            self.assertEqual(response.status_code, 202)
            jobs.append(response.json()["job_id"])
        overloaded = self.submit(client, tokens[3])
        self.assertEqual(overloaded.status_code, 503)
        self.assertEqual(overloaded.json()["error"]["code"], "queue_full")
        self.assertEqual(client.app.state.service.queue.qsize(), 2)
        self.engine.reply_gate.set()
        for token, job in zip(tokens, jobs, strict=False):
            self.assertEqual(self.completed(client, token, job)["status"], "complete")
        self.assertEqual(
            [call[-1]["content"] for call in self.engine.calls],
            ["FIRST", "MESSAGE_1", "MESSAGE_2"],
        )
        self.assertEqual(self.engine.max_active, 1)
        self.assertEqual(len(self.engine.load_threads), 1)
        self.assertEqual(
            set(self.engine.load_threads + self.engine.reply_threads),
            {self.engine.load_threads[0]},
        )
        self.assertNotEqual(self.engine.load_threads[0], threading.get_ident())

    def test_failed_truncated_and_empty_answers_do_not_change_existing_history(self):
        client = self.client()
        token = self.token(client)
        initial = self.submit(client, token, "보존할 기존 대화").json()["job_id"]
        self.completed(client, token, initial)
        before = self.history(client, token)["messages"]
        for error, result, code in (
            (ValueError("PRIVATE_INPUT_SECRET"), {}, "context_limit"),
            (RuntimeError("PRIVATE_GENERATION_SECRET"), {}, "generation_failed"),
            (None, {"reply": "잘린 대답", "finish_reason": "length"}, "output_limit"),
            (None, {"reply": " ", "finish_reason": "stop"}, "empty_reply"),
            (
                None,
                {"reply": "정상인 척", "finish_reason": "unexpected"},
                "generation_failed",
            ),
        ):
            with self.subTest(code=code):
                self.engine.error, self.engine.result = error, result
                job_id = self.submit(client, token, "실패해야 하는 문자").json()[
                    "job_id"
                ]
                job = self.completed(client, token, job_id)
                self.assertEqual(job["status"], "error")
                self.assertEqual(job["error"]["code"], code)
                self.assertNotIn("PRIVATE_", str(job))
                self.assertNotIn("reply", job)
                self.assertEqual(self.history(client, token)["messages"], before)
                self.assertIsNone(self.history(client, token)["pending_job"])

    def test_validation_rejects_history_system_facts_large_bodies_and_bad_text(self):
        client = self.client()
        token = self.token(client)
        for extra in (
            {"history": []},
            {"system": "override"},
            {"facts": []},
            {"model": "other"},
        ):
            self.assertEqual(self.submit(client, token, **extra).status_code, 400)
        for message in ("", " ", "x\x00y", ["not text"]):
            self.assertEqual(self.submit(client, token, message).status_code, 400)
        response = client.post(
            "/v1/chat",
            headers={**self.headers(token), "Content-Type": "application/json"},
            content=json.dumps(
                {"character": "haruka", "message": "\ud800", "request_id": str(uuid4())}
            ),
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.submit(client, token, "x" * 1001).status_code, 413)
        self.assertEqual(
            self.submit(client, token, character="nishiki").status_code, 400
        )
        self.assertEqual(
            self.submit(client, token, request_id="bad-uuid").status_code, 400
        )
        response = client.post(
            "/v1/chat",
            headers={**self.headers(token), "Content-Type": "application/json"},
            content=b"x" * 16385,
        )
        self.assertEqual(response.status_code, 413)
        response = client.post(
            "/v1/chat",
            headers={**self.headers(token), "Content-Type": "application/json"},
            content=iter([b"x" * 8192, b"x" * 8193]),
        )
        self.assertEqual(response.status_code, 413)
        response = client.post(
            "/v1/chat", headers=self.headers(token), content="not JSON"
        )
        self.assertEqual(response.status_code, 415)
        self.assertEqual(len(self.engine.calls), 0)

    def test_auth_failures_and_session_issuance_are_bounded(self):
        client = self.client(max_sessions=1)
        self.token(client)
        key = json.loads((self.root / "web-access.json").read_text())["invite_key"]
        self.assertEqual(
            client.post("/v1/sessions", json={"invite_key": key}).status_code, 503
        )
        for _ in range(8):
            self.assertEqual(
                client.post("/v1/sessions", json={"invite_key": "bad"}).status_code, 401
            )
        self.assertEqual(
            client.post("/v1/sessions", json={"invite_key": key}).status_code, 429
        )
        limiter = WindowLimiter(capacity=3)
        for index in range(100):
            limiter.allow(str(index), 2, 60)
        self.assertEqual(len(limiter.entries), 3)
        self.assertTrue(limiter.allow("99", 2, 60))
        self.assertFalse(limiter.allow("99", 2, 60))
        self.assertEqual(len(limiter.entries["99"]), 2)

    def test_completed_job_and_bearer_survive_restart_without_regeneration(self):
        client = self.client()
        token = self.token(client)
        request_id = str(uuid4())
        job_id = self.submit(client, token, request_id=request_id).json()["job_id"]
        expected = self.completed(client, token, job_id)
        self.stop(client)
        restarted = self.client()
        response = self.submit(restarted, token, request_id=request_id)
        self.assertEqual(response.json(), {"job_id": job_id, "status": "complete"})
        self.assertEqual(self.completed(restarted, token, job_id), expected)
        self.assertEqual(len(self.engine.calls), 1)
        self.assertEqual(len(self.history(restarted, token)["messages"]), 2)

    def test_restart_reconciles_durable_exchange_and_does_not_retry_interrupted_job(
        self,
    ):
        client = self.client()
        token = self.token(client)
        service = client.app.state.service
        record = next(iter(service.tokens.values()))
        self.stop(client)
        saved, interrupted = str(uuid4()), str(uuid4())
        WebSessionStore(service.store.directory).append_generated(
            record["visitor_id"], "haruka", "if-v1", "완료된 요청", "저장된 답변", saved
        )
        for job_id in (saved, interrupted):
            private_json(
                service.job_path(job_id),
                {
                    "job_id": job_id,
                    "visitor_id": record["visitor_id"],
                    "character": "haruka",
                    "scenario_version": "if-v1",
                    "message": "완료된 요청" if job_id == saved else "request",
                    "fingerprint": "unused",
                    "status": "generating",
                },
            )
        restarted = self.client()
        self.assertEqual(
            self.completed(restarted, token, saved)["reply"], "저장된 답변"
        )
        recovered = self.completed(restarted, token, interrupted)
        self.assertEqual(recovered["status"], "error")
        self.assertEqual(recovered["error"]["code"], "server_restarted")
        self.assertEqual(len(self.engine.calls), 0)

    def test_scenario_change_does_not_read_old_history_or_old_job(self):
        client = self.client()
        token = self.token(client)
        request_id = str(uuid4())
        old_job = self.submit(
            client, token, "OLD_SCENARIO_CANARY", request_id=request_id
        ).json()["job_id"]
        self.completed(client, token, old_job)
        self.stop(client)
        self.write_scenario("if-v2")
        restarted = self.client()
        self.assertEqual(self.history(restarted, token)["messages"], [])
        self.assertEqual(
            restarted.get(
                "/v1/jobs/" + old_job, headers=self.headers(token)
            ).status_code,
            404,
        )
        new_job = self.submit(
            restarted, token, "새 시나리오", request_id=request_id
        ).json()["job_id"]
        self.assertNotEqual(new_job, old_job)
        self.completed(restarted, token, new_job)
        self.assertNotIn("OLD_SCENARIO_CANARY", str(self.engine.calls[-1]))

    def test_request_quota_limits_disk_jobs_without_evicting_idempotency(self):
        client = self.client(max_jobs_per_session=1)
        token = self.token(client)
        request_id = str(uuid4())
        job_id = self.submit(client, token, request_id=request_id).json()["job_id"]
        self.completed(client, token, job_id)
        blocked = self.submit(client, token)
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.json()["error"]["code"], "session_limit")
        self.assertEqual(
            self.submit(client, token, request_id=request_id).json()["job_id"], job_id
        )
        self.assertEqual(len(list((self.root / "web-sessions/jobs").glob("*.json"))), 1)

    def test_per_visitor_rate_limit_and_expired_token(self):
        client = self.client()
        token = self.token(client)
        for _ in range(12):
            response = self.submit(client, token)
            self.assertEqual(response.status_code, 202)
            self.completed(client, token, response.json()["job_id"])
        response = self.submit(client, token)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "rate_limited")
        service = client.app.state.service
        next(iter(service.tokens.values()))["issued_at"] = 0
        self.assertEqual(
            client.get(
                "/v1/history?character=haruka", headers=self.headers(token)
            ).status_code,
            401,
        )

    def test_unsafe_extra_cors_origins_are_rejected(self):
        for origin in (
            "*",
            "https://other.example",
            "http://localhost",
            "http://localhost:5173/path",
            "http://user@localhost:5173",
        ):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                create_app(
                    self.root,
                    model="CPU_TEST_ONLY",
                    engine_factory=self.engine.factory,
                    allow_origins=[origin],
                )

    def test_terminal_job_write_failure_preserves_completed_reply_and_ends_queue(self):
        self.engine.reply_gate.clear()
        client = self.client(queue_size=2)
        tokens = [self.token(client) for _ in range(3)]
        request_ids = [str(uuid4()) for _ in tokens]
        jobs = [
            self.submit(client, tokens[0], request_id=request_ids[0]).json()["job_id"]
        ]
        self.assertTrue(self.engine.started.wait(1))
        for index in (1, 2):
            jobs.append(
                self.submit(
                    client, tokens[index], request_id=request_ids[index]
                ).json()["job_id"]
            )
        service = client.app.state.service

        def fail_terminal_job(path, value):
            if Path(path).parent == service.jobs_directory and value["status"] in {
                "complete",
                "error",
            }:
                raise OSError("PRIVATE_STORAGE_DETAIL")
            return private_json(path, value)

        with patch("kiryu_ai.web_server.private_json", side_effect=fail_terminal_job):
            self.engine.reply_gate.set()
            self.wait(lambda: client.get("/v1/health").json()["status"] == "error")
            completed = self.completed(client, tokens[0], jobs[0])
            self.assertEqual(completed["status"], "complete")
            self.assertEqual(completed["reply"], "실제생성대역답변")
            self.assertEqual(len(self.history(client, tokens[0])["messages"]), 2)
            for index in (1, 2):
                failed = self.completed(client, tokens[index], jobs[index])
                self.assertEqual(failed["status"], "error")
                self.assertEqual(failed["error"]["code"], "server_unavailable")
                self.assertNotIn("reply", failed)
                self.assertEqual(self.history(client, tokens[index])["messages"], [])
            for index in range(3):
                response = self.submit(
                    client, tokens[index], request_id=request_ids[index]
                )
                self.assertEqual(response.status_code, 202)
                self.assertEqual(response.json()["job_id"], jobs[index])
                self.assertIn(response.json()["status"], {"complete", "error"})
                self.assertIsNone(self.history(client, tokens[index])["pending_job"])
            self.assertEqual(
                client.get(
                    "/v1/jobs/" + jobs[0], headers=self.headers(tokens[1])
                ).status_code,
                404,
            )
            self.assertEqual(self.submit(client, tokens[0]).status_code, 503)
            self.assertEqual(service.pending, {})
            self.assertEqual(service.queue.qsize(), 0)
            self.assertEqual(len(service.failed_jobs), 3)
            self.assertLessEqual(len(service.failed_jobs), service.queue.maxsize + 1)
            self.assertEqual(len(self.engine.calls), 1)
            self.assertEqual(
                json.loads(service.job_path(jobs[0]).read_text())["status"],
                "generating",
            )
            self.assertEqual(
                json.loads(service.job_path(jobs[1]).read_text())["status"], "queued"
            )
            self.stop(client)
        self.assertIsNone(service.engine)
        with self.assertRaises(RuntimeError):
            service.executor.submit(lambda: None)

    def test_history_write_failure_never_claims_success_and_clears_pending_queue(self):
        self.engine.reply_gate.clear()
        client = self.client()
        a, b = self.token(client), self.token(client)
        first = self.submit(client, a).json()["job_id"]
        self.assertTrue(self.engine.started.wait(1))
        second = self.submit(client, b).json()["job_id"]
        service = client.app.state.service

        def fail_history(path, value):
            if Path(path).parent == service.store.directory:
                raise OSError("PRIVATE_HISTORY_FAILURE")
            return private_json(path, value)

        with patch("kiryu_ai.web_server.private_json", side_effect=fail_history):
            self.engine.reply_gate.set()
            self.wait(lambda: client.get("/v1/health").json()["status"] == "error")
            for token, job_id in ((a, first), (b, second)):
                result = self.completed(client, token, job_id)
                self.assertEqual(result["status"], "error")
                self.assertNotIn("reply", result)
                self.assertNotIn("PRIVATE_", str(result))
                self.assertEqual(
                    self.history(client, token), {"messages": [], "pending_job": None}
                )
            self.assertEqual(service.pending, {})
            self.assertEqual(service.queue.qsize(), 0)
            self.assertEqual(len(self.engine.calls), 1)

    def test_unhandled_worker_exception_still_unloads_model_and_shuts_down_executor(
        self,
    ):
        app = create_app(
            self.root, model="CPU_TEST_ONLY", engine_factory=self.engine.factory
        )
        service = app.state.service

        async def broken_worker():
            await asyncio.get_running_loop().run_in_executor(
                service.executor, service._load_engine
            )
            raise OSError("PRIVATE_WORKER_FAILURE")

        service.run = broken_worker
        with TestClient(app) as client:
            self.wait(lambda: client.get("/v1/health").json()["status"] == "error")
        self.assertEqual(len(self.engine.load_threads), 1)
        self.assertIsNone(service.engine)
        with self.assertRaises(RuntimeError):
            service.executor.submit(lambda: None)

    def test_reserved_input_and_generated_markers_cannot_poison_future_history(self):
        client = self.client()
        token = self.token(client)
        for marker in RESERVED_MARKERS:
            response = self.submit(client, token, "문자 " + marker)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["error"]["code"], "invalid_message")
        self.assertEqual(len(self.engine.calls), 0)
        original = self.submit(client, token, "보존할 정상 대화").json()["job_id"]
        self.completed(client, token, original)
        before = self.history(client, token)["messages"]
        for marker in RESERVED_MARKERS:
            self.engine.result = {
                "reply": marker + " 내부 추론 또는 제어 구문",
                "finish_reason": "stop",
            }
            job_id = self.submit(client, token, "후속 문자").json()["job_id"]
            result = self.completed(client, token, job_id)
            self.assertEqual(result["status"], "error")
            self.assertEqual(result["error"]["code"], "generation_error")
            self.assertNotIn("reply", result)
            self.assertEqual(self.history(client, token)["messages"], before)
        self.engine.result = {"reply": "다음 정상 답변", "finish_reason": "stop"}
        recovered = self.submit(client, token, "다시 정상 대화").json()["job_id"]
        self.assertEqual(self.completed(client, token, recovered)["status"], "complete")
        self.assertEqual(len(self.history(client, token)["messages"]), 4)

    def test_slow_stream_has_whole_body_deadline_and_private_408_response(self):
        client = self.client()
        messages = []
        receive_count = 0

        async def receive():
            nonlocal receive_count
            receive_count += 1
            if receive_count == 1:
                return {
                    "type": "http.request",
                    "body": b'{"invite_key":',
                    "more_body": True,
                }
            await asyncio.sleep(1)
            return {"type": "http.request", "body": b'"slow"}', "more_body": False}

        async def send(message):
            messages.append(message)

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/v1/sessions",
            "raw_path": b"/v1/sessions",
            "query_string": b"",
            "root_path": "",
            "headers": [
                (b"content-type", b"application/json"),
                (b"origin", PAGES_ORIGIN.encode()),
            ],
            "client": ("127.0.0.1", 1111),
            "server": ("testserver", 80),
        }
        with patch("kiryu_ai.web_server.REQUEST_BODY_SECONDS", 0.01):
            asyncio.run(client.app(scope, receive, send))
        self.assertEqual(messages[0]["status"], 408)
        headers = dict(messages[0]["headers"])
        self.assertEqual(headers[b"cache-control"], b"no-store")
        self.assertEqual(headers[b"access-control-allow-origin"], PAGES_ORIGIN.encode())
        self.assertEqual(
            json.loads(messages[1]["body"])["error"]["code"], "request_timeout"
        )
        self.assertEqual(len(self.engine.calls), 0)

    def test_original_request_survives_pending_failure_and_restart_without_history(
        self,
    ):
        self.engine.reply_gate.clear()
        self.engine.error = RuntimeError("PRIVATE_FAILURE")
        client = self.client()
        a, b = self.token(client), self.token(client)
        request_ids = [str(uuid4()), str(uuid4())]
        originals = ["  진행 중인 원문 그대로  ", "대기 중인 원문"]
        first = self.submit(client, a, originals[0], request_id=request_ids[0]).json()[
            "job_id"
        ]
        self.assertTrue(self.engine.started.wait(1))
        second = self.submit(client, b, originals[1], request_id=request_ids[1]).json()[
            "job_id"
        ]
        requests = []
        for index, (token, job_id, status) in enumerate(
            ((a, first, "generating"), (b, second, "queued"))
        ):
            response = client.get("/v1/jobs/" + job_id, headers=self.headers(token))
            self.assertEqual(response.status_code, 200)
            job = response.json()
            self.assertEqual(job["status"], status)
            request = job["request"]
            self.assertEqual(request["id"], request_ids[index])
            self.assertEqual(request["message"], originals[index])
            self.assertEqual(datetime.fromisoformat(request["time"]).tzinfo, UTC)
            stored = json.loads(client.app.state.service.job_path(job_id).read_text())
            self.assertEqual(
                request,
                {
                    "id": stored["request_id"],
                    "message": stored["message"],
                    "time": stored["accepted_at"],
                },
            )
            requests.append(request)
            self.assertEqual(self.history(client, token)["messages"], [])
        foreign = client.get("/v1/jobs/" + first, headers=self.headers(b))
        self.assertEqual(foreign.status_code, 404)
        self.assertNotIn(originals[0], foreign.text)
        self.engine.reply_gate.set()
        for index, (token, job_id) in enumerate(((a, first), (b, second))):
            failed = self.completed(client, token, job_id)
            self.assertEqual(failed["status"], "error")
            self.assertEqual(failed["request"], requests[index])
            self.assertEqual(self.history(client, token)["messages"], [])
        self.stop(client)
        restarted = self.client()
        self.assertEqual(self.completed(restarted, a, first)["request"], requests[0])
        self.assertEqual(self.history(restarted, a)["messages"], [])
        self.engine.error = None
        successful_id = str(uuid4())
        completed_id = self.submit(
            restarted, a, "새 정상 문자", request_id=successful_id
        ).json()["job_id"]
        completed = self.completed(restarted, a, completed_id)
        self.assertEqual(completed["status"], "complete")
        self.assertEqual(completed["request"]["id"], successful_id)
        self.assertEqual(completed["request"]["message"], "새 정상 문자")
        self.assertEqual(completed["messages"][-2]["id"], completed_id + "-user")


if __name__ == "__main__":
    unittest.main()
