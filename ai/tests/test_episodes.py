"""Synthetic episode state, migration, queue races and wire compatibility."""

import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from kiryu_ai.chat_db import SCHEMA, ChatDB
from kiryu_ai.chat_queue import CancellableFIFO
from kiryu_ai.chat_server import SCENARIO, create_app
from kiryu_ai.episodes import EPISODE_ID, validate_command
from starlette.testclient import TestClient
from test_chat_server import Builder, Engine


class EpisodeBuilder(Builder):
    def build_episode(self, *, episode_context, history, **kwargs):
        return {
            "messages": [{"role": "user", "content": "synthetic invitation"}],
            "metadata": {"episode_context": episode_context},
            "retrieval_hits": [],
        }

    def build_followup(self, *, trigger, episode_context=None, **kwargs):
        return {
            "messages": [{"role": "user", "content": trigger["reason"]}],
            "metadata": {"episode_context": episode_context},
            "retrieval_hits": [],
        }

    def build(self, *, user_message, **kwargs):
        callback = kwargs.get("on_episode_decision")
        context = kwargs.get("episode_context")
        if callback:
            callback(
                {
                    "episode_id": EPISODE_ID,
                    "version": context["version"],
                    "decision": "cancel",
                    "evidence_message_id": kwargs["current_message_id"],
                }
            )
        result = super().build(user_message=user_message, **kwargs)
        result["metadata"]["episode_context"] = context
        return result


class EpisodeDBTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "chat.sqlite3"
        self.db = ChatDB(self.path)
        self.visitor = self.db.issue_session()["visitor_id"]
        self.client = str(uuid4())
        self.seq = 0

    def tearDown(self):
        self.temp.cleanup()

    def command(self, kind="presence", *, client=None, now=1000, busy=False, **fields):
        self.seq += 1
        value = {
            "protocol": 1,
            "client_id": client or self.client,
            "sequence": self.seq,
            "kind": kind,
            **fields,
        }
        return self.db.episodes.command(
            self.visitor, SCENARIO, value, now=now, busy=busy
        )

    def advance(self):
        for n in range(10):
            self.command(active=True, now=1000 + n * 10)
        return self.db.episodes.get(self.visitor, SCENARIO)

    def invitation(self):
        state = self.advance()
        ref = {
            "episode_id": EPISODE_ID,
            "instance_id": state["instance_id"],
            "version": state["version"],
            "stage": "invite",
        }
        job, _ = self.db.accept(
            self.visitor, "majima", SCENARIO, None, str(uuid4()), episode_ref=ref
        )
        self.db.begin_run(job["job_id"], [], {})
        self.db.complete(job["job_id"], "볼링 검사용 초대")
        return job

    def test_clock_counts_one_tab_and_never_offline_gap(self):
        self.command(active=True, now=1000)
        self.command(active=True, now=1010)
        other = str(uuid4())
        self.command(active=True, now=1010, client=other)
        self.assertEqual(
            self.db.episodes.get(self.visitor, SCENARIO)["remaining_ms"], 80_000
        )
        self.command(active=True, now=5000, client=other)
        self.assertEqual(
            self.db.episodes.get(self.visitor, SCENARIO)["remaining_ms"], 80_000
        )
        self.command(active=True, now=5010, client=other)
        self.assertEqual(
            self.db.episodes.get(self.visitor, SCENARIO)["remaining_ms"], 70_000
        )

    def test_busy_and_inactive_intervals_do_not_count(self):
        self.command(active=True, now=1000)
        self.command(active=True, now=1010, busy=True)
        self.command(active=True, now=1020, busy=False)
        self.command(active=False, now=1030)
        self.command(active=True, now=1040)
        self.assertEqual(
            self.db.episodes.get(self.visitor, SCENARIO)["remaining_ms"], 90_000
        )
        self.command(active=True, now=1050)
        self.assertEqual(
            self.db.episodes.get(self.visitor, SCENARIO)["remaining_ms"], 80_000
        )

    def test_hidden_owner_cannot_starve_or_reclaim_from_visible_tab(self):
        other = str(uuid4())
        self.command(active=False, now=1000)
        self.assertTrue(self.command(active=True, client=other, now=1001))
        for n in range(1, 10):
            self.assertFalse(self.command(active=False, now=1000 + n * 10))
            self.assertTrue(self.command(active=True, client=other, now=1001 + n * 10))
        state = self.db.episodes.get(self.visitor, SCENARIO)
        self.assertTrue(state["active"])
        self.assertEqual(state["owner_client"], other)
        self.assertEqual(state["remaining_ms"], 0)

    def test_old_presence_cannot_revive_client(self):
        self.command(active=True, now=1000)
        self.command(active=False, now=1010)
        result = self.db.episodes.command(
            self.visitor,
            SCENARIO,
            {
                "protocol": 1,
                "client_id": self.client,
                "sequence": 1,
                "kind": "presence",
                "active": True,
            },
            now=1020,
        )
        self.assertFalse(result)
        self.assertFalse(self.db.episodes.get(self.visitor, SCENARIO)["active"])

    def test_delivery_not_completion_starts_call_wait_once(self):
        job = self.invitation()
        self.command(active=True, now=1100)
        state = self.db.episodes.get(self.visitor, SCENARIO)
        self.assertEqual(state["contact_stage"], "waiting_delivery")
        with patch("kiryu_ai.episodes.secrets.randbelow", return_value=23):
            self.assertTrue(
                self.command(
                    "delivered", action_id=job["job_id"], job_id=job["job_id"], now=1100
                )
            )
        self.assertTrue(
            self.command(
                "delivered", action_id=job["job_id"], job_id=job["job_id"], now=1110
            )
        )
        self.assertEqual(
            self.db.episodes.get(self.visitor, SCENARIO)["call_wait_ms"], 120_023
        )

    def test_call_claim_single_owner_idempotent_and_result_recoverable(self):
        job = self.invitation()
        self.command(
            "delivered", action_id=job["job_id"], job_id=job["job_id"], now=1100
        )
        for n in range(20):
            self.command(active=True, now=1100 + n * 10)
        state = self.db.episodes.get(self.visitor, SCENARIO)
        call = state["call_id"]
        fields = {"action_id": call, "call_id": call}
        self.assertTrue(self.command("call_started", **fields, now=1290))
        self.assertTrue(self.command("call_started", **fields, now=1290))
        self.assertFalse(
            self.command("call_started", client=str(uuid4()), **fields, now=1290)
        )
        self.assertTrue(
            self.command(
                "call_result",
                client=str(uuid4()),
                call_id=call,
                outcome="missed",
                now=1300,
            )
        )
        self.assertTrue(
            self.command("call_result", call_id=call, outcome="missed", now=1300)
        )
        self.assertFalse(
            self.command("call_result", call_id=call, outcome="idle", now=1300)
        )
        self.assertEqual(
            self.db.episodes.get(self.visitor, SCENARIO)["contact_stage"],
            "followup_due",
        )
        self.assertEqual(
            self.db.episodes.response(self.visitor, SCENARIO)["episode"]["call_outcome"],
            "missed",
        )

    def test_actual_user_supersedes_atomic_and_no_fake_user_for_invite(self):
        state = self.advance()
        ref = {
            "episode_id": EPISODE_ID,
            "instance_id": state["instance_id"],
            "version": state["version"],
            "stage": "invite",
        }
        old, _ = self.db.accept(
            self.visitor, "majima", SCENARIO, None, str(uuid4()), episode_ref=ref
        )
        new, _ = self.db.accept(
            self.visitor,
            "majima",
            SCENARIO,
            "오늘 안 돼요",
            str(uuid4()),
            supersede_episode=True,
        )
        self.assertEqual(new["superseded_job_ids"], [old["job_id"]])
        self.assertEqual(
            self.db.get_request(old["job_id"])["error_code"], "episode_superseded"
        )
        history = self.db.history_page(self.visitor, "majima", SCENARIO)["messages"]
        self.assertEqual([m["content"] for m in history], ["오늘 안 돼요"])
        self.assertTrue(
            self.db.episodes.get(self.visitor, SCENARIO)["interpretation_pending"]
        )

    def test_invalid_user_request_does_not_cancel_invitation(self):
        state = self.advance()
        ref = {
            "episode_id": EPISODE_ID,
            "instance_id": state["instance_id"],
            "version": state["version"],
            "stage": "invite",
        }
        old, _ = self.db.accept(
            self.visitor, "majima", SCENARIO, None, str(uuid4()), episode_ref=ref
        )
        with self.assertRaises(ValueError):
            self.db.accept(
                self.visitor,
                "majima",
                SCENARIO,
                "cancel",
                "invalid",
                supersede_episode=True,
            )
        self.assertEqual(self.db.get_request(old["job_id"])["status"], "queued")

    def test_cancel_decision_bound_to_message_and_visitor(self):
        self.invitation()
        user, _ = self.db.accept(
            self.visitor,
            "majima",
            SCENARIO,
            "취소요",
            str(uuid4()),
            supersede_episode=True,
        )
        state = self.db.episodes.get(self.visitor, SCENARIO)
        transition = {
            "episode_id": EPISODE_ID,
            "version": state["version"],
            "decision": "cancel",
            "evidence_message_id": "wrong",
        }
        with self.assertRaises(ValueError):
            self.db.episodes.apply_decision(
                self.visitor, SCENARIO, transition, user["job_id"] + "-user"
            )
        transition["evidence_message_id"] = user["job_id"] + "-user"
        self.assertTrue(
            self.db.episodes.apply_decision(
                self.visitor, SCENARIO, transition, transition["evidence_message_id"]
            )
        )
        state = self.db.episodes.get(self.visitor, SCENARIO)
        self.assertEqual(
            (state["phase"], state["close_reason"], state["contact_stage"]),
            ("closed", "cancel", "rest"),
        )
        self.assertIsNone(
            self.db.episodes.get(self.db.issue_session()["visitor_id"], SCENARIO)
        )

    def test_old_history_filters_proactive_without_breaking_cursor(self):
        self.invitation()
        self.assertEqual(
            len(self.db.history_page(self.visitor, "majima", SCENARIO)["messages"]), 1
        )
        self.assertEqual(
            self.db.history_page(
                self.visitor, "majima", SCENARIO, include_episodes=False
            )["messages"],
            [],
        )
        self.assertEqual(self.db.history(self.visitor, "majima", SCENARIO), [])
        notices = self.db.recent_notices(self.visitor, "majima", SCENARIO)
        self.assertEqual(notices[0]["request_kind"], "proactive_episode")
        self.assertEqual(notices[0]["sequence"], 1)

    def test_v3_rebuild_preserves_foreign_keys_raw_text_and_idempotency(self):
        job, _ = self.db.accept(self.visitor, "majima", SCENARIO, "원문", str(uuid4()))
        self.db.begin_run(job["job_id"], [], {})
        self.db.complete(job["job_id"], "답장")
        old = SCHEMA.split("CREATE TABLE IF NOT EXISTS requests (", 1)[1].split(
            "\n);", 1
        )[0]
        old = old.replace(
            ",\n    episode_ref TEXT CHECK(episode_ref IS NULL OR json_valid(episode_ref))",
            "",
        )
        old = old.replace(
            "'chat','call_followup','proactive_episode'", "'chat','call_followup'"
        )
        with sqlite3.connect(self.path) as con:
            rows_before = con.execute("SELECT * FROM messages").fetchall()
            con.execute("PRAGMA foreign_keys=OFF")
            con.execute("CREATE TABLE legacy_requests (" + old + "\n)")
            cols = [r[1] for r in con.execute("PRAGMA table_info(legacy_requests)")]
            names = ",".join(cols)
            con.execute(
                f"INSERT INTO legacy_requests ({names}) SELECT {names} FROM requests"
            )
            con.execute("DROP TABLE requests")
            con.execute("ALTER TABLE legacy_requests RENAME TO requests")
            con.execute("PRAGMA user_version=3")
        for _ in range(2):
            db = ChatDB(self.path)
            with db.connection() as con:
                self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], 4)
                self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])
                self.assertEqual(
                    [tuple(row) for row in con.execute("SELECT * FROM messages")],
                    rows_before,
                )
                with self.assertRaises(sqlite3.IntegrityError):
                    con.execute("UPDATE messages SET content='changed'")
            self.assertEqual(db.get_request(job["job_id"])["reply"], "답장")


class QueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_recovers_capacity_without_reordering_survivors(self):
        queue = CancellableFIFO(2)
        queue.put_nowait({"job_id": "a"})
        queue.put_nowait({"job_id": "b"})
        self.assertTrue(queue.full())
        self.assertTrue(queue.cancel("a"))
        self.assertFalse(queue.cancel("a"))
        queue.put_nowait({"job_id": "c"})
        self.assertEqual((await queue.get())["job_id"], "b")
        queue.task_done()
        self.assertEqual((await queue.get())["job_id"], "c")
        queue.task_done()
        await queue.join()


class EpisodeAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = Engine()
        self.app = create_app(
            Path(self.temp.name),
            engine_factory=lambda: self.engine,
            builder=EpisodeBuilder(),
            episodes_enabled=True,
        )
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.service = self.app.state.service
        self.wait(lambda: self.service.status == "ready")
        self.token = self.client.post("/v1/sessions", json={}).json()["token"]
        self.auth = {"Authorization": "Bearer " + self.token}
        self.visitor = self.service.db.authenticate(self.token)["visitor_id"]
        self.client_id = str(uuid4())
        self.seq = 0

    def tearDown(self):
        self.engine.gate.set()
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def wait(self, predicate):
        end = time.monotonic() + 5
        while time.monotonic() < end:
            result = predicate()
            if result:
                return result
            time.sleep(0.005)
        self.fail("condition timed out")

    def pulse(self, **fields):
        self.seq += 1
        return self.client.post(
            "/v1/episodes/majima",
            headers=self.auth,
            json={
                "protocol": 1,
                "client_id": self.client_id,
                "sequence": self.seq,
                "kind": "presence",
                "active": True,
                **fields,
            },
        )

    def ready_invitation(self):
        start = time.time() - 100
        for n in range(10):
            self.service.db.episodes.command(
                self.visitor,
                SCENARIO,
                {
                    "protocol": 1,
                    "client_id": self.client_id,
                    "sequence": n + 1,
                    "kind": "presence",
                    "active": True,
                },
                now=start + n * 10,
            )
        self.seq = 10
        response = self.pulse()
        self.assertEqual(response.status_code, 200, response.text)
        job_id = response.json()["action"]["job_id"]
        return job_id

    def test_feature_off_is_default_and_no_state_creation(self):
        self.service.episodes_enabled = False
        response = self.pulse()
        self.assertFalse(response.json()["enabled"])
        self.assertIsNone(self.service.db.episodes.get(self.visitor, SCENARIO))

    def test_invite_contract_old_clients_and_no_user_row(self):
        job_id = self.ready_invitation()
        self.wait(lambda: self.service.db.get_request(job_id)["status"] == "complete")
        self.assertEqual(
            self.client.get("/v1/jobs/" + job_id, headers=self.auth).status_code, 404
        )
        job = self.client.get(
            "/v1/jobs/" + job_id + "?episodes=1", headers=self.auth
        ).json()
        self.assertEqual(job["request"]["kind"], "proactive_episode")
        self.assertNotIn("message", job["request"])
        self.assertEqual(
            self.client.get("/v1/history?character=majima", headers=self.auth).json()[
                "messages"
            ],
            [],
        )
        history = self.client.get(
            "/v1/history?character=majima&episodes=1", headers=self.auth
        ).json()["messages"]
        self.assertEqual([m["role"] for m in history], ["assistant"])

    def test_inflight_invite_user_takeover_does_not_stop_service(self):
        self.engine.gate.clear()
        job_id = self.ready_invitation()
        self.assertTrue(self.engine.started.wait(2))
        response = self.client.post(
            "/v1/chat",
            headers=self.auth,
            json={
                "character": "majima",
                "message": "오늘 바빠요",
                "request_id": str(uuid4()),
            },
        )
        self.assertEqual(response.status_code, 202, response.text)
        new_id = response.json()["job_id"]
        self.engine.gate.set()
        self.wait(lambda: self.service.db.get_request(new_id)["status"] == "complete")
        self.assertEqual(self.service.status, "ready")
        self.assertEqual(
            self.service.db.get_request(job_id)["error_code"], "episode_superseded"
        )
        self.assertEqual(
            len(self.service.db.history(self.visitor, "majima", SCENARIO)), 2
        )
        detail = self.service.db.request_detail(new_id)
        self.assertIsNone(detail["run"]["metadata"]["episode_context"])
        state = self.service.db.episodes.get(self.visitor, SCENARIO)
        self.assertEqual(state["contact_stage"], "initial")

    def test_cancel_after_offer_applies_before_writer_and_stops_autocontact(self):
        job_id = self.ready_invitation()
        self.wait(lambda: self.service.db.get_request(job_id)["status"] == "complete")
        response = self.client.post(
            "/v1/chat",
            headers=self.auth,
            json={
                "character": "majima",
                "message": "취소요",
                "request_id": str(uuid4()),
            },
        )
        self.assertEqual(response.status_code, 202)
        self.wait(
            lambda: (
                self.service.db.get_request(response.json()["job_id"])["status"]
                == "complete"
            )
        )
        state = self.service.db.episodes.get(self.visitor, SCENARIO)
        self.assertEqual(
            (state["phase"], state["close_reason"], state["contact_stage"]),
            ("closed", "cancel", "rest"),
        )
        self.assertIsNone(self.pulse().json()["action"])

    def event(self, kind, **fields):
        self.seq += 1
        response = self.client.post(
            "/v1/episodes/majima",
            headers=self.auth,
            json={
                "protocol": 1,
                "client_id": self.client_id,
                "sequence": self.seq,
                "kind": kind,
                **fields,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def ringing_call(self):
        job_id = self.ready_invitation()
        self.wait(lambda: self.service.db.get_request(job_id)["status"] == "complete")
        start = time.time() - 210
        self.seq += 1
        with patch("kiryu_ai.episodes.secrets.randbelow", return_value=0):
            self.service.db.episodes.command(
                self.visitor,
                SCENARIO,
                {
                    "protocol": 1,
                    "client_id": self.client_id,
                    "sequence": self.seq,
                    "kind": "delivered",
                    "action_id": job_id,
                    "job_id": job_id,
                },
                now=start,
            )
        for n in range(21):
            self.seq += 1
            self.service.db.episodes.command(
                self.visitor,
                SCENARIO,
                {
                    "protocol": 1,
                    "client_id": self.client_id,
                    "sequence": self.seq,
                    "kind": "presence",
                    "active": True,
                },
                now=start + n * 10,
            )
        action = self.pulse().json()["action"]
        call_id = action["call_id"]
        self.assertTrue(
            self.event("call_started", action_id=call_id, call_id=call_id)["accepted"]
        )
        return job_id, call_id

    def test_full_unanswered_chain_once_and_legacy_followup_deduplicated(self):
        invitation, call = self.ringing_call()
        outcome = self.event("call_result", call_id=call, outcome="missed")
        self.assertTrue(outcome["accepted"])
        followup = outcome["action"]["job_id"]
        self.assertNotEqual(invitation, followup)
        self.wait(lambda: self.service.db.get_request(followup)["status"] == "complete")
        again = self.event("call_result", call_id=call, outcome="missed")
        self.assertEqual(again["action"]["job_id"], followup)
        legacy = self.client.post(
            "/v1/call-followups",
            headers=self.auth,
            json={
                "character": "majima",
                "request_id": str(uuid4()),
                "call_id": call,
                "reason": "missed",
                "direction": "incoming",
            },
        )
        self.assertEqual(legacy.status_code, 202)
        self.assertEqual(legacy.json()["job_id"], followup)
        self.assertTrue(
            self.event("delivered", action_id=followup, job_id=followup)["accepted"]
        )
        self.assertIsNone(self.pulse().json()["action"])
        state = self.service.db.episodes.get(self.visitor, SCENARIO)
        self.assertEqual(state["contact_stage"], "rest")
        messages = self.service.db.history_page(self.visitor, "majima", SCENARIO)[
            "messages"
        ]
        self.assertEqual(
            [message["role"] for message in messages], ["assistant", "assistant"]
        )
        self.assertEqual(len(self.engine.calls), 2)

    def test_manual_end_has_no_extra_script_or_followup_generation(self):
        _, call = self.ringing_call()
        self.assertTrue(
            self.event("call_result", call_id=call, outcome="ended")["accepted"]
        )
        self.assertIsNone(self.pulse().json()["action"])
        self.assertEqual(len(self.engine.calls), 1)

    def test_hidden_queued_invite_releases_slot_and_resumes_without_duplicate(self):
        # Hold the worker at a harmless preceding request, then create an episode
        # reservation directly to exercise cancellation before model start.
        state = self.service.db.episodes.initial()
        state["remaining_ms"] = 0
        state.update(
            owner_client=self.client_id, last_presence_at=time.time(), active=True
        )
        with self.service.db.connection(write=True) as con:
            self.service.db.episodes.save(con, self.visitor, SCENARIO, state)
        ref = {
            "episode_id": EPISODE_ID,
            "instance_id": state["instance_id"],
            "version": state["version"],
            "stage": "invite",
        }
        job, _ = self.service.db.accept(
            self.visitor, "majima", SCENARIO, None, str(uuid4()), episode_ref=ref
        )
        scope = (self.visitor, "majima", SCENARIO)
        self.service.pending[scope] = job["job_id"]
        self.pulse(active=False)
        self.assertEqual(
            self.service.db.get_request(job["job_id"])["error_code"], "episode_inactive"
        )
        self.assertNotIn(scope, self.service.pending)
        self.assertEqual(len(self.engine.calls), 0)
        resumed = self.pulse().json()["action"]["job_id"]
        self.assertNotEqual(resumed, job["job_id"])
        self.wait(lambda: self.service.db.get_request(resumed)["status"] == "complete")
        self.assertEqual(
            len(self.service.db.recent_notices(self.visitor, "majima", SCENARIO)), 1
        )

    def test_user_can_send_other_contact_while_episode_is_generating(self):
        self.engine.gate.clear()
        self.ready_invitation()
        self.assertTrue(self.engine.started.wait(2))
        response = self.client.post(
            "/v1/chat",
            headers=self.auth,
            json={
                "character": "haruka",
                "message": "합성 검사",
                "request_id": str(uuid4()),
            },
        )
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(len(self.engine.calls), 1)
        self.engine.gate.set()
        self.wait(
            lambda: (
                self.service.db.get_request(response.json()["job_id"])["status"]
                == "complete"
            )
        )
        self.assertEqual(len(self.engine.calls), 2)

    def test_protocol_and_ownership_enforced(self):
        self.assertEqual(
            self.client.get("/v1/episodes/majima?protocol=1").status_code, 401
        )
        self.assertEqual(
            self.client.get(
                "/v1/episodes/majima?protocol=2", headers=self.auth
            ).status_code,
            400,
        )
        with self.assertRaises(ValueError):
            validate_command(
                {
                    "protocol": 1,
                    "kind": "presence",
                    "client_id": self.client_id,
                    "sequence": True,
                    "active": True,
                }
            )


if __name__ == "__main__":
    unittest.main()
