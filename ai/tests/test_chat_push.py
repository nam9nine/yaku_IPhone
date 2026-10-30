"""Web Push uses synthetic recipients, fake clocks and intercepted transport only."""

import base64
import copy
import json
import socket
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from kiryu_ai.chat_db import ChatDB
from kiryu_ai.chat_push import (
    MAX_ATTEMPTS,
    PUSH_TTL,
    ChatPush,
    SubscriptionConflict,
    reply_delay_seconds,
    send_webpush,
    validate_endpoint,
    validate_subscription,
)
from kiryu_ai.chat_server import PAGES_ORIGIN, create_app
from starlette.testclient import TestClient
from test_chat_server import Builder, Engine


def subscription(suffix="one", host="web.push.apple.com"):
    public = (
        ec.generate_private_key(ec.SECP256R1())
        .public_key()
        .public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    )
    encode = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    return {
        "endpoint": f"https://{host}/subscription/{suffix}",
        "keys": {"p256dh": encode(public), "auth": encode(b"a" * 16)},
        "expirationTime": None,
    }


class PushTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.now = 1_800_000_000.0
        self.db = ChatDB(self.root / "chat.sqlite3")
        self.a = self.db.issue_session(now=self.now)["visitor_id"]
        self.b = self.db.issue_session(now=self.now)["visitor_id"]
        self.sent = []
        self.status = 201

        def sender(sub, payload, key, ttl):
            self.sent.append((copy.deepcopy(sub), copy.deepcopy(payload), key, ttl))
            if self.status is None:
                raise OSError("secret provider body must never be recorded")
            return SimpleNamespace(status_code=self.status)

        self.sender = sender
        self.push = ChatPush(
            self.root / "push", self.db, sender=sender, clock=lambda: self.now
        )
        self.info = subscription()
        self.sid = self.push.subscribe(self.a, self.info)

    def tearDown(self):
        self.directory.cleanup()

    def complete(
        self,
        visitor=None,
        character="haruka",
        *,
        accepted=None,
        completed=None,
        phone_events=None,
    ):
        accepted = self.now + 1 if accepted is None else accepted
        completed = accepted + 5 if completed is None else completed
        request_id = str(uuid4())
        job, _ = self.db.accept(
            visitor or self.a,
            character,
            "daily-if-v1",
            "synthetic input",
            request_id,
            now=accepted,
            phone_events=phone_events or [],
        )
        self.db.begin_run(job["job_id"], [], {}, now=accepted + 0.1)
        self.db.complete(job["job_id"], "합성 답장입니다.", now=completed)
        return job["job_id"], request_id, accepted, completed

    def test_calls_remain_in_db_but_never_enqueue_sms_push_or_increment_sms_count(self):
        self.complete(phone_events=["haruka-call-live"])
        self.now += 40
        self.assertFalse(self.push.tick())
        self.assertEqual(self.sent, [])
        self.assertEqual(self.rows("outbox"), [])
        history = self.db.history_page(self.a, "haruka", "daily-if-v1")
        self.assertEqual(len(history["messages"]), 2)
        self.assertEqual(history["completed_exchanges"], 0)
        sms, _, _, _ = self.complete()
        self.now += 40
        self.assertTrue(self.push.tick())
        self.assertEqual(self.sent[0][1]["job_id"], sms)
        self.assertEqual(
            self.db.history_page(self.a, "haruka", "daily-if-v1")[
                "completed_exchanges"
            ],
            1,
        )

    def test_episode_invitation_never_enters_push_outbox(self):
        from kiryu_ai.episodes import EPISODE_ID

        state = self.db.episodes.initial()
        with self.db.connection(write=True) as con:
            self.db.episodes.save(con, self.a, "daily-if-v1", state)
        ref = {
            "episode_id": EPISODE_ID,
            "instance_id": state["instance_id"],
            "version": state["version"],
            "stage": "invite",
        }
        job, _ = self.db.accept(
            self.a,
            "majima",
            "daily-if-v1",
            None,
            str(uuid4()),
            episode_ref=ref,
            now=self.now + 1,
        )
        self.db.begin_run(job["job_id"], [], {}, now=self.now + 1)
        self.db.complete(job["job_id"], "합성 초대", now=self.now + 2)
        self.now += 60
        self.assertFalse(self.push.tick())
        self.assertEqual(self.sent, [])
        self.assertEqual(self.rows("outbox"), [])

    def test_generated_call_followup_push_has_no_random_or_reading_delay(self):
        job, _ = self.db.accept(
            self.a,
            "majima",
            "daily-if-v1",
            None,
            str(uuid4()),
            trigger={
                "call_id": "fast-call",
                "reason": "missed",
                "direction": "incoming",
            },
            now=self.now + 1,
        )
        self.db.begin_run(job["job_id"], [], {}, now=self.now + 1)
        self.db.complete(job["job_id"], "검사용 짧은 후속 문자", now=self.now + 2)
        self.now += 2
        self.assertTrue(self.push.tick())
        self.assertEqual(self.sent[0][1]["job_id"], job["job_id"])
        self.assertEqual(self.rows("outbox")[0]["not_before"], self.now)
        # Original completion still produces only one notification on scans.
        self.assertFalse(self.push.tick())
        self.assertEqual(len(self.sent), 1)

    def test_previously_queued_call_push_is_rejected_at_delivery(self):
        call, _, _, _ = self.complete(phone_events=["haruka-call-live"])
        self.now += 40
        with self.push.connection() as connection:
            connection.execute(
                "INSERT INTO outbox VALUES (?,?,?,?, 'pending',0,?,NULL)",
                (self.sid, call, self.now - 1, self.now + 100, self.now - 1),
            )
        self.assertFalse(self.push.tick())
        self.assertEqual(self.sent, [])
        self.assertEqual(self.rows("outbox")[0]["state"], "failed")

    def rows(self, table):
        with self.push.connection() as connection:
            return [dict(row) for row in connection.execute("SELECT * FROM " + table)]

    def presence(
        self, *, active=True, sequence=1, jobs=None, client=None, visitor=None, sid=None
    ):
        self.push.foreground(
            visitor or self.a,
            {
                "subscription_id": sid or self.sid,
                "client_id": client or "00000000-0000-4000-8000-000000000001",
                "sequence": sequence,
                "active": active,
                "job_ids": jobs or [],
            },
        )

    def test_foreground_defers_native_push_and_delivery_receipt_prevents_old_alert_on_exit(
        self,
    ):
        job, _, _, _ = self.complete()
        self.now += 40
        self.presence()
        self.assertFalse(self.push.tick())
        self.assertEqual(self.rows("outbox")[0]["attempts"], 0)
        self.presence(active=False, sequence=2, jobs=[job])
        self.assertFalse(self.push.tick())
        self.assertEqual(self.sent, [])
        other, _, _, _ = self.complete()
        self.now += 40
        self.assertTrue(self.push.tick())
        self.assertEqual(self.sent[0][1]["job_id"], other)

    def test_one_foreground_device_does_not_suppress_another_subscription(self):
        second = self.push.subscribe(self.a, subscription("other-device"))
        job, _, _, _ = self.complete()
        self.now += 40
        self.presence()
        self.assertTrue(self.push.tick())
        self.assertEqual(self.sent[0][1]["subscription_id"], second)
        self.assertEqual(self.sent[0][1]["job_id"], job)
        self.assertFalse(self.push.tick())
        self.presence(active=False, sequence=2, jobs=[job])
        self.assertFalse(self.push.tick())
        self.assertEqual(len(self.sent), 1)

    def test_stale_delivery_receipt_is_kept_after_newer_exit_update(self):
        job, _, _, _ = self.complete()
        self.now += 40
        self.presence(sequence=3, active=False)
        self.presence(sequence=2, active=True, jobs=[job])
        self.assertEqual(self.rows("foreground_clients")[0]["sequence"], 3)
        self.assertEqual(self.rows("foreground_receipts")[0]["job_id"], job)
        self.assertFalse(self.push.tick())
        self.assertEqual(self.sent, [])

    def test_crashed_foreground_lease_expires_and_unseen_reply_still_pushes(self):
        self.complete()
        self.now += 40
        self.presence()
        self.assertFalse(self.push.tick())
        self.now += 26
        self.assertTrue(self.push.tick())

    def test_presence_is_subscription_owned_and_stale_exit_cannot_override_new_active(
        self,
    ):
        _job, _, _, _ = self.complete()
        self.now += 40
        with self.assertRaises(ValueError):
            self.presence(visitor=self.b)
        second = self.push.subscribe(self.a, subscription("second-device"))
        self.presence(sequence=3)
        self.presence(sequence=2, active=False)
        self.assertEqual(len(self.rows("foreground_clients")), 1)
        self.assertEqual(self.rows("foreground_clients")[0]["sequence"], 3)
        # One window leaving must not override another live window on the same device.
        self.presence(client=str(uuid4()))
        self.presence(sequence=4, active=False)
        self.assertFalse(self.push.tick())
        self.assertEqual(self.sent, [])
        self.assertNotEqual(second, self.sid)
        foreign, _, _, _ = self.complete(visitor=self.b)
        self.presence(sequence=5, jobs=[foreign])
        self.assertEqual(self.rows("foreground_receipts"), [])

    def test_delay_is_stable_uuid_fnv_and_in_range(self):
        self.assertEqual(
            reply_delay_seconds("00000000-0000-4000-8000-000000000001"), 11.533
        )
        for _ in range(50):
            value = str(uuid4())
            delay = reply_delay_seconds(value)
            self.assertEqual(delay, reply_delay_seconds(value))
            self.assertGreaterEqual(delay, 10)
            self.assertLessEqual(delay, 20)

    def test_subscriptions_are_idempotent_private_and_owned(self):
        self.assertEqual(self.push.subscribe(self.a, self.info), self.sid)
        with self.assertRaises(SubscriptionConflict):
            self.push.subscribe(self.b, self.info)
        self.push.unsubscribe(self.b, self.info["endpoint"])
        self.assertEqual(len(self.rows("subscriptions")), 1)
        for path in [self.push.path, self.push.key_path]:
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        public = self.push.public_key
        restarted = ChatPush(self.root / "push", self.db, sender=self.sender)
        self.assertEqual(restarted.public_key, public)
        self.assertNotIn(
            self.info["endpoint"],
            json.dumps(self.db.history(self.a, "haruka", "daily-if-v1")),
        )

    def test_endpoint_and_key_changes_rotate_binding(self):
        changed = subscription()
        new_id = self.push.subscribe(self.a, changed)
        self.assertNotEqual(new_id, self.sid)
        self.assertEqual(len(self.rows("subscriptions")), 1)
        for index in range(3):
            self.push.subscribe(self.a, subscription(str(index)))
        with self.assertRaises(ValueError):
            self.push.subscribe(self.a, subscription("over-limit"))

    def test_no_early_delivery_and_exact_payload_scope(self):
        job, request, accepted, completed = self.complete()
        delay = reply_delay_seconds(request)
        release = max(accepted + delay + 1.5, completed + delay)
        self.now = release - 0.001
        self.assertFalse(self.push.tick())
        self.assertEqual(self.sent, [])
        self.now = release
        self.assertTrue(self.push.tick())
        self.assertEqual(
            self.sent[0][1],
            {
                "type": "chat.reply",
                "subscription_id": self.sid,
                "notification_id": job,
                "job_id": job,
                "character": "haruka",
                "title": "하루카",
                "body": "합성 답장입니다.",
                "url": "/yaku_IPhone/?conversation=haruka",
            },
        )
        self.assertGreater(self.sent[0][3], 0)
        self.assertLessEqual(self.sent[0][3], PUSH_TTL)
        self.assertFalse(self.push.tick())
        self.assertEqual(len(self.sent), 1)

    def test_fast_completion_still_reserves_minimum_typing(self):
        job, request, accepted, _ = self.complete(completed=self.now + 1.01)
        self.now = accepted + reply_delay_seconds(request) + 1.49
        self.push.tick()
        self.assertEqual(self.sent, [])
        self.now += 0.02
        self.assertTrue(self.push.tick())
        self.assertEqual(self.sent[0][1]["job_id"], job)

    def test_completed_reply_survives_restart_without_duplicate_send(self):
        self.complete()
        self.now += 100
        restarted = ChatPush(
            self.root / "push", self.db, sender=self.sender, clock=lambda: self.now
        )
        self.assertTrue(restarted.tick())
        again = ChatPush(
            self.root / "push", self.db, sender=self.sender, clock=lambda: self.now
        )
        self.assertFalse(again.tick())
        self.assertEqual(len(self.sent), 1)

    def test_subscribing_during_generation_receives_the_new_completion(self):
        job, _ = self.db.accept(
            self.b, "majima", "daily-if-v1", "in flight", str(uuid4()), now=self.now - 2
        )
        self.db.begin_run(job["job_id"], [], {}, now=self.now - 1)
        second = self.push.subscribe(self.b, subscription("new"))
        self.db.complete(job["job_id"], "도착한 답장", now=self.now + 1)
        self.now += 100
        self.assertTrue(self.push.tick())
        self.assertEqual(self.sent[0][1]["subscription_id"], second)
        self.assertEqual(self.sent[0][1]["job_id"], job["job_id"])

    def test_no_other_visitor_failed_or_historical_reply(self):
        self.complete(self.b)
        self.complete(accepted=self.now - 10, completed=self.now - 5)
        job, _ = self.db.accept(
            self.a,
            "haruka",
            "daily-if-v1",
            "failed input",
            str(uuid4()),
            now=self.now + 2,
        )
        self.db.fail(
            job["job_id"], "response_truncated", output="partial", now=self.now + 3
        )
        self.now += 100
        self.assertFalse(self.push.tick())
        self.assertEqual(self.sent, [])
        self.assertEqual(self.rows("outbox"), [])

    def test_durable_scan_paginates_completions_without_dropping_same_time_rows(self):
        for i in range(70):
            self.complete(accepted=self.now + 1, completed=self.now + 2)
        self.now += 100
        self.push.scan()
        self.assertEqual(len(self.rows("outbox")), 64)
        self.push.scan()
        self.assertEqual(len(self.rows("outbox")), 70)
        self.push.scan()
        self.assertEqual(len(self.rows("outbox")), 70)

    def test_nonretryable_error_finishes_without_exposing_provider_diagnostics(self):
        self.complete()
        self.now += 100
        self.status = 403
        self.push.tick()
        self.now += 100
        self.push.tick()
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.rows("outbox")[0]["last_error"], "provider_rejected")

    def test_retry_is_bounded_and_never_changes_chat_success(self):
        job, _, _, _ = self.complete()
        self.now += 100
        self.status = None
        for _ in range(MAX_ATTEMPTS + 2):
            self.push.tick()
            self.now += 100
        self.assertEqual(len(self.sent), MAX_ATTEMPTS)
        outbox = self.rows("outbox")[0]
        self.assertEqual(outbox["state"], "failed")
        self.assertNotIn("secret", json.dumps(outbox))
        self.assertEqual(self.db.get_request(job)["status"], "complete")
        self.assertEqual(self.db.get_request(job)["reply"], "합성 답장입니다.")

    def test_gone_endpoint_is_removed_with_queued_outbox(self):
        self.complete()
        self.now += 100
        self.status = 410
        self.push.tick()
        self.assertEqual(self.rows("subscriptions"), [])
        self.assertEqual(self.rows("outbox"), [])

    def test_expiry_and_logout_do_not_deliver(self):
        self.complete()
        self.now += PUSH_TTL + 100
        self.assertFalse(self.push.tick())
        self.assertEqual(self.sent, [])
        with self.db.connection(write=True) as connection:
            connection.execute(
                "UPDATE sessions SET revoked=1 WHERE visitor_id=?", (self.a,)
            )
        self.push.tick()
        self.assertEqual(self.rows("subscriptions"), [])

    def test_unsubscribe_and_stale_claim_cannot_send(self):
        self.complete()
        self.now += 100
        self.push.scan()
        self.push.unsubscribe(self.a, self.info["endpoint"])
        self.assertFalse(self.push.tick())
        self.assertEqual(self.sent, [])

    def test_claim_lease_prevents_parallel_send_and_retries_crash(self):
        self.complete()
        self.now += 100
        self.push.scan()
        first = self.push._claim()
        self.assertIsNotNone(first)
        self.assertIsNone(self.push._claim())
        self.now += 31
        second = self.push._claim()
        self.assertEqual(first["job_id"], second["job_id"])
        self.assertEqual(second["attempts"], 2)

    def test_sender_encrypts_and_discards_provider_body_without_network(self):
        captured = []

        def request(_session, method, url, **kwargs):
            captured.append((method, url, kwargs))
            response = requests.Response()
            response.status_code = 201
            response._content = b"private-provider-diagnostics"
            response._content_consumed = True
            return response

        with (
            patch(
                "socket.getaddrinfo",
                return_value=[
                    (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
                ],
            ),
            patch.object(requests.Session, "request", request),
        ):
            response = send_webpush(
                self.info, {"body": "synthetic secret"}, self.push.key_path, 12
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.text, "")
        method, url, kwargs = captured[0]
        self.assertEqual(method, "POST")
        self.assertEqual(url, self.info["endpoint"])
        self.assertFalse(kwargs["allow_redirects"])
        self.assertTrue(kwargs["stream"])
        self.assertEqual(kwargs["timeout"], (3, 5))
        self.assertNotIn(b"synthetic secret", kwargs["data"])
        self.assertIn("vapid", kwargs["headers"]["Authorization"].lower())

    def test_sender_rejects_private_dns_before_transport(self):
        with (
            patch(
                "socket.getaddrinfo",
                return_value=[
                    (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))
                ],
            ),
            patch.object(requests.Session, "request") as request,
        ):
            with self.assertRaises(ValueError):
                send_webpush(self.info, {}, self.push.key_path, 12)
            request.assert_not_called()


class SubscriptionValidationTests(unittest.TestCase):
    def test_only_explicit_https_push_provider_origins(self):
        for host in [
            "web.push.apple.com",
            "cn.push.apple.com",
            "fcm.googleapis.com",
            "updates.push.services.mozilla.com",
        ]:
            self.assertEqual(
                validate_endpoint("https://" + host + "/token"),
                "https://" + host + "/token",
            )
        for endpoint in [
            "http://web.push.apple.com/token",
            "https://127.0.0.1/token",
            "https://web.push.apple.com.evil.test/x",
            "https://evil.test/?target=web.push.apple.com",
            "https://user@web.push.apple.com/x",
            "https://web.push.apple.com:8443/x",
            "https://web.push.apple.com/x#secret",
            "https://web.push.apple.com\\@evil.test/x",
            "https://web.push.apple.com/x\n",
            "https://web.push.apple.com/",
        ]:
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                validate_endpoint(endpoint)

    def test_keys_must_be_valid_curve_point_and_auth_secret(self):
        for field, bad in [
            ("auth", "short"),
            ("auth", "!" * 22),
            ("p256dh", "A" * 87),
            ("p256dh", "A" * 1000),
        ]:
            info = subscription()
            info["keys"][field] = bad
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_subscription(info)
        info = subscription()
        self.assertEqual(validate_subscription(info)["endpoint"], info["endpoint"])
        info["unexpected"] = "not accepted"
        with self.assertRaises(ValueError):
            validate_subscription(info)


class PushApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.app = create_app(
            self.directory.name,
            engine_factory=Engine,
            builder=Builder(),
            push_sender=lambda *_: SimpleNamespace(status_code=201),
        )
        self.client = TestClient(self.app).__enter__()
        token = self.client.post("/v1/sessions", json={}).json()["token"]
        self.auth = {"Authorization": "Bearer " + token, "Origin": PAGES_ORIGIN}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def test_key_and_registration_require_session_and_delete_is_scoped(self):
        self.assertEqual(self.client.get("/v1/push/key").status_code, 401)
        response = self.client.get("/v1/push/key", headers=self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            len(base64.urlsafe_b64decode(response.json()["public_key"] + "=")), 65
        )
        info = subscription()
        response = self.client.post(
            "/v1/push/subscriptions",
            headers=self.auth,
            json={"subscription": info, "platform": "web"},
        )
        self.assertEqual(response.status_code, 200)
        identifier = response.json()["id"]
        other = self.client.post("/v1/sessions", json={}).json()["token"]
        auth = {"Authorization": "Bearer " + other}
        self.assertEqual(
            self.client.post(
                "/v1/push/subscriptions",
                headers=auth,
                json={"subscription": info, "platform": "web"},
            ).status_code,
            409,
        )
        self.assertEqual(
            self.client.request(
                "DELETE",
                "/v1/push/subscriptions",
                headers=auth,
                json={"endpoint": info["endpoint"]},
            ).status_code,
            200,
        )
        with self.app.state.service.push.connection() as connection:
            self.assertIsNotNone(
                connection.execute(
                    "SELECT 1 FROM subscriptions WHERE id=?", (identifier,)
                ).fetchone()
            )
        self.assertEqual(
            self.client.request(
                "DELETE",
                "/v1/push/subscriptions",
                headers=self.auth,
                json={"endpoint": info["endpoint"]},
            ).status_code,
            200,
        )

    def test_foreground_http_is_owned_authenticated_and_sequence_fenced(self):
        info = subscription()
        sid = self.client.post(
            "/v1/push/subscriptions",
            headers=self.auth,
            json={"subscription": info, "platform": "web"},
        ).json()["id"]
        presence = {
            "subscription_id": sid,
            "client_id": str(uuid4()),
            "sequence": 2,
            "active": True,
            "job_ids": [],
        }
        self.assertEqual(
            self.client.post(
                "/v1/push/subscriptions", json={"presence": presence}
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.post(
                "/v1/push/subscriptions", headers=self.auth, json={"presence": presence}
            ).status_code,
            200,
        )
        other = self.client.post("/v1/sessions", json={}).json()["token"]
        self.assertEqual(
            self.client.post(
                "/v1/push/subscriptions",
                headers={"Authorization": "Bearer " + other},
                json={"presence": presence},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                "/v1/push/subscriptions",
                headers=self.auth,
                json={"presence": {**presence, "active": False, "sequence": 1}},
            ).status_code,
            200,
        )
        with self.app.state.service.push.connection() as connection:
            row = connection.execute(
                "SELECT * FROM foreground_clients WHERE subscription_id=?", (sid,)
            ).fetchone()
            self.assertEqual(row["sequence"], 2)
            self.assertGreater(row["expires_at"], time.time())

    def test_push_preflight_allows_delete_but_invalid_body_never_registers(self):
        response = self.client.options(
            "/v1/push/subscriptions",
            headers={
                "Origin": PAGES_ORIGIN,
                "Access-Control-Request-Method": "DELETE",
                "Access-Control-Request-Headers": "Authorization, Content-Type",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("DELETE", response.headers["Access-Control-Allow-Methods"])
        self.assertEqual(
            self.client.post(
                "/v1/push/subscriptions",
                headers=self.auth,
                json={"subscription": subscription(), "platform": "native"},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                "/v1/push/subscriptions",
                headers=self.auth,
                json={
                    "subscription": {"endpoint": "https://127.0.0.1/x"},
                    "platform": "web",
                },
            ).status_code,
            400,
        )


if __name__ == "__main__":
    unittest.main()
