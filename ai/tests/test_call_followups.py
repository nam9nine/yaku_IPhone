"""CPU contract tests: call outcomes never create a fictional user utterance."""

import copy
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

from kiryu_ai.chat_db import ChatDB, RequestConflict
from kiryu_ai.chat_prompt import ChatPromptBuilder, reconstruct_input
from kiryu_ai.chat_server import create_app
from starlette.testclient import TestClient


class FollowupEngine:
    def __init__(self):
        self.manifest = {"model_file": "CPU_FOLLOWUP_TEST"}
        self.calls = []
        self.gate = threading.Event()
        self.gate.set()
        self.finish_reason = "stop"

    def count_tokens(self, messages):
        # CPU contract only; production always uses native Gemma tokenization.
        return len(str(messages)) // 4

    def reply(self, messages, **options):
        self.calls.append((copy.deepcopy(messages), options))
        if not self.gate.wait(5):
            raise RuntimeError("test timeout")
        return {"reply": "검사용 발신 문자", "finish_reason": self.finish_reason}


class FollowupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.engine = FollowupEngine()
        self.app = create_app(
            self.root, engine_factory=lambda: self.engine, builder=ChatPromptBuilder()
        )
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.wait(lambda: self.client.get("/v1/health").json()["status"] == "ready")
        session = self.client.post("/v1/sessions", json={}).json()
        self.auth = {"Authorization": "Bearer " + session["token"]}
        self.db = self.app.state.service.db
        self.visitor = self.db.authenticate(session["token"])["visitor_id"]

    def tearDown(self):
        self.engine.gate.set()
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def wait(self, condition):
        end = time.monotonic() + 4
        while time.monotonic() < end:
            result = condition()
            if result:
                return result
            time.sleep(0.005)
        self.fail("CPU condition timed out")

    def body(self, character="majima", **extra):
        return {
            "character": character,
            "request_id": str(uuid4()),
            "call_id": str(uuid4()),
            "reason": "missed",
            "direction": "incoming",
            **extra,
        }

    def send(self, body=None, **options):
        return self.client.post(
            "/v1/call-followups",
            json=body or self.body(),
            headers=options.pop("headers", self.auth),
            **options,
        )

    def finish(self, job_id):
        def poll():
            job = self.client.get("/v1/jobs/" + job_id, headers=self.auth).json()
            return job if job["status"] in ("complete", "error") else None

        return self.wait(poll)

    def test_both_contacts_have_assistant_only_history_and_auditable_event_inputs(self):
        for character, reason, direction in (
            ("majima", "missed", "incoming"),
            ("haruka", "idle", "outgoing"),
        ):
            with self.subTest(character=character):
                body = self.body(character, reason=reason, direction=direction)
                response = self.send(body)
                self.assertEqual(response.status_code, 202, response.text)
                job = self.finish(response.json()["job_id"])
                self.assertEqual(job["status"], "complete")
                self.assertEqual(job["request_kind"], "call_followup")
                self.assertNotIn("message", job["request"])
                self.assertEqual(job["request"]["kind"], "call_followup")
                self.assertEqual(
                    job["request"]["trigger"],
                    {k: body[k] for k in ("call_id", "reason", "direction")},
                )
                page = self.client.get(
                    "/v1/history?character=" + character, headers=self.auth
                ).json()
                self.assertEqual(len(page["messages"]), 1)
                self.assertEqual(page["messages"][0]["role"], "assistant")
                self.assertEqual(page["messages"][0]["request_kind"], "call_followup")
                self.assertEqual(page["completed_exchanges"], 0)
                self.assertEqual(
                    self.db.history(self.visitor, character, "daily-if-v1"), []
                )
                detail = self.db.request_detail(job["job_id"])
                metadata = detail["run"]["metadata"]
                self.assertEqual(
                    metadata["generation_options"],
                    {"thinking": False, "max_tokens": 96},
                )
                self.assertEqual(metadata["input_envelope_kind"], "application-event")
                self.assertEqual(
                    reconstruct_input(metadata, detail["messages"]),
                    self.engine.calls[-1][0],
                )
                self.assertEqual(self.engine.calls[-1][1]["max_tokens"], 96)
                self.assertEqual(len(self.db.review_queue(character=character)), 1)
                self.assertEqual(
                    self.db.export_cases([job["job_id"]])[0]["request_kind"],
                    "call_followup",
                )

    def test_next_text_sees_own_notice_but_keeps_paired_dialogue_and_isolation(self):
        job = self.finish(self.send(self.body()).json()["job_id"])
        notice = self.db.recent_notices(self.visitor, "majima", "daily-if-v1")[0]
        self.assertEqual(notice["call_trigger"]["reason"], "missed")
        self.assertEqual(
            self.db.recent_notices(self.visitor, "haruka", "daily-if-v1"), []
        )
        other = self.db.issue_session()["visitor_id"]
        self.assertEqual(self.db.recent_notices(other, "majima", "daily-if-v1"), [])
        response = self.client.post(
            "/v1/chat",
            headers=self.auth,
            json={
                "character": "majima",
                "message": "아까 보내신 문자 봤어요",
                "request_id": str(uuid4()),
            },
        )
        normal = self.finish(response.json()["job_id"])
        self.assertEqual(normal["status"], "complete")
        detail = self.db.request_detail(normal["job_id"])
        self.assertEqual(
            detail["run"]["metadata"]["notice_message_ids"], [notice["id"]]
        )
        self.assertIn(
            "my_prior_call_followup_texts", self.engine.calls[-1][0][-1]["content"]
        )
        self.assertIn('"reason":"missed"', self.engine.calls[-1][0][-1]["content"])
        self.assertEqual(
            [m["role"] for m in self.db.history(self.visitor, "majima", "daily-if-v1")],
            ["user", "assistant"],
        )
        self.assertEqual(len(detail["messages"]), 3)
        self.assertEqual(
            reconstruct_input(detail["run"]["metadata"], detail["messages"]),
            self.engine.calls[-1][0],
        )
        self.assertNotEqual(normal["job_id"], job["job_id"])

    def test_duplicates_share_call_identity_but_changed_uuid_payload_conflicts(self):
        body = self.body()
        first = self.send(body).json()["job_id"]
        self.finish(first)
        self.assertEqual(self.send(body).json()["job_id"], first)
        self.assertEqual(
            self.send({**body, "request_id": str(uuid4())}).json()["job_id"], first
        )
        self.assertEqual(self.send({**body, "reason": "declined"}).status_code, 409)
        # A browser reporting the same call twice with a new reason still cannot
        # cause two texts. Original trigger and request ID remain authoritative.
        other = self.send({**body, "request_id": str(uuid4()), "reason": "declined"})
        self.assertEqual(other.json()["job_id"], first)
        self.assertEqual(len(self.engine.calls), 1)
        self.app.state.service.status = "unavailable"
        self.assertEqual(self.send(body).json()["job_id"], first)

    def test_auth_validation_and_other_visitor_cannot_read_job(self):
        self.assertEqual(self.send(headers={}).status_code, 401)
        for changes in (
            {"call_id": ""},
            {"call_id": "x" * 81},
            {"call_id": "한글"},
            {"reason": "invented"},
            {"reason": "missed", "direction": "outgoing"},
            {"reason": "declined", "direction": "outgoing"},
            {"message": "fake"},
            {"phone_events": ["majima-call-live"]},
            {"phone_events": ["haruka-call-idle"]},
        ):
            with self.subTest(changes=changes):
                self.assertEqual(self.send(self.body(**changes)).status_code, 400)
        job = self.finish(self.send().json()["job_id"])
        token = self.client.post("/v1/sessions", json={}).json()["token"]
        self.assertEqual(
            self.client.get(
                "/v1/jobs/" + job["job_id"],
                headers={"Authorization": "Bearer " + token},
            ).status_code,
            404,
        )

    def test_followup_and_other_contact_share_single_fifo_without_parallel_generation(
        self,
    ):
        self.engine.gate.clear()
        first = self.send(self.body()).json()["job_id"]
        self.wait(lambda: len(self.engine.calls) == 1)
        response = self.client.post(
            "/v1/chat",
            headers=self.auth,
            json={"character": "haruka", "message": "안녕", "request_id": str(uuid4())},
        )
        self.assertEqual(response.status_code, 202)
        second = response.json()["job_id"]
        self.assertEqual(
            self.client.get("/v1/jobs/" + second, headers=self.auth).json()["status"],
            "queued",
        )
        self.assertEqual(self.send(self.body()).status_code, 409)
        self.assertEqual(len(self.engine.calls), 1)
        self.engine.gate.set()
        self.assertEqual(self.finish(first)["status"], "complete")
        self.assertEqual(self.finish(second)["status"], "complete")
        self.assertEqual(len(self.engine.calls), 2)

    def test_truncation_is_private_not_future_notice_and_restart_preserves_success(
        self,
    ):
        self.engine.finish_reason = "length"
        failed = self.finish(self.send().json()["job_id"])
        self.assertEqual(failed["status"], "error")
        self.assertEqual(
            self.db.recent_notices(self.visitor, "majima", "daily-if-v1"), []
        )
        self.assertEqual(
            self.db.history_page(self.visitor, "majima", "daily-if-v1")["messages"], []
        )
        self.assertEqual(
            self.db.request_detail(failed["job_id"])["run"]["output_text"],
            "검사용 발신 문자",
        )
        self.engine.finish_reason = "stop"
        completed = self.finish(self.send().json()["job_id"])
        reopened = ChatDB(self.db.path)
        self.assertEqual(
            reopened.get_request(completed["job_id"])["reply"], "검사용 발신 문자"
        )
        self.assertEqual(
            len(reopened.recent_notices(self.visitor, "majima", "daily-if-v1")), 1
        )

    def test_db_concurrent_call_dedupe_and_interrupted_job_never_create_user(self):
        trigger = {"call_id": "atomic-call", "reason": "idle", "direction": "incoming"}

        def accept(_):
            return self.db.accept(
                self.visitor,
                "majima",
                "daily-if-v1",
                None,
                str(uuid4()),
                trigger=trigger,
            )

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(accept, range(8)))
        self.assertEqual(sum(created for _, created in results), 1)
        job = results[0][0]
        repeated, created = self.db.accept(
            self.visitor,
            "majima",
            "daily-if-v1",
            None,
            job["request_id"],
            trigger=dict(reversed(tuple(trigger.items()))),
        )
        self.assertFalse(created)
        self.assertEqual(repeated["job_id"], job["job_id"])
        with self.assertRaises(RequestConflict):
            self.db.accept(
                self.visitor, "majima", "daily-if-v1", "fake", job["request_id"]
            )
        self.db.recover_interrupted()
        self.assertEqual(self.db.get_request(job["job_id"])["status"], "error")
        self.assertEqual(
            self.db.history_page(self.visitor, "majima", "daily-if-v1")["messages"], []
        )
