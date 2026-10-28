"""HTTP/persistence integration; synthetic text and CPU engine only."""

import copy
import hashlib
import json
import tarfile
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from kiryu_ai.chat_server import PAGES_ORIGIN, ChatService, create_app
from kiryu_ai.gemma_engine import GemmaEngine, GemmaFailure
from starlette.testclient import TestClient


class Engine:
    def __init__(self):
        self.manifest = {"model_file": "CPU_TEST_ONLY"}
        self.calls = []
        self.gate = threading.Event()
        self.gate.set()
        self.started = threading.Event()
        self.result = {
            "reply": "검사용 답장",
            "finish_reason": "stop",
            "total_seconds": 0.01,
        }
        self.failure = None

    def count_tokens(self, messages):
        return len(str(messages))

    def reply(self, messages, **kwargs):
        self.calls.append(copy.deepcopy(messages))
        self.started.set()
        if not self.gate.wait(5):
            raise RuntimeError("test gate timeout")
        if self.failure:
            raise self.failure
        return dict(self.result)


class Builder:
    def build(
        self,
        *,
        visitor_id,
        character_id,
        scenario_version,
        user_message,
        history,
        **kwargs,
    ):
        return {
            "messages": [{"role": "system", "content": character_id}]
            + [{"role": m["role"], "content": m["content"]} for m in history]
            + [{"role": "user", "content": user_message}],
            "metadata": {
                "prompt_version": "CPU_TEST_V1",
                "input_message_ids": [m["id"] for m in history],
            },
            "retrieval_hits": [],
        }


class ChatServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name).resolve()
        self.engine = Engine()
        self.clients = []

    def tearDown(self):
        self.engine.gate.set()
        for client in reversed(self.clients):
            client.__exit__(None, None, None)
        self.directory.cleanup()

    def wait(self, fn):
        end = time.monotonic() + 4
        while time.monotonic() < end:
            result = fn()
            if result:
                return result
            time.sleep(0.005)
        self.fail("CPU condition timed out")

    def client(self, **kwargs):
        app = create_app(
            self.root, engine_factory=lambda: self.engine, builder=Builder(), **kwargs
        )
        client = TestClient(app)
        client.__enter__()
        self.clients.append(client)
        self.wait(lambda: client.get("/v1/health").json()["status"] == "ready")
        return client

    def token(self, client):
        response = client.post("/v1/sessions", json={})
        self.assertEqual(response.status_code, 200)
        return {"Authorization": "Bearer " + response.json()["token"]}

    def send(
        self, client, auth, message="카레 계획", character="haruka", request_id=None
    ):
        response = client.post(
            "/v1/chat",
            headers=auth,
            json={
                "character": character,
                "message": message,
                "request_id": request_id or str(uuid4()),
            },
        )
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()["job_id"]

    def finished(self, client, auth, job):
        def poll():
            result = client.get("/v1/jobs/" + job, headers=auth).json()
            return result if result.get("status") in {"complete", "error"} else None

        return self.wait(poll)

    def test_fresh_session_archives_old_dialogue_without_reusing_model_history(self):
        client = self.client()
        old_auth = self.token(client)
        old_jobs = []
        for character in ("haruka", "majima"):
            job = self.send(
                client, old_auth, "OLD_PRIVATE_MEMORY_" + character, character
            )
            self.finished(client, old_auth, job)
            old_jobs.append(job)
        # A phone reset opens a new anonymous scope; the old visitor stays in DB.
        fresh_auth = self.token(client)
        for character in ("haruka", "majima"):
            page = client.get(
                "/v1/history?character=" + character, headers=fresh_auth
            ).json()
            self.assertEqual(page["messages"], [])
            self.assertIsNone(page["pending_job"])
            job = self.send(client, fresh_auth, "새 대화", character)
            self.finished(client, fresh_auth, job)
            self.assertNotIn("OLD_PRIVATE_MEMORY", json.dumps(self.engine.calls[-1]))
            detail = client.app.state.service.db.request_detail(job)
            self.assertEqual(detail["run"]["metadata"]["input_message_ids"], [])
        for job in old_jobs:
            self.assertEqual(
                client.get("/v1/jobs/" + job, headers=fresh_auth).status_code, 404
            )
            detail = client.app.state.service.db.request_detail(job)
            self.assertEqual(detail["status"], "complete")
            self.assertIn("OLD_PRIVATE_MEMORY", detail["message"])
            self.assertEqual(len(detail["messages"]), 2)

    def test_anonymous_acceptance_is_durable_before_generation_and_idempotent(self):
        client = self.client()
        auth = self.token(client)
        self.engine.gate.clear()
        request_id = str(uuid4())
        job = self.send(client, auth, request_id=request_id)
        self.assertTrue(self.engine.started.wait(2))
        history = client.get("/v1/history?character=haruka", headers=auth).json()
        self.assertEqual(history["pending_job"], job)
        self.assertEqual([m["content"] for m in history["messages"]], ["카레 계획"])
        self.assertEqual(self.send(client, auth, request_id=request_id), job)
        changed = client.post(
            "/v1/chat",
            headers=auth,
            json={
                "character": "majima",
                "message": "카레 계획",
                "request_id": request_id,
            },
        )
        self.assertEqual(changed.status_code, 409)
        self.engine.gate.set()
        self.assertEqual(self.finished(client, auth, job)["reply"], "검사용 답장")
        self.assertEqual(len(self.engine.calls), 1)

    def test_failed_partial_output_remains_private_and_out_of_next_input(self):
        client = self.client()
        auth = self.token(client)
        self.engine.failure = GemmaFailure(
            "generation_timeout",
            {"reply": "PARTIAL_PRIVATE", "finish_reason": "timeout"},
        )
        first = self.send(client, auth, "실패한 요청")
        result = self.finished(client, auth, first)
        self.assertEqual(result["status"], "error")
        self.assertNotIn("PARTIAL_PRIVATE", str(result))
        self.assertIn(
            "PARTIAL_PRIVATE", str(client.app.state.service.db.request_detail(first))
        )
        self.engine.failure = None
        second = self.send(client, auth, "다음 요청")
        self.finished(client, auth, second)
        self.assertNotIn("실패한 요청", str(self.engine.calls[-1]))
        self.assertNotIn("PARTIAL_PRIVATE", str(self.engine.calls[-1]))
        history = client.get("/v1/history?character=haruka", headers=auth).json()[
            "messages"
        ]
        self.assertEqual(len(history), 3)

    def test_visitor_character_and_job_ownership_are_checked_before_model_input(self):
        client = self.client()
        a, b = self.token(client), self.token(client)
        job = self.send(client, a, "A_ONLY_CANDLE_472")
        self.finished(client, a, job)
        self.assertEqual(client.get("/v1/jobs/" + job, headers=b).status_code, 404)
        self.assertEqual(
            client.get("/v1/history?character=haruka", headers=b).json()["messages"], []
        )
        self.finished(client, b, self.send(client, b, "안녕"))
        self.assertNotIn("A_ONLY_CANDLE_472", str(self.engine.calls[-1]))
        self.finished(client, a, self.send(client, a, "안녕", character="majima"))
        self.assertNotIn("A_ONLY_CANDLE_472", str(self.engine.calls[-1]))

    def test_queue_is_bounded_and_one_active_job_per_visitor(self):
        client = self.client(queue_size=1)
        auths = [self.token(client) for _ in range(3)]
        self.engine.gate.clear()
        job = self.send(client, auths[0])
        self.assertTrue(self.engine.started.wait(2))
        second = self.send(client, auths[1])
        for auth, expected in ((auths[0], 409), (auths[2], 503)):
            response = client.post(
                "/v1/chat",
                headers=auth,
                json={
                    "character": "haruka",
                    "message": "대기",
                    "request_id": str(uuid4()),
                },
            )
            self.assertEqual(response.status_code, expected)
        self.engine.gate.set()
        self.finished(client, auths[0], job)
        self.finished(client, auths[1], second)

    def test_api_restart_restores_token_and_complete_exchange(self):
        client = self.client()
        auth = self.token(client)
        job = self.send(client, auth)
        self.finished(client, auth, job)
        client.__exit__(None, None, None)
        self.clients.remove(client)
        next_client = self.client()
        self.assertEqual(
            len(
                next_client.get("/v1/history?character=haruka", headers=auth).json()[
                    "messages"
                ]
            ),
            2,
        )
        self.assertEqual(self.finished(next_client, auth, job)["status"], "complete")
        self.assertEqual(len(self.engine.calls), 1)

    def test_no_invite_prompt_endpoint_model_or_owner_routes(self):
        client = self.client()
        self.assertEqual(
            client.post("/v1/sessions", json={"invite_key": "legacy"}).status_code, 400
        )
        self.assertEqual(
            client.post(
                "/v1/sessions", json={}, headers={"Origin": "https://evil.test"}
            ).status_code,
            403,
        )
        response = client.post(
            "/v1/sessions", json={}, headers={"Origin": PAGES_ORIGIN}
        )
        self.assertEqual(response.headers["access-control-allow-origin"], PAGES_ORIGIN)
        self.assertEqual(response.headers["cache-control"], "no-store")
        for path in (
            "/admin",
            "/review",
            "/completion",
            "/props",
            "/v1/chat/completions",
        ):
            self.assertEqual(client.get(path).status_code, 404)

    def test_only_signed_gateway_proof_makes_forwarded_ip_trusted(self):
        from starlette.requests import Request

        client = self.client(gateway_secret="TEST_GATEWAY")

        def address(proof):
            req = Request(
                {
                    "type": "http",
                    "client": ("127.0.0.1", 1234),
                    "headers": [
                        (b"x-kiryu-client-ip", b"192.0.2.9"),
                        (b"x-kiryu-gateway", proof),
                    ],
                }
            )
            return client.app.state.service.address(req)

        self.assertEqual(address(b"forged"), "127.0.0.1")
        self.assertEqual(address(b"TEST_GATEWAY"), "192.0.2.9")

    def test_queue_and_service_timings_survive_each_failure_path(self):
        from kiryu_ai.chat_prompt import InputBudgetError

        service = ChatService(
            self.root, engine_factory=lambda: self.engine, builder=Builder()
        )
        service.engine = self.engine
        visitor = service.db.issue_session()["visitor_id"]
        for failure in (
            GemmaFailure(
                "generation_timeout",
                {"reply": "PRIVATE_PARTIAL", "total_seconds": 0.02},
            ),
            GemmaFailure(
                "response_truncated",
                {"reply": "PRIVATE_PARTIAL", "total_seconds": 0.02},
            ),
            InputBudgetError("fixture budget"),
            RuntimeError("fixture provider failure"),
        ):
            with self.subTest(failure=type(failure).__name__):
                job, _ = service.db.accept(
                    visitor,
                    "haruka",
                    "daily-if-v1",
                    "검증",
                    str(uuid4()),
                    now=time.time() - 0.25,
                )
                self.engine.failure = failure
                service._generate(job)
                detail = service.db.request_detail(job["job_id"])
                metrics = detail["run"]["metrics"]
                self.assertGreaterEqual(metrics["queue_seconds"], 0.25)
                self.assertGreaterEqual(metrics["service_seconds"], 0)
                self.assertEqual(metrics["service_seconds"], metrics["total_seconds"])
                self.assertNotIn("reply", metrics)
                self.assertEqual(detail["status"], "error")

    def test_reader_starts_in_db_before_inference_and_keeps_failed_output_private(self):
        from kiryu_ai.chat_prompt import ChatPromptBuilder
        from kiryu_ai.chat_reader import EvidenceReader
        from kiryu_ai.chat_server import public_job

        reader_engine = Engine()
        reader_engine.count_tokens = lambda messages: 100
        service = ChatService(
            self.root,
            engine_factory=lambda: self.engine,
            builder=ChatPromptBuilder(reader=EvidenceReader(reader_engine)),
        )
        service.engine = self.engine
        visitor = service.db.issue_session()["visitor_id"]
        for code in ("generation_timeout", "response_truncated"):
            with self.subTest(code=code):
                job, _ = service.db.accept(
                    visitor,
                    "majima",
                    "daily-if-v1",
                    "형님, 과거 이야기는?",
                    str(uuid4()),
                )

                def fail(messages, job=job, code=code, **kwargs):
                    detail = service.db.request_detail(job["job_id"])
                    self.assertEqual(detail["status"], "generating")
                    audit = detail["run"]["metadata"]["grounding"]
                    self.assertEqual(audit["stage"], "reader_generating")
                    self.assertEqual(audit["input_messages"], messages)
                    self.assertIn("candidate_ids", audit)
                    raise GemmaFailure(code, {"reply": "PRIVATE_READER_PARTIAL"})

                reader_engine.reply = fail
                service._generate(job)
                detail = service.db.request_detail(job["job_id"])
                self.assertEqual(detail["status"], "error")
                self.assertEqual(detail["run"]["output_text"], "PRIVATE_READER_PARTIAL")
                self.assertEqual(
                    detail["run"]["metadata"]["grounding"]["stage"], "reader_failed"
                )
                self.assertEqual(
                    detail["run"]["metrics"]["grounding"]["reader_result"]["reply"],
                    "PRIVATE_READER_PARTIAL",
                )
                self.assertNotIn(
                    "PRIVATE_READER_PARTIAL", json.dumps(public_job(detail))
                )
                self.assertNotIn("grounding", public_job(detail))
                self.assertEqual(
                    service.db.history(visitor, "majima", "daily-if-v1"), []
                )
                self.assertEqual(self.engine.calls, [])

    def test_successful_reader_and_renderer_keep_both_inputs_and_one_run(self):
        from kiryu_ai.chat_prompt import ChatPromptBuilder, reconstruct_input
        from kiryu_ai.chat_reader import EvidenceReader

        reader_engine = Engine()
        reader_engine.count_tokens = lambda messages: 100
        reader_engine.result["reply"] = json.dumps(
            {"mode": "conversation", "notes": [], "answer": "대화", "unknowns": []}
        )
        self.engine.count_tokens = lambda messages: 100
        service = ChatService(
            self.root,
            engine_factory=lambda: self.engine,
            builder=ChatPromptBuilder(reader=EvidenceReader(reader_engine)),
        )
        service.engine = self.engine
        visitor = service.db.issue_session()["visitor_id"]
        job, _ = service.db.accept(
            visitor, "haruka", "daily-if-v1", "안녕", str(uuid4())
        )
        service._generate(job)
        detail = service.db.request_detail(job["job_id"])
        self.assertEqual(detail["status"], "complete")
        metadata = detail["run"]["metadata"]
        self.assertEqual(metadata["stage"], "renderer_generating")
        self.assertEqual(metadata["grounding"]["stage"], "reader_complete")
        self.assertEqual(
            metadata["grounding"]["input_messages"], reader_engine.calls[0]
        )
        self.assertEqual(reconstruct_input(metadata, []), self.engine.calls[0])
        with service.db.connection() as connection:
            self.assertEqual(
                connection.execute("SELECT count(*) FROM generation_runs").fetchone()[
                    0
                ],
                1,
            )

    def test_renderer_budget_failure_preserves_completed_reader_audit(self):
        from kiryu_ai.chat_prompt import ChatPromptBuilder
        from kiryu_ai.chat_reader import EvidenceReader

        reader_engine = Engine()
        reader_engine.count_tokens = lambda messages: 100
        reader_engine.result["reply"] = json.dumps(
            {"mode": "conversation", "notes": [], "answer": "대화", "unknowns": []}
        )
        self.engine.count_tokens = lambda messages: 100_000
        service = ChatService(
            self.root,
            engine_factory=lambda: self.engine,
            builder=ChatPromptBuilder(reader=EvidenceReader(reader_engine)),
        )
        service.engine = self.engine
        visitor = service.db.issue_session()["visitor_id"]
        job, _ = service.db.accept(
            visitor, "haruka", "daily-if-v1", "안녕", str(uuid4())
        )
        service._generate(job)
        detail = service.db.request_detail(job["job_id"])
        self.assertEqual(detail["error_code"], "context_limit")
        self.assertEqual(
            detail["run"]["metadata"]["grounding"]["stage"], "reader_complete"
        )
        self.assertEqual(self.engine.calls, [])


class ProductionManifestTests(unittest.TestCase):
    """Tiny pinned fixtures exercise verification; no GGUF download or model process."""

    def setUp(self):
        from kiryu_ai import gemma_assets as assets
        from kiryu_ai.gemma_engine import MODEL_ALIAS, SAMPLING

        self.assets = assets
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        binary_dir = self.root / f"llama-{assets.BINARY_TAG}"
        binary_dir.mkdir()
        self.executable = binary_dir / "llama-server"
        self.executable.write_bytes(b"SYNTHETIC_EXECUTABLE_NOT_RUN")
        self.model = self.root / assets.MODEL_FILE
        self.model.write_bytes(b"SYNTHETIC_GGUF_NOT_LOADED")
        archive = self.root / assets.BINARY_FILE
        with tarfile.open(archive, "w:gz") as output:
            output.add(binary_dir, arcname=binary_dir.name)
        pins = patch.multiple(
            assets,
            BINARY_SHA256=assets.sha256(archive),
            MODEL_SHA256=assets.sha256(self.model),
            MODEL_BYTES=self.model.stat().st_size,
        )
        pins.start()
        self.addCleanup(pins.stop)
        self.template = "PINNED_SYNTHETIC_NATIVE_TEMPLATE"
        self.manifest = self.root / "runtime-manifest.json"
        self.key = self.root / "model-api-key.txt"
        self.key.write_text("SYNTHETIC_PRIVATE_TEST_KEY_" * 2)
        self.key.chmod(0o600)
        self.data = {
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
            "executable": str(self.executable.relative_to(self.root)),
            "files": [
                {
                    "path": str(self.executable.relative_to(self.root)),
                    "bytes": self.executable.stat().st_size,
                    "sha256": assets.sha256(self.executable),
                }
            ],
            "template_sha256": hashlib.sha256(self.template.encode()).hexdigest(),
            "context_tokens": 6144,
            "sampling": dict(SAMPLING),
            "thinking": True,
            "reasoning_budget_tokens": -1,
            "max_output_tokens": 3072,
            "generation_timeout_seconds": 120,
            "cache_prompt": False,
        }
        self.manifest.write_text(json.dumps(self.data))
        self.props = {
            "chat_template": self.template,
            "model_path": str(self.model),
            "model_alias": MODEL_ALIAS,
            "build_info": f"{assets.BINARY_TAG}-{assets.LLAMA_COMMIT[:9]}",
            "total_slots": 1,
            "default_generation_settings": {
                "n_ctx": 6144,
                "params": {"reasoning_format": "none", "lora": []},
            },
            "modalities": {"vision": False, "video": False, "audio": False},
        }
        self.native_calls = []

    def native(self, path, body=None):
        self.native_calls.append(path)
        if path == "/props":
            return copy.deepcopy(self.props)
        if path == "/apply-template":
            return {"prompt": "SYNTHETIC"}
        if path == "/tokenize":
            return {"tokens": [1, 2]}
        raise AssertionError("Unexpected model request: " + path)

    def status(self):
        app = create_app(
            self.root / ("state-" + uuid4().hex),
            manifest_path=self.manifest,
            api_key_file=self.key,
            builder=Builder(),
        )
        with (
            patch.object(GemmaEngine, "_json", side_effect=self.native),
            patch.object(
                GemmaEngine,
                "record_template",
                side_effect=AssertionError("must not rewrite"),
            ),
            TestClient(app) as client,
        ):
            end = time.monotonic() + 3
            while time.monotonic() < end:
                state = client.get("/v1/health").json()["status"]
                if state != "loading":
                    return state
                time.sleep(0.005)
        self.fail("Production readiness condition timed out")

    def test_complete_verified_deployment_connects_without_manifest_rewrite(self):
        before = self.manifest.read_bytes()
        self.assertEqual(self.status(), "ready")
        self.assertEqual(self.manifest.read_bytes(), before)
        self.assertEqual(self.native_calls, ["/props", "/apply-template", "/tokenize"])

    def test_missing_or_incomplete_manifest_never_becomes_ready_or_gets_created(self):
        self.manifest.unlink()
        self.assertEqual(self.status(), "error")
        self.assertFalse(self.manifest.exists())
        for field in ("model_sha256", "template_sha256", "files", "model_revision"):
            with self.subTest(field=field):
                incomplete = dict(self.data)
                incomplete.pop(field)
                self.manifest.write_text(json.dumps(incomplete))
                before = self.manifest.read_bytes()
                self.assertEqual(self.status(), "error")
                self.assertEqual(self.manifest.read_bytes(), before)
        self.assertEqual(self.native_calls, [])

    def test_wrong_model_identity_or_file_hash_is_rejected(self):
        for field in (
            "model_revision",
            "model_sha256",
            "archive_sha256",
            "llama_commit",
        ):
            with self.subTest(field=field):
                invalid = dict(self.data)
                invalid[field] = "unverified"
                self.manifest.write_text(json.dumps(invalid))
                self.assertEqual(self.status(), "error")
        invalid = copy.deepcopy(self.data)
        invalid["files"][0]["sha256"] = "0" * 64
        self.manifest.write_text(json.dumps(invalid))
        self.assertEqual(self.status(), "error")
        self.manifest.write_text(json.dumps(self.data))
        original = self.executable.read_bytes()
        self.executable.write_bytes(b"REPLACED_EXECUTABLE")
        self.assertEqual(self.status(), "error")
        self.executable.write_bytes(original)
        self.model.write_bytes(b"REPLACED_MODEL")
        self.assertEqual(self.status(), "error")
        self.assertEqual(self.native_calls, [])

    def test_native_template_and_runtime_must_match_recorded_deployment(self):
        valid_props = copy.deepcopy(self.props)
        for field, value in (
            ("chat_template", "DIFFERENT_TEMPLATE"),
            ("model_path", str(self.root / "different.gguf")),
            ("build_info", "different-build"),
            ("total_slots", 4),
            ("default_generation_settings", {"n_ctx": 8192}),
            ("modalities", {"vision": True, "video": False, "audio": False}),
        ):
            with self.subTest(field=field):
                self.props = {**valid_props, field: value}
                before = self.manifest.read_bytes()
                self.assertEqual(self.status(), "error")
                self.assertEqual(self.manifest.read_bytes(), before)
        self.assertNotIn("/apply-template", self.native_calls)

    def test_production_model_key_is_required_and_private(self):
        with self.assertRaises(ValueError):
            create_app(
                self.root / "no-key", manifest_path=self.manifest, builder=Builder()
            )
        self.key.chmod(0o644)
        self.assertEqual(self.status(), "error")
        self.key.chmod(0o600)
        self.key.write_text("short")
        self.assertEqual(self.status(), "error")
        self.key.unlink()
        self.assertEqual(self.status(), "error")
        self.assertEqual(self.native_calls, [])


if __name__ == "__main__":
    unittest.main()
