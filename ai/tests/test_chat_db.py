import copy
import json
import sqlite3
import stat
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from kiryu_ai.chat_db import (
    AXES,
    ChatDB,
    InvalidTransition,
    RequestConflict,
    VisitorBusy,
    digest,
    json_text,
)
from kiryu_ai.import_chat import import_snapshot


class ChatDBTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.db = ChatDB(self.root / "private/chat.sqlite3")
        self.session = self.db.issue_session(now=100)
        self.visitor = self.session["visitor_id"]

    def tearDown(self):
        self.temporary.cleanup()

    def accept(
        self,
        message="카레 먹자",
        character="haruka",
        visitor=None,
        request_id=None,
        now=101,
    ):
        return self.db.accept(
            visitor or self.visitor,
            character,
            "daily-if-v1",
            message,
            request_id or str(uuid4()),
            now=now,
        )

    def exchange(self, user="카레 먹자", reply="응, 아저씨.", **options):
        job, _ = self.accept(user, **options)
        inputs = [{"role": "user", "content": user}]
        self.db.begin_run(
            job["job_id"],
            inputs,
            {"model": "CPU_TEST_ONLY", "prompt_version": "v1"},
            [{"id": "fact1", "kind": "fact", "text": "검수된 근거"}],
            now=102,
        )
        self.db.complete(job["job_id"], reply, {"total_seconds": 2.0}, now=103)
        return job

    def test_private_files_and_only_hashed_sessions(self):
        self.assertEqual(stat.S_IMODE(self.db.path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.db.path.parent.stat().st_mode), 0o700)
        with self.db.connection() as connection:
            self.assertEqual(
                connection.execute("PRAGMA journal_mode").fetchone()[0], "wal"
            )
            row = connection.execute("SELECT * FROM sessions").fetchone()
            self.assertEqual(row["token_hash"], digest(self.session["token"]))
            self.assertNotIn(self.session["token"], str(tuple(row)))
            for suffix in ("-wal", "-shm"):
                sidecar = Path(str(self.db.path) + suffix)
                if sidecar.exists():
                    self.assertEqual(stat.S_IMODE(sidecar.stat().st_mode), 0o600)

    def test_sliding_session_expiry_and_original_visitor_retained(self):
        days = 24 * 60 * 60
        token = self.session["token"]
        self.assertEqual(
            self.db.authenticate(token, now=100 + 29 * days)["visitor_id"], self.visitor
        )
        self.assertIsNotNone(self.db.authenticate(token, now=100 + 58 * days))
        self.assertIsNone(self.db.authenticate(token, now=100 + 88 * days))
        with self.db.connection() as connection:
            self.assertEqual(
                connection.execute("SELECT count(*) FROM visitors").fetchone()[0], 1
            )
        self.assertEqual(self.db.active_session_count(now=100 + 88 * days), 0)

    def test_acceptance_is_durable_before_generation(self):
        job, created = self.accept()
        self.assertTrue(created)
        reopened = ChatDB(self.db.path)
        self.assertEqual(reopened.get_request(job["job_id"])["message"], "카레 먹자")
        self.assertEqual(reopened.history(self.visitor, "haruka", "daily-if-v1"), [])
        page = reopened.history_page(self.visitor, "haruka", "daily-if-v1")
        self.assertEqual(page["messages"][0]["status"], "queued")
        self.assertFalse(page["messages"][0]["model_eligible"])

    def test_acceptance_transaction_rolls_back_invalid_message(self):
        with self.assertRaises(ValueError):
            self.accept("")
        with self.db.connection() as connection:
            self.assertEqual(
                connection.execute("SELECT count(*) FROM requests").fetchone()[0], 0
            )
            self.assertEqual(
                connection.execute("SELECT count(*) FROM conversations").fetchone()[0],
                0,
            )

    def test_uuid_retries_and_cross_character_conflicts(self):
        request_id = str(uuid4())
        job, _ = self.accept(request_id=request_id)
        repeated, created = self.accept(request_id=request_id)
        self.assertFalse(created)
        self.assertEqual(job["job_id"], repeated["job_id"])
        self.assertEqual(
            self.db.find_request(self.visitor, "daily-if-v1", request_id)["job_id"],
            job["job_id"],
        )
        with self.assertRaises(RequestConflict):
            self.accept("우동 먹자", request_id=request_id)
        with self.assertRaises(RequestConflict):
            self.accept(character="majima", request_id=request_id)
        with self.assertRaises(VisitorBusy):
            self.accept(character="majima")

    def test_concurrent_retry_creates_exactly_one_request(self):
        identifier = str(uuid4())
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(
                pool.map(lambda _: self.accept(request_id=identifier), range(8))
            )
        self.assertEqual(sum(created for _, created in results), 1)
        with self.db.connection() as connection:
            self.assertEqual(
                connection.execute("SELECT count(*) FROM messages").fetchone()[0], 1
            )

    def test_completion_and_run_provenance_survive_recovery(self):
        job = self.exchange()
        reopened = ChatDB(self.db.path)
        self.assertEqual(reopened.recover_interrupted(), 0)
        detail = reopened.request_detail(job["job_id"])
        self.assertEqual(detail["status"], "complete")
        self.assertEqual(
            detail["run"]["input_sha256"],
            digest(json_text([{"role": "user", "content": "카레 먹자"}])),
        )
        self.assertEqual(detail["retrieval_hits"][0]["id"], "fact1")
        self.assertEqual(
            len(reopened.history(self.visitor, "haruka", "daily-if-v1")), 2
        )
        with self.assertRaises(InvalidTransition):
            reopened.complete(job["job_id"], "덮어쓰기")
        with self.assertRaises(InvalidTransition):
            reopened.fail(job["job_id"], "error")

    def test_completion_rollback_does_not_mark_partial_exchange_eligible(self):
        job, _ = self.accept()
        self.db.begin_run(job["job_id"], [], {})
        with self.db.connection(write=True) as connection:
            connection.execute(
                "CREATE TRIGGER fail_completion BEFORE UPDATE OF status ON requests WHEN NEW.status='complete' BEGIN SELECT RAISE(ABORT,'simulated crash'); END"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.complete(job["job_id"], "저장 중 실패")
        self.assertEqual(self.db.history(self.visitor, "haruka", "daily-if-v1"), [])
        with self.db.connection() as connection:
            self.assertEqual(
                connection.execute("SELECT count(*) FROM messages").fetchone()[0], 1
            )

    def test_failure_retains_output_only_in_owner_review(self):
        job, _ = self.accept()
        self.db.begin_run(job["job_id"], [], {})
        self.db.fail(
            job["job_id"], "response_truncated", "미완성 출력", {"total_seconds": 30.0}
        )
        public = self.db.get_request(job["job_id"])
        self.assertNotIn("reply", public)
        self.assertNotIn("미완성 출력", json_text(public))
        detail = self.db.request_detail(job["job_id"])
        self.assertEqual(detail["run"]["output_text"], "미완성 출력")
        self.assertEqual(detail["run"]["finish_reason"], "length")
        self.assertEqual(self.db.history(self.visitor, "haruka", "daily-if-v1"), [])
        self.assertEqual(
            len(
                self.db.history_page(self.visitor, "haruka", "daily-if-v1")["messages"]
            ),
            1,
        )

    def test_restart_marks_queued_and_generating_interrupted_without_retry(self):
        first, _ = self.accept()
        second_visitor = self.db.issue_session()["visitor_id"]
        second, _ = self.accept(visitor=second_visitor)
        self.db.begin_run(second["job_id"], [], {})
        reopened = ChatDB(self.db.path)
        self.assertEqual(reopened.recover_interrupted(), 2)
        self.assertEqual(reopened.recover_interrupted(), 0)
        for job in (first, second):
            self.assertEqual(
                reopened.get_request(job["job_id"])["error"]["code"], "interrupted"
            )
            self.assertEqual(reopened.get_request(job["job_id"])["status"], "error")
        self.accept("다시 문자")

    def test_history_cursor_is_scope_bound_and_restart_stable(self):
        for index in range(4):
            self.exchange(f"문자 {index}", f"답장 {index}")
        page = self.db.history_page(self.visitor, "haruka", "daily-if-v1", limit=3)
        self.assertEqual(
            [m["content"] for m in page["messages"]], ["답장 2", "문자 3", "답장 3"]
        )
        second = ChatDB(self.db.path).history_page(
            self.visitor, "haruka", "daily-if-v1", cursor=page["next_cursor"], limit=3
        )
        self.assertEqual(
            [m["content"] for m in second["messages"]], ["문자 1", "답장 1", "문자 2"]
        )
        foreign = self.db.issue_session()["visitor_id"]
        for visitor, character, scenario in (
            (foreign, "haruka", "daily-if-v1"),
            (self.visitor, "majima", "daily-if-v1"),
            (self.visitor, "haruka", "if-other"),
        ):
            with self.assertRaises(ValueError):
                self.db.history_page(
                    visitor, character, scenario, cursor=page["next_cursor"]
                )
        with self.assertRaises(ValueError):
            self.db.history_page(
                self.visitor, "haruka", "daily-if-v1", cursor=page["next_cursor"] + "x"
            )

    def test_scope_isolation_at_history_and_job_boundary(self):
        job = self.exchange()
        foreign = self.db.issue_session()["visitor_id"]
        self.exchange("마지마 문자", "마지마 답장", character="majima")
        self.exchange("다른 방문자", "외부 답장", visitor=foreign)
        self.assertIsNone(self.db.get_request(job["job_id"], foreign))
        self.assertEqual(
            [
                m["content"]
                for m in self.db.history(self.visitor, "haruka", "daily-if-v1")
            ],
            ["카레 먹자", "응, 아저씨."],
        )
        self.assertEqual(self.db.history(self.visitor, "haruka", "other-if"), [])

    def test_raw_text_cannot_be_edited_or_deleted(self):
        self.exchange()
        with self.db.connection(write=True) as connection:
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute("UPDATE messages SET content='수정'")
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute("DELETE FROM messages")

    def test_owner_review_is_separate_and_exports_remain_unapproved(self):
        job = self.exchange()
        failed, _ = self.accept("실패 문자")
        self.db.fail(failed["job_id"], "timeout", "검토할 실패 출력")
        axes = dict.fromkeys(AXES, "appropriate")
        self.db.save_review(
            job["job_id"],
            reviewer="owner",
            axes=axes,
            tags=["말투 불일치"],
            improved_answer="개선 예시",
        )
        exported = self.db.export_cases([job["job_id"], job["job_id"]])
        self.assertEqual(len(exported), 1)
        self.assertFalse(exported[0]["training_eligible"])
        self.assertFalse(exported[0]["reviews"][0]["training_eligible"])
        self.assertNotIn(
            "개선 예시",
            json_text(self.db.history(self.visitor, "haruka", "daily-if-v1")),
        )
        self.assertNotIn(self.session["token"], json_text(exported))
        self.assertNotIn(digest(self.session["token"]), json_text(exported))
        self.assertEqual(self.db.review_queue()[0]["job_id"], failed["job_id"])
        self.assertEqual(len(self.db.review_queue(unreviewed=True)), 1)
        self.assertEqual(
            len(self.db.review_queue(query="카레", model="CPU_TEST_ONLY", prompt="v1")),
            1,
        )

    def test_backups_restore_consistent_commits_and_keep_seven_days_four_weeks(self):
        job = self.exchange()
        directory = self.root / "backups"
        day = 86400
        initial = datetime(2026, 1, 1, tzinfo=UTC).timestamp()
        for index in range(35):
            paths = self.db.backup(directory, now=initial + index * day)
        self.assertEqual(len(list(directory.glob("daily-*.sqlite3"))), 7)
        self.assertEqual(len(list(directory.glob("weekly-*.sqlite3"))), 4)
        reopened = ChatDB(paths[0])
        self.assertEqual(reopened.get_request(job["job_id"])["reply"], "응, 아저씨.")
        self.assertEqual(
            len(reopened.history(self.visitor, "haruka", "daily-if-v1")), 2
        )


class LegacyImportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.snapshot = self.root / "snapshot"
        (self.snapshot / "jobs").mkdir(parents=True)
        (self.snapshot / "history").mkdir()
        self.db = ChatDB(self.root / "state/chat.sqlite3")
        self.token = "legacy-test-token-" + "x" * 32
        self.visitor = "legacy-visitor"
        self.scope = [self.visitor, "haruka", "daily-if-v1"]
        self.auth = {
            digest(self.token): {
                "visitor_id": self.visitor,
                "issued_at": 100,
                "job_count": 2,
            }
        }
        self.write("auth.json", self.auth)
        self.messages = []
        self.jobs = []
        for index in range(2):
            identifier = str(uuid4())
            user = "同じ文字でも別の発言"
            reply = "응, 아저씨."
            self.messages.extend(
                [
                    {
                        "id": identifier + "-user",
                        "role": "user",
                        "content": user,
                        "time": f"2026-01-01T00:0{index}:01+00:00",
                    },
                    {
                        "id": identifier + "-assistant",
                        "role": "assistant",
                        "content": reply,
                        "time": f"2026-01-01T00:0{index}:01+00:00",
                    },
                ]
            )
            job = {
                "job_id": identifier,
                "visitor_id": self.visitor,
                "character": "haruka",
                "scenario_version": "daily-if-v1",
                "request_id": str(uuid4()),
                "fingerprint": digest(json.dumps(["haruka", user], ensure_ascii=False)),
                "status": "complete",
                "message": user,
                "reply": reply,
                "messages": copy.deepcopy(self.messages),
                "accepted_at": f"2026-01-01T00:0{index}:00+00:00",
            }
            self.jobs.append(job)
            self.write(f"jobs/{identifier}.json", job)
        self.write(
            "history/conversation.json",
            {"scope": self.scope, "messages": self.messages},
        )

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, name, data):
        (self.snapshot / name).write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )

    def test_import_preserves_ids_order_content_tokens_and_is_idempotent(self):
        with self.assertRaises(ValueError):
            import_snapshot(self.db, self.snapshot)
        report = import_snapshot(self.db, self.snapshot, quiescent=True)
        self.assertEqual(report["conflicts"], [])
        self.assertEqual(report["imported"], 4)
        self.assertEqual(self.db.history(*self.scope), self.messages)
        retried, created = self.db.accept(
            *self.scope, self.jobs[0]["message"], self.jobs[0]["request_id"]
        )
        self.assertFalse(created)
        self.assertEqual(retried["job_id"], self.jobs[0]["job_id"])
        self.assertEqual(
            self.db.authenticate(self.token, now=101)["visitor_id"], self.visitor
        )
        with self.db.connection() as connection:
            self.assertEqual(
                connection.execute("SELECT count(*) FROM generation_runs").fetchone()[
                    0
                ],
                0,
            )
            self.assertEqual(
                connection.execute("SELECT count(*) FROM messages").fetchone()[0], 4
            )
        repeated = import_snapshot(self.db, self.snapshot, quiescent=True)
        self.assertEqual(repeated["skipped"], 4)
        self.assertEqual(repeated["imported"], 0)
        self.assertEqual(self.db.history(*self.scope), self.messages)

    def test_saved_pair_recovers_legacy_job_incomplete_write(self):
        self.jobs[1].update(status="generating")
        self.jobs[1].pop("messages")
        self.jobs[1].pop("reply")
        self.write(f"jobs/{self.jobs[1]['job_id']}.json", self.jobs[1])
        report = import_snapshot(self.db, self.snapshot, quiescent=True)
        self.assertEqual(report["conflicts"], [])
        self.assertEqual(
            self.db.get_request(self.jobs[1]["job_id"])["status"], "complete"
        )

    def test_incomplete_without_history_stays_interrupted(self):
        job = copy.deepcopy(self.jobs[-1])
        job.update(
            job_id=str(uuid4()),
            request_id=str(uuid4()),
            status="generating",
            accepted_at="2026-01-01T00:03:00+00:00",
        )
        job.pop("messages")
        job.pop("reply")
        self.write(f"jobs/{job['job_id']}.json", job)
        report = import_snapshot(self.db, self.snapshot, quiescent=True)
        self.assertEqual(report["conflicts"], [])
        self.assertEqual(
            self.db.get_request(job["job_id"])["error"]["code"], "interrupted"
        )
        self.assertEqual(self.db.history(*self.scope), self.messages)
        self.assertEqual(len(self.db.history_page(*self.scope)["messages"]), 5)

    def test_modified_source_is_quarantined_without_changing_raw_text(self):
        import_snapshot(self.db, self.snapshot, quiescent=True)
        modified = copy.deepcopy(self.messages)
        modified[0]["content"] = "거짓 변경"
        self.write(
            "history/conversation.json", {"scope": self.scope, "messages": modified}
        )
        report = import_snapshot(self.db, self.snapshot, quiescent=True)
        self.assertEqual(len(report["conflicts"]), 1)
        self.assertEqual(
            report["conflicts"][0]["reason"], "source_changed_after_import"
        )
        self.assertEqual(self.db.history(*self.scope), self.messages)

    def test_malformed_job_does_not_abort_other_source_imports(self):
        self.write("jobs/malformed-list.json", [{}])
        self.write("jobs/malformed-time.json", {"accepted_at": 123})
        self.write("jobs/malformed-null.json", {"accepted_at": None})
        report = import_snapshot(self.db, self.snapshot, quiescent=True)
        self.assertEqual(len(report["conflicts"]), 3)
        self.assertEqual(self.db.history(*self.scope), self.messages)
        repeated = import_snapshot(self.db, self.snapshot, quiescent=True)
        self.assertEqual(repeated["imported"], 0)

    def test_id_collision_rolls_back_the_entire_source(self):
        other_scope = ["other-visitor", "haruka", "daily-if-v1"]
        self.write(
            "history/collision.json", {"scope": other_scope, "messages": self.messages}
        )
        report = import_snapshot(self.db, self.snapshot, quiescent=True)
        self.assertEqual(len(report["conflicts"]), 1)
        self.assertEqual(self.db.history(*other_scope), [])
        self.assertEqual(self.db.history(*self.scope), self.messages)


if __name__ == "__main__":
    unittest.main()
