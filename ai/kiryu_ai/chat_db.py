"""Durable, private chat state. Generation never holds a write transaction.

Every method opens its own connection: the HTTP loop, inference thread and local
review service can share this object without sharing SQLite connection state.
Raw message text is immutable; reviews and replacement drafts live separately.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

SCHEMA_VERSION = 2
RELATIONSHIP_TONES = ("warm", "neutral", "cool")
MAX_ACTIVE_PER_VISITOR = 2
SESSION_LIFETIME = 30 * 24 * 60 * 60
AXES = ("speech", "judgment", "relationship", "knowledge", "context", "format")
RATINGS = ("problem", "partial", "appropriate", "unrated")
CAUSES = ("prompt", "data", "retrieval", "memory", "model", "unknown")


class RequestConflict(ValueError):
    """A request UUID has already been used for different text or character."""


class VisitorBusy(ValueError):
    """This conversation is busy or its visitor has reached the active limit."""


class InvalidTransition(ValueError):
    """A terminal request cannot be generated or overwritten again."""


def json_text(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def timestamp(now=None):
    return datetime.fromtimestamp(time.time() if now is None else now, UTC).isoformat()


def scope_id(visitor, character, scenario):
    if not all(
        isinstance(item, str) and item.strip()
        for item in (visitor, character, scenario)
    ):
        raise ValueError("Conversation scope must contain three nonempty strings")
    return digest(json_text([visitor, character, scenario]))


def private_file(path):
    """Create without a world-readable window; reject indirect state paths."""
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Private database files cannot be symbolic links")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    descriptor = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
    os.close(descriptor)
    path.chmod(0o600)


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS visitors (
    visitor_id TEXT PRIMARY KEY, created_at REAL NOT NULL, last_seen_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, visitor_id TEXT NOT NULL REFERENCES visitors,
    issued_at REAL NOT NULL, last_seen_at REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_visitor ON sessions(visitor_id);
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL REFERENCES visitors,
    character_id TEXT NOT NULL, scenario_version TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(visitor_id, character_id, scenario_version)
);
CREATE TABLE IF NOT EXISTS requests (
    job_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations,
    visitor_id TEXT NOT NULL REFERENCES visitors, character_id TEXT NOT NULL,
    scenario_version TEXT NOT NULL, client_request_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN
        ('queued','generating','complete','error','interrupted')),
    accepted_at TEXT NOT NULL, updated_at TEXT NOT NULL, error_code TEXT,
    relationship_tone TEXT NOT NULL DEFAULT 'neutral'
        CHECK(relationship_tone IN ('warm','neutral','cool')),
    UNIQUE(visitor_id, scenario_version, client_request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_request_per_conversation ON requests(conversation_id)
    WHERE status IN ('queued','generating');
CREATE INDEX IF NOT EXISTS requests_conversation ON requests(conversation_id, accepted_at);
CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations,
    job_id TEXT REFERENCES requests, sequence INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
    content_sha256 TEXT NOT NULL, created_at TEXT,
    model_eligible INTEGER NOT NULL DEFAULT 0 CHECK(model_eligible IN (0,1)),
    UNIQUE(conversation_id, sequence), UNIQUE(job_id, role)
);
CREATE INDEX IF NOT EXISTS messages_history ON messages(conversation_id, model_eligible, sequence);
CREATE TRIGGER IF NOT EXISTS immutable_message BEFORE UPDATE OF
    message_id, conversation_id, job_id, sequence, role, content, content_sha256, created_at
    ON messages BEGIN SELECT RAISE(ABORT, 'Original messages are immutable'); END;
CREATE TRIGGER IF NOT EXISTS no_message_delete BEFORE DELETE ON messages
    BEGIN SELECT RAISE(ABORT, 'Original messages are immutable'); END;
CREATE TABLE IF NOT EXISTS generation_runs (
    run_id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES requests,
    started_at TEXT, completed_at TEXT, input_sha256 TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}', metrics_json TEXT NOT NULL DEFAULT '{}',
    output_text TEXT, finish_reason TEXT, error_code TEXT
);
CREATE TABLE IF NOT EXISTS retrieval_hits (
    run_id TEXT NOT NULL REFERENCES generation_runs, position INTEGER NOT NULL,
    kind TEXT NOT NULL, source_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    PRIMARY KEY(run_id, position)
);
CREATE TABLE IF NOT EXISTS reviews (
    review_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES requests,
    created_at TEXT NOT NULL, reviewer TEXT NOT NULL, axes_json TEXT NOT NULL,
    tags_json TEXT NOT NULL, cause TEXT NOT NULL, note TEXT NOT NULL,
    improved_answer TEXT NOT NULL, training_eligible INTEGER NOT NULL DEFAULT 0
        CHECK(training_eligible IN (0,1))
);
CREATE INDEX IF NOT EXISTS reviews_request ON reviews(job_id, created_at);
CREATE TABLE IF NOT EXISTS import_records (
    source_key TEXT NOT NULL, source_sha256 TEXT NOT NULL, imported_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('imported','conflict')),
    details_json TEXT NOT NULL, PRIMARY KEY(source_key, source_sha256)
);
"""


class ChatDB:
    def __init__(self, path, *, session_lifetime=SESSION_LIFETIME):
        self.path = Path(path)
        self.session_lifetime = session_lifetime
        private_file(self.path)
        with self.connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            # Both the API and owner process open this DB. Lock before reading
            # its version so concurrent startup cannot run the same ALTER twice.
            connection.execute("BEGIN IMMEDIATE")
            try:
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                if version not in (0, 1, SCHEMA_VERSION):
                    raise ValueError("Unsupported chat database schema version")
                if version == 1:
                    connection.execute(
                        "ALTER TABLE requests ADD COLUMN relationship_tone TEXT NOT NULL DEFAULT 'neutral' "
                        "CHECK(relationship_tone IN ('warm','neutral','cool'))"
                    )
                    connection.execute(
                        "DROP INDEX IF EXISTS one_active_request_per_visitor"
                    )
                # executescript implicitly commits; execute complete statements
                # individually to keep DDL, version and cursor-key creation atomic.
                statement = ""
                for line in SCHEMA.splitlines(keepends=True):
                    statement += line
                    if sqlite3.complete_statement(statement):
                        connection.execute(statement)
                        statement = ""
                if statement.strip():
                    raise ValueError("Incomplete chat schema statement")
                connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
                connection.execute(
                    "INSERT OR IGNORE INTO settings VALUES ('cursor_key', ?)",
                    (secrets.token_hex(32),),
                )
                self.cursor_key = bytes.fromhex(
                    connection.execute(
                        "SELECT value FROM settings WHERE key='cursor_key'"
                    ).fetchone()[0]
                )
                connection.commit()
            except BaseException:
                connection.rollback()
                raise

    @contextmanager
    def connection(self, *, write=False):
        if self.path.is_symlink():
            raise ValueError("Private database cannot be a symbolic link")
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA busy_timeout=10000")
        try:
            for suffix in ("", "-wal", "-shm"):
                sidecar = Path(str(self.path) + suffix)
                if sidecar.exists():
                    if sidecar.is_symlink():
                        raise ValueError(
                            "Private database sidecars cannot be symbolic links"
                        )
                    sidecar.chmod(0o600)
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            if write:
                connection.commit()
        except BaseException:
            if write:
                connection.rollback()
            raise
        finally:
            connection.close()

    def issue_session(self, *, now=None):
        now = time.time() if now is None else now
        token, visitor = secrets.token_urlsafe(32), uuid4().hex
        with self.connection(write=True) as connection:
            connection.execute(
                "INSERT INTO visitors VALUES (?, ?, ?)", (visitor, now, now)
            )
            connection.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?, 0)",
                (digest(token), visitor, now, now),
            )
        return {"token": token, "visitor_id": visitor}

    def authenticate(self, token, *, now=None):
        if not isinstance(token, str) or not 32 <= len(token) <= 256:
            return None
        now = time.time() if now is None else now
        token_hash = digest(token)
        with self.connection(write=True) as connection:
            row = connection.execute(
                "SELECT visitor_id, issued_at, last_seen_at FROM sessions "
                "WHERE token_hash=? AND revoked=0 AND last_seen_at>?",
                (token_hash, now - self.session_lifetime),
            ).fetchone()
            if row is None:
                return None
            connection.execute(
                "UPDATE sessions SET last_seen_at=? WHERE token_hash=?",
                (now, token_hash),
            )
            connection.execute(
                "UPDATE visitors SET last_seen_at=? WHERE visitor_id=?",
                (now, row["visitor_id"]),
            )
            count = connection.execute(
                "SELECT count(*) FROM requests WHERE visitor_id=?", (row["visitor_id"],)
            ).fetchone()[0]
            return {**dict(row), "last_seen_at": now, "job_count": count}

    def active_session_count(self, *, now=None):
        now = time.time() if now is None else now
        with self.connection() as connection:
            return connection.execute(
                "SELECT count(*) FROM sessions WHERE revoked=0 AND last_seen_at>?",
                (now - self.session_lifetime,),
            ).fetchone()[0]

    @staticmethod
    def _conversation(connection, visitor, character, scenario, created_at):
        identifier = scope_id(visitor, character, scenario)
        connection.execute(
            "INSERT OR IGNORE INTO conversations VALUES (?, ?, ?, ?, ?)",
            (identifier, visitor, character, scenario, created_at),
        )
        return identifier

    @staticmethod
    def _append(
        connection,
        conversation,
        job_id,
        role,
        content,
        created_at,
        *,
        message_id=None,
        eligible=False,
    ):
        if not isinstance(content, str) or not content.strip():
            raise ValueError("A stored message requires nonempty text")
        sequence = connection.execute(
            "SELECT coalesce(max(sequence), 0)+1 FROM messages WHERE conversation_id=?",
            (conversation,),
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                message_id or job_id + "-" + role,
                conversation,
                job_id,
                sequence,
                role,
                content,
                digest(content),
                created_at,
                int(eligible),
            ),
        )

    def accept(
        self,
        visitor,
        character,
        scenario,
        message,
        request_id,
        *,
        relationship_tone="neutral",
        now=None,
    ):
        if relationship_tone not in RELATIONSHIP_TONES:
            raise ValueError("Invalid relationship tone")
        request_id = str(UUID(request_id))
        # Keep legacy neutral retries byte-compatible. Any tone change still
        # changes the fingerprint, and the persisted enum is the source of truth.
        fingerprint_parts = [character, message]
        if relationship_tone != "neutral":
            fingerprint_parts.append(relationship_tone)
        fingerprint = digest(json.dumps(fingerprint_parts, ensure_ascii=False))
        identity = hashlib.sha256(
            (visitor + ":" + scenario + ":" + request_id).encode()
        ).digest()[:16]
        job_id = str(UUID(bytes=identity, version=4))
        accepted_at = timestamp(now)
        with self.connection(write=True) as connection:
            previous = connection.execute(
                "SELECT job_id,fingerprint FROM requests WHERE visitor_id=? AND scenario_version=? AND client_request_id=?",
                (visitor, scenario, request_id),
            ).fetchone()
            if previous is not None:
                if previous["fingerprint"] != fingerprint:
                    raise RequestConflict(
                        "Request UUID already belongs to different content"
                    )
                return self._request(connection, previous["job_id"]), False
            active = connection.execute(
                "SELECT character_id,scenario_version FROM requests WHERE visitor_id=? AND status IN ('queued','generating')",
                (visitor,),
            ).fetchall()
            if len(active) >= MAX_ACTIVE_PER_VISITOR or any(
                row["character_id"] == character and row["scenario_version"] == scenario
                for row in active
            ):
                raise VisitorBusy("Conversation or visitor active limit reached")
            conversation = self._conversation(
                connection, visitor, character, scenario, accepted_at
            )
            connection.execute(
                "INSERT INTO requests (job_id,conversation_id,visitor_id,character_id,scenario_version,client_request_id,fingerprint,status,accepted_at,updated_at,error_code,relationship_tone) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, NULL, ?)",
                (
                    job_id,
                    conversation,
                    visitor,
                    character,
                    scenario,
                    request_id,
                    fingerprint,
                    accepted_at,
                    accepted_at,
                    relationship_tone,
                ),
            )
            self._append(connection, conversation, job_id, "user", message, accepted_at)
            return self._request(connection, job_id), True

    @staticmethod
    def _request(connection, job_id, visitor=None):
        row = connection.execute(
            "SELECT r.*, u.content AS message, a.content AS reply FROM requests r "
            "LEFT JOIN messages u ON u.job_id=r.job_id AND u.role='user' "
            "LEFT JOIN messages a ON a.job_id=r.job_id AND a.role='assistant' "
            "WHERE r.job_id=? AND (? IS NULL OR r.visitor_id=?)",
            (job_id, visitor, visitor),
        ).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["character"] = result.pop("character_id")
        result["request_id"] = result.pop("client_request_id")
        if result["status"] == "interrupted":
            result["status"] = "error"
        if result["error_code"]:
            result["error"] = {
                "code": result["error_code"],
                "message": "답장을 완료하지 못했습니다. 다시 보내 주세요.",
            }
        if result["reply"] is None:
            result.pop("reply")
        return result

    def get_request(self, job_id, visitor=None):
        with self.connection() as connection:
            return self._request(connection, str(UUID(job_id)), visitor)

    def find_request(self, visitor, scenario, request_id):
        with self.connection() as connection:
            row = connection.execute(
                "SELECT job_id FROM requests WHERE visitor_id=? AND scenario_version=? AND client_request_id=?",
                (visitor, scenario, str(UUID(request_id))),
            ).fetchone()
            return self._request(connection, row[0], visitor) if row else None

    def begin_run(
        self, job_id, input_messages, metadata, retrieval_hits=(), *, now=None
    ):
        # The immutable raw history is stored once in messages. Persist its IDs,
        # versioned input envelope and evidence snapshots, plus an exact-input hash.
        run_id = uuid4().hex
        started_at = timestamp(now)
        with self.connection(write=True) as connection:
            changed = connection.execute(
                "UPDATE requests SET status='generating',updated_at=? WHERE job_id=? AND status='queued'",
                (started_at, job_id),
            ).rowcount
            if not changed:
                raise InvalidTransition("Only queued requests can start")
            connection.execute(
                "INSERT INTO generation_runs(run_id,job_id,started_at,input_sha256,metadata_json) VALUES (?, ?, ?, ?, ?)",
                (
                    run_id,
                    job_id,
                    started_at,
                    digest(json_text(input_messages)),
                    json_text(metadata),
                ),
            )
            for position, hit in enumerate(retrieval_hits):
                connection.execute(
                    "INSERT INTO retrieval_hits VALUES (?, ?, ?, ?, ?)",
                    (
                        run_id,
                        position,
                        hit.get("kind", "unknown"),
                        str(hit.get("id", hit.get("source_id", "unknown"))),
                        json_text(hit),
                    ),
                )
        return run_id

    def record_run_input(self, job_id, input_messages, metadata, retrieval_hits=()):
        """Record the next inference stage without reopening a queued request.

        The reader audit stays in metadata when the renderer replaces the active
        input. This does not alter raw messages or hold a transaction in inference.
        Terminal requests cannot be rewritten, including after crash recovery.
        """
        with self.connection(write=True) as connection:
            run = connection.execute(
                "SELECT g.run_id,g.metadata_json FROM generation_runs g "
                "JOIN requests r ON r.job_id=g.job_id "
                "WHERE g.job_id=? AND r.status='generating'",
                (job_id,),
            ).fetchone()
            if run is None:
                raise InvalidTransition("Only a generating request can record input")
            previous = json.loads(run["metadata_json"])
            updated = dict(metadata)
            if "grounding" in previous and "grounding" not in updated:
                updated["grounding"] = previous["grounding"]
            connection.execute(
                "UPDATE generation_runs SET input_sha256=?,metadata_json=? WHERE run_id=?",
                (digest(json_text(input_messages)), json_text(updated), run["run_id"]),
            )
            connection.execute(
                "DELETE FROM retrieval_hits WHERE run_id=?", (run["run_id"],)
            )
            for position, hit in enumerate(retrieval_hits):
                connection.execute(
                    "INSERT INTO retrieval_hits VALUES (?, ?, ?, ?, ?)",
                    (
                        run["run_id"],
                        position,
                        hit.get("kind", "unknown"),
                        str(hit.get("id", hit.get("source_id", "unknown"))),
                        json_text(hit),
                    ),
                )

    def complete(self, job_id, reply, metrics=None, *, now=None):
        completed_at = timestamp(now)
        with self.connection(write=True) as connection:
            job = connection.execute(
                "SELECT * FROM requests WHERE job_id=?", (job_id,)
            ).fetchone()
            if job is None or job["status"] != "generating":
                raise InvalidTransition("Only a generating request can complete")
            self._append(
                connection,
                job["conversation_id"],
                job_id,
                "assistant",
                reply,
                completed_at,
                eligible=True,
            )
            connection.execute(
                "UPDATE messages SET model_eligible=1 WHERE job_id=? AND role='user'",
                (job_id,),
            )
            connection.execute(
                "UPDATE requests SET status='complete',updated_at=? WHERE job_id=?",
                (completed_at, job_id),
            )
            connection.execute(
                "UPDATE generation_runs SET completed_at=?,metrics_json=?,finish_reason='stop' WHERE job_id=?",
                (completed_at, json_text(metrics or {}), job_id),
            )

    def fail(self, job_id, code, output="", metrics=None, *, status="error", now=None):
        if status not in ("error", "interrupted"):
            raise ValueError("Failure status must be error or interrupted")
        completed_at = timestamp(now)
        with self.connection(write=True) as connection:
            changed = connection.execute(
                "UPDATE requests SET status=?,updated_at=?,error_code=? WHERE job_id=? AND status IN ('queued','generating')",
                (status, completed_at, code, job_id),
            ).rowcount
            if not changed:
                raise InvalidTransition("A terminal request cannot be overwritten")
            connection.execute(
                "INSERT OR IGNORE INTO generation_runs(run_id,job_id) VALUES (?, ?)",
                (uuid4().hex, job_id),
            )
            connection.execute(
                "UPDATE generation_runs SET completed_at=?,metrics_json=?,output_text=?,error_code=?,finish_reason=? WHERE job_id=?",
                (
                    completed_at,
                    json_text(metrics or {}),
                    output,
                    code,
                    "length" if code in ("length", "response_truncated") else None,
                    job_id,
                ),
            )

    def recover_interrupted(self, *, now=None):
        completed_at = timestamp(now)
        with self.connection(write=True) as connection:
            rows = connection.execute(
                "SELECT job_id FROM requests WHERE status IN ('queued','generating')"
            ).fetchall()
            for row in rows:
                connection.execute(
                    "INSERT OR IGNORE INTO generation_runs(run_id,job_id) VALUES (?, ?)",
                    (uuid4().hex, row[0]),
                )
                connection.execute(
                    "UPDATE generation_runs SET completed_at=?,error_code='interrupted' WHERE job_id=?",
                    (completed_at, row[0]),
                )
            connection.execute(
                "UPDATE requests SET status='interrupted',error_code='interrupted',updated_at=? WHERE status IN ('queued','generating')",
                (completed_at,),
            )
            return len(rows)

    @staticmethod
    def _message(row, *, state=False):
        result = {
            "id": row["message_id"],
            "role": row["role"],
            "content": row["content"],
            "time": row["created_at"],
        }
        if state:
            result["status"] = row["status"] or "complete"
            result["model_eligible"] = bool(row["model_eligible"])
            result["request_id"] = row["client_request_id"]
            result["job_id"] = row["job_id"]
            result["relationship_tone"] = row["relationship_tone"] or "neutral"
        return result

    def history(self, visitor, character, scenario):
        with self.connection() as connection:
            return [
                self._message(row)
                for row in connection.execute(
                    "SELECT * FROM messages WHERE conversation_id=? AND model_eligible=1 ORDER BY sequence",
                    (scope_id(visitor, character, scenario),),
                )
            ]

    def _cursor(self, conversation, before, include_failed):
        payload = json_text([conversation, before, bool(include_failed)]).encode()
        signed = payload + hmac.digest(self.cursor_key, payload, "sha256")
        return base64.urlsafe_b64encode(signed).decode().rstrip("=")

    def _decode_cursor(self, cursor, conversation, include_failed):
        try:
            if not isinstance(cursor, str) or len(cursor) > 512:
                raise ValueError
            raw = base64.b64decode(
                cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True
            )
            payload, signature = raw[:-32], raw[-32:]
            if not hmac.compare_digest(
                signature, hmac.digest(self.cursor_key, payload, "sha256")
            ):
                raise ValueError
            scope, before, failures = json.loads(payload)
            if (
                scope != conversation
                or failures != bool(include_failed)
                or not isinstance(before, int)
                or before < 1
            ):
                raise ValueError
            return before
        except (ValueError, TypeError, UnicodeError) as error:
            raise ValueError("Invalid history cursor") from error

    def history_page(
        self,
        visitor,
        character,
        scenario,
        *,
        cursor=None,
        limit=50,
        include_failed=True,
    ):
        if not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("History page size must be 1–100")
        conversation = scope_id(visitor, character, scenario)
        before = (
            self._decode_cursor(cursor, conversation, include_failed)
            if cursor
            else 2**63 - 1
        )
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT m.*,r.status,r.client_request_id,r.relationship_tone FROM messages m LEFT JOIN requests r ON r.job_id=m.job_id "
                "WHERE m.conversation_id=? AND m.sequence<? AND (? OR m.model_eligible=1) ORDER BY m.sequence DESC LIMIT ?",
                (conversation, before, include_failed, limit + 1),
            ).fetchall()
        more = len(rows) > limit
        rows = rows[:limit]
        return {
            "messages": [
                self._message(row, state=include_failed) for row in reversed(rows)
            ],
            "next_cursor": self._cursor(
                conversation, rows[-1]["sequence"], include_failed
            )
            if more
            else None,
        }

    def request_detail(self, job_id):
        """Owner-only result, never returned from the public job route."""
        with self.connection() as connection:
            job = self._request(connection, job_id)
            if job is None:
                return None
            run = connection.execute(
                "SELECT * FROM generation_runs WHERE job_id=?", (job_id,)
            ).fetchone()
            job["run"] = None
            job["retrieval_hits"] = []
            if run:
                data = dict(run)
                data["metadata"] = json.loads(data.pop("metadata_json"))
                data["metrics"] = json.loads(data.pop("metrics_json"))
                job["run"] = data
                job["retrieval_hits"] = [
                    json.loads(row[0])
                    for row in connection.execute(
                        "SELECT snapshot_json FROM retrieval_hits WHERE run_id=? ORDER BY position",
                        (run["run_id"],),
                    )
                ]
            job["messages"] = [
                self._message(row, state=True)
                for row in connection.execute(
                    "SELECT m.*,r.status,r.client_request_id,r.relationship_tone FROM messages m LEFT JOIN requests r ON r.job_id=m.job_id WHERE m.conversation_id=? ORDER BY m.sequence",
                    (job["conversation_id"],),
                )
            ]
            job["reviews"] = [
                self._review(row)
                for row in connection.execute(
                    "SELECT * FROM reviews WHERE job_id=? ORDER BY created_at,review_id",
                    (job_id,),
                )
            ]
            return job

    @staticmethod
    def _review(row):
        result = dict(row)
        result["axes"] = json.loads(result.pop("axes_json"))
        result["tags"] = json.loads(result.pop("tags_json"))
        result["training_eligible"] = bool(result["training_eligible"])
        return result

    def save_review(
        self,
        job_id,
        *,
        reviewer,
        axes,
        tags=(),
        cause="unknown",
        note="",
        improved_answer="",
    ):
        if set(axes) != set(AXES) or any(
            value not in RATINGS for value in axes.values()
        ):
            raise ValueError("Every quality axis requires an explicit rating")
        if cause not in CAUSES or not isinstance(reviewer, str) or not reviewer.strip():
            raise ValueError("A review requires its author and a known cause")
        if (
            not isinstance(note, str)
            or not isinstance(improved_answer, str)
            or any(not isinstance(tag, str) for tag in tags)
        ):
            raise ValueError("Review notes and tags must be strings")
        identifier = uuid4().hex
        with self.connection(write=True) as connection:
            connection.execute(
                "INSERT INTO reviews VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                (
                    identifier,
                    job_id,
                    timestamp(),
                    reviewer,
                    json_text(axes),
                    json_text(list(tags)),
                    cause,
                    note,
                    improved_answer,
                ),
            )
        return identifier

    def review_queue(
        self,
        *,
        character=None,
        visitor=None,
        after=None,
        before=None,
        query=None,
        unreviewed=False,
        errors_only=False,
        model=None,
        prompt=None,
        limit=50,
        offset=0,
        random_sample=False,
    ):
        if not 1 <= limit <= 100 or offset < 0:
            raise ValueError("Invalid owner list pagination")
        conditions, values = ["r.status IN ('complete','error','interrupted')"], []
        for name, value in (
            ("r.character_id", character),
            ("r.visitor_id", visitor),
        ):
            if value is not None:
                conditions.append(name + "=?")
                values.append(value)
        for operator, value in ((">=", after), ("<", before)):
            if value is not None:
                conditions.append(
                    "julianday(r.accepted_at)" + operator + "julianday(?)"
                )
                values.append(value)
        if query:
            conditions.append(
                "EXISTS(SELECT 1 FROM messages m WHERE m.job_id=r.job_id AND instr(lower(m.content),lower(?))>0)"
            )
            values.append(query)
        if unreviewed:
            conditions.append(
                "NOT EXISTS(SELECT 1 FROM reviews v WHERE v.job_id=r.job_id)"
            )
        if errors_only:
            conditions.append("r.status IN ('error','interrupted')")
        for field, value in (("model", model), ("prompt_version", prompt)):
            if value:
                conditions.append("json_extract(g.metadata_json,?)=?")
                values.extend(["$." + field, value])
        order = (
            "random()"
            if random_sample
            else "CASE WHEN r.status IN ('error','interrupted') THEN 0 WHEN coalesce(json_extract(g.metrics_json,'$.total_seconds'),0)>20 THEN 1 WHEN NOT EXISTS(SELECT 1 FROM reviews v WHERE v.job_id=r.job_id) THEN 2 ELSE 3 END,r.accepted_at DESC,r.job_id"
        )
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT r.*,u.content AS message,a.content AS reply,g.metadata_json,g.metrics_json,"
                "(SELECT count(*) FROM reviews v WHERE v.job_id=r.job_id) AS review_count "
                "FROM requests r LEFT JOIN messages u ON u.job_id=r.job_id AND u.role='user' "
                "LEFT JOIN messages a ON a.job_id=r.job_id AND a.role='assistant' "
                "LEFT JOIN generation_runs g ON g.job_id=r.job_id WHERE "
                + " AND ".join(conditions)
                + " ORDER BY "
                + order
                + " LIMIT ? OFFSET ?",
                (*values, limit, offset),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["metadata"] = json.loads(item.pop("metadata_json") or "{}")
            item["metrics"] = json.loads(item.pop("metrics_json") or "{}")
            result.append(item)
        return result

    def export_cases(self, job_ids):
        """No session/auth/settings tables are traversed; training stays opt-in."""
        cases = []
        for identifier in dict.fromkeys(job_ids):
            case = self.request_detail(identifier)
            if case is not None:
                case["training_eligible"] = False
                cases.append(case)
        return cases

    def backup(self, directory, *, now=None):
        """Consistent online backups; replacing today's backup is deliberate."""
        instant = datetime.fromtimestamp(time.time() if now is None else now, UTC)
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
        year, week, _ = instant.isocalendar()
        paths = [
            directory / f"daily-{instant:%Y-%m-%d}.sqlite3",
            directory / f"weekly-{year}-{week:02d}.sqlite3",
        ]
        for target in paths:
            temporary = target.with_name(
                target.name + "." + secrets.token_hex(8) + ".tmp"
            )
            private_file(temporary)
            try:
                with (
                    self.connection() as source,
                    sqlite3.connect(temporary) as destination,
                ):
                    source.backup(destination)
                    result = destination.execute("PRAGMA quick_check").fetchone()[0]
                    if result != "ok":
                        raise ValueError("Backup integrity check failed")
                if target.is_symlink():
                    raise ValueError("Backup target cannot be a symbolic link")
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        for prefix, keep in (("daily-", 7), ("weekly-", 4)):
            for expired in sorted(directory.glob(prefix + "*.sqlite3"), reverse=True)[
                keep:
            ]:
                if not expired.is_symlink():
                    expired.unlink()
        return paths
