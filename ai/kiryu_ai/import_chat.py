"""Import a quiescent legacy JSON snapshot without modifying the source files.

Run only after stopping the old writer and copying web-sessions to a private
snapshot directory. Source changes, ID collisions and malformed records are
recorded as conflicts. Repeating the same snapshot does not add duplicate rows.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
from pathlib import Path
from uuid import UUID

from .chat_db import ChatDB, digest, json_text, scope_id, timestamp


def read_snapshot(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Snapshot source must be a regular file")
    before = path.stat()
    raw = path.read_bytes()
    after = path.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (
        after.st_size,
        after.st_mtime_ns,
        after.st_ino,
    ):
        raise ValueError("Snapshot changed while reading")
    return raw.decode("utf-8"), before


def ensure_visitor(connection, visitor, created=0.0):
    if not isinstance(visitor, str) or not visitor:
        raise ValueError("Invalid visitor identifier")
    # Zero means the legacy record did not retain an issuance timestamp.
    connection.execute(
        "INSERT OR IGNORE INTO visitors VALUES (?, ?, ?)", (visitor, created, created)
    )


def import_auth(connection, data):
    if not isinstance(data, dict):
        raise TypeError("Invalid legacy session map")
    for token_hash, record in data.items():
        if len(token_hash) != 64 or any(
            c not in "0123456789abcdef" for c in token_hash
        ):
            raise ValueError("Legacy token hash is not SHA-256")
        visitor, issued = record["visitor_id"], record["issued_at"]
        last_seen = record.get("last_seen_at", issued)
        if not all(
            isinstance(value, (int, float)) and math.isfinite(value)
            for value in (issued, last_seen)
        ):
            raise ValueError("Invalid legacy session timestamps")
        previous = connection.execute(
            "SELECT visitor_id,issued_at FROM sessions WHERE token_hash=?",
            (token_hash,),
        ).fetchone()
        if previous and (
            previous["visitor_id"] != visitor or previous["issued_at"] != issued
        ):
            raise ValueError("Legacy token hash has conflicting ownership")
        ensure_visitor(connection, visitor, issued)
        connection.execute(
            "INSERT OR IGNORE INTO sessions VALUES (?, ?, ?, ?, 0)",
            (token_hash, visitor, issued, last_seen),
        )


def upsert_message(connection, db, conversation, job_id, message, *, eligible):
    identifier = message["id"]
    role, content, created = message["role"], message["content"], message.get("time")
    if (
        role not in ("user", "assistant")
        or not isinstance(identifier, str)
        or not identifier
    ):
        raise ValueError("Invalid legacy message")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Empty legacy message")
    previous = connection.execute(
        "SELECT * FROM messages WHERE message_id=?", (identifier,)
    ).fetchone()
    if previous:
        if (
            previous["conversation_id"],
            previous["role"],
            previous["content"],
            previous["created_at"],
        ) != (conversation, role, content, created):
            raise ValueError("Message ID has conflicting content, scope or timestamp")
        if bool(previous["model_eligible"]) != eligible:
            raise ValueError("Message ID has conflicting completion state")
        return previous["sequence"]
    db._append(
        connection,
        conversation,
        job_id,
        role,
        content,
        created,
        message_id=identifier,
        eligible=eligible,
    )
    return connection.execute(
        "SELECT sequence FROM messages WHERE message_id=?", (identifier,)
    ).fetchone()[0]


def legacy_pair(job):
    """Only this job's pair, never duplicated historical messages in old jobs."""
    messages = job.get("messages", [])
    wanted = [job["job_id"] + "-user", job["job_id"] + "-assistant"]
    result = []
    for identifier in wanted:
        found = [m for m in messages if m.get("id") == identifier]
        if len(found) > 1:
            raise ValueError("Duplicate ID in legacy job history")
        if found:
            result.append(found[0])
    if len(result) != 2:
        return None
    if [message["role"] for message in result] != ["user", "assistant"] or result[0][
        "content"
    ] != job["message"]:
        raise ValueError("Legacy job and saved exchange disagree")
    if job.get("reply") is not None and job["reply"] != result[1]["content"]:
        raise ValueError("Legacy reply and saved exchange disagree")
    return result


def import_job(connection, db, job, history_pairs):
    job_id = str(UUID(job["job_id"]))
    visitor, character, scenario = (
        job["visitor_id"],
        job["character"],
        job["scenario_version"],
    )
    ensure_visitor(connection, visitor)
    accepted = job.get("accepted_at")
    # Request timestamps are retained when available. A missing value is an
    # explicit empty string (unknown), never the time of this import.
    accepted = accepted if isinstance(accepted, str) else ""
    conversation = db._conversation(connection, visitor, character, scenario, accepted)
    pair = legacy_pair(job) or history_pairs.get((conversation, job_id))
    if pair and pair[0]["content"] != job["message"]:
        raise ValueError("Job and conversation text disagree")
    status = job.get("status")
    error = job.get("error", {})
    if pair:
        status = "complete"
        error_code = None
    elif status in ("queued", "generating"):
        status, error_code = "interrupted", "interrupted"
    elif status == "error":
        error_code = error.get("code", "legacy_error")
    elif (
        status == "complete"
        and isinstance(job.get("reply"), str)
        and job["reply"].strip()
    ):
        # Older jobs can retain output without timestamped history; preserve the
        # observed text with an unknown timestamp, not an invented reading time.
        pair = [
            {
                "id": job_id + "-user",
                "role": "user",
                "content": job["message"],
                "time": None,
            },
            {
                "id": job_id + "-assistant",
                "role": "assistant",
                "content": job["reply"],
                "time": None,
            },
        ]
        error_code = None
    else:
        raise ValueError("Legacy completion has no recoverable output")
    request_id = job.get("request_id", "legacy:" + job_id)
    fingerprint = digest(json.dumps([character, job["message"]], ensure_ascii=False))
    if job.get("fingerprint", fingerprint) != fingerprint:
        raise ValueError("Legacy request fingerprint disagrees with content")
    previous = connection.execute(
        "SELECT * FROM requests WHERE job_id=?", (job_id,)
    ).fetchone()
    if previous and (
        previous["conversation_id"],
        previous["fingerprint"],
        previous["client_request_id"],
        previous["status"],
    ) != (conversation, fingerprint, request_id, status):
        raise ValueError("Legacy request ID conflicts with existing request")
    connection.execute(
        "INSERT OR IGNORE INTO requests (job_id,conversation_id,visitor_id,character_id,scenario_version,client_request_id,fingerprint,status,accepted_at,updated_at,error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            job_id,
            conversation,
            visitor,
            character,
            scenario,
            request_id,
            fingerprint,
            status,
            accepted,
            accepted,
            error_code,
        ),
    )
    if pair:
        for message in pair:
            upsert_message(connection, db, conversation, job_id, message, eligible=True)
    else:
        upsert_message(
            connection,
            db,
            conversation,
            job_id,
            {
                "id": job_id + "-user",
                "role": "user",
                "content": job["message"],
                "time": accepted or None,
            },
            eligible=False,
        )
    # Legacy storage had no run/metrics provenance. Do not pretend it did.


def normalize_history(data):
    visitor, character, scenario = data["scope"]
    conversation = scope_id(visitor, character, scenario)
    messages = []
    for index, original in enumerate(data["messages"]):
        message = dict(original)
        message.setdefault(
            "id",
            "legacy-"
            + digest(
                json_text(
                    [conversation, index, message.get("role"), message.get("content")]
                )
            ),
        )
        messages.append(message)
    if len(messages) % 2 or any(
        m.get("role") != ("user" if i % 2 == 0 else "assistant")
        for i, m in enumerate(messages)
    ):
        raise ValueError(
            "Legacy successful history is not a sequence of complete pairs"
        )
    return conversation, (visitor, character, scenario), messages


def import_history(connection, db, data):
    conversation, (visitor, character, scenario), messages = normalize_history(data)
    ensure_visitor(connection, visitor)
    db._conversation(
        connection,
        visitor,
        character,
        scenario,
        messages[0].get("time") or "" if messages else "",
    )
    previous_sequence = 0
    for message in messages:
        # A history from CLI can lack request IDs. Preserve its source position
        # in the stable message ID and leave request provenance unknown.
        job_id = None
        identifier = message["id"]
        for suffix in ("-user", "-assistant"):
            if identifier.endswith(suffix):
                candidate = identifier[: -len(suffix)]
                if connection.execute(
                    "SELECT 1 FROM requests WHERE job_id=?", (candidate,)
                ).fetchone():
                    job_id = candidate
        sequence = upsert_message(
            connection, db, conversation, job_id, message, eligible=True
        )
        if sequence <= previous_sequence:
            raise ValueError("Legacy history order conflicts with imported messages")
        previous_sequence = sequence


def import_snapshot(db, snapshot, *, quiescent=False):
    if not quiescent:
        raise ValueError("Import requires an explicitly quiescent snapshot")
    root = Path(snapshot)
    if (root / "web-sessions").is_dir():
        root = root / "web-sessions"
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Snapshot must be a private directory")
    files = [root / "auth.json"] if (root / "auth.json").exists() else []
    files += sorted((root / "jobs").glob("*.json"))
    files += sorted((root / "history").glob("*.json"))
    if not files:
        raise ValueError("Snapshot contains no legacy chat files")
    documents = []
    history_pairs = {}
    for path in files:
        raw, stat = read_snapshot(path)
        source_key = "legacy-web/" + path.relative_to(root).as_posix()
        try:
            data, error = json.loads(raw), None
            if not isinstance(data, dict):
                raise TypeError("Snapshot document must be an object")
            if data.get("accepted_at") is not None and not isinstance(
                data["accepted_at"], str
            ):
                raise ValueError("Legacy acceptance timestamp must be text")
            if path.parent.name == "history":
                conversation, _, messages = normalize_history(data)
                for user, assistant in zip(messages[::2], messages[1::2], strict=True):
                    if (
                        user["id"].endswith("-user")
                        and assistant["id"] == user["id"][:-5] + "-assistant"
                    ):
                        history_pairs[(conversation, user["id"][:-5])] = [
                            user,
                            assistant,
                        ]
        except (ValueError, KeyError, TypeError):
            data, error = None, "malformed_source"
        documents.append((path, raw, stat, source_key, data, error))
    # Old jobs wrote full histories; acceptance order keeps their individual
    # exchanges in original order while failed accepted messages remain visible.
    documents.sort(
        key=lambda item: (
            0
            if item[0].name == "auth.json"
            else 1
            if item[0].parent.name == "jobs"
            else 2,
            (item[4] or {}).get("accepted_at") or "",
            item[3],
        )
    )
    report = {"imported": 0, "skipped": 0, "conflicts": []}
    for path, raw, old_stat, source_key, data, error in documents:
        current = path.stat()
        if (current.st_size, current.st_mtime_ns, current.st_ino) != (
            old_stat.st_size,
            old_stat.st_mtime_ns,
            old_stat.st_ino,
        ):
            raise ValueError("Snapshot changed during import")
        source_hash = digest(raw)
        with db.connection(write=True) as connection:
            prior = connection.execute(
                "SELECT status FROM import_records WHERE source_key=? AND source_sha256=?",
                (source_key, source_hash),
            ).fetchone()
            if prior:
                report["skipped"] += 1
                if prior["status"] == "conflict":
                    report["conflicts"].append(
                        {
                            "source": source_key,
                            "sha256": source_hash,
                            "reason": "previous_conflict",
                        }
                    )
                continue
            if connection.execute(
                "SELECT 1 FROM import_records WHERE source_key=? AND status='imported'",
                (source_key,),
            ).fetchone():
                error = "source_changed_after_import"
            connection.execute("SAVEPOINT source_record")
            try:
                if error:
                    raise ValueError(error)
                if path.name == "auth.json":
                    import_auth(connection, data)
                elif path.parent.name == "jobs":
                    import_job(connection, db, data, history_pairs)
                else:
                    import_history(connection, db, data)
                state, detail = "imported", {"source_bytes": len(raw.encode())}
                connection.execute("RELEASE source_record")
                report["imported"] += 1
            except (ValueError, KeyError, TypeError, sqlite3.IntegrityError) as failure:
                connection.execute("ROLLBACK TO source_record")
                connection.execute("RELEASE source_record")
                state = "conflict"
                # No raw token/message or exception text enters the report.
                detail = {"reason": error or type(failure).__name__}
                report["conflicts"].append(
                    {"source": source_key, "sha256": source_hash, **detail}
                )
            connection.execute(
                "INSERT INTO import_records VALUES (?, ?, ?, ?, ?)",
                (source_key, source_hash, timestamp(), state, json_text(detail)),
            )
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--quiescent-snapshot", action="store_true", required=True)
    args = parser.parse_args()
    report = import_snapshot(
        ChatDB(args.database), args.snapshot, quiescent=args.quiescent_snapshot
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["conflicts"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
