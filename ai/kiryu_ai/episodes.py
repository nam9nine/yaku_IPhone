"""One bounded, visitor-owned IF episode. Canon and actual experience stay separate."""

from __future__ import annotations

import json
import secrets
import time
from uuid import UUID, uuid4

EPISODE_ID = "majima-bowling-v1"
PROTOCOL = 1
PRESENCE_TTL = 25
INITIAL_MS = 90_000
CONTEXT_KEYS = (
    "episode_id",
    "instance_id",
    "version",
    "phase",
    "pending_proposal",
    "close_reason",
    "evidence_message_ids",
    "user_reports",
    "contact_stage",
)
EPISODE_SCHEMA = """
CREATE TABLE IF NOT EXISTS episodes (
    visitor_id TEXT NOT NULL REFERENCES visitors, scenario_version TEXT NOT NULL,
    state_json TEXT NOT NULL CHECK(json_valid(state_json)),
    PRIMARY KEY(visitor_id, scenario_version)
);
CREATE TABLE IF NOT EXISTS episode_clients (
    visitor_id TEXT NOT NULL REFERENCES visitors, scenario_version TEXT NOT NULL,
    client_id TEXT NOT NULL, sequence INTEGER NOT NULL, last_seen REAL NOT NULL,
    PRIMARY KEY(visitor_id, scenario_version, client_id)
);
"""


def validate_command(value):
    if (
        not isinstance(value, dict)
        or type(value.get("protocol")) is not int
        or value["protocol"] != PROTOCOL
    ):
        raise ValueError("Unsupported episode protocol")
    kind = value.get("kind")
    fields = {
        "presence": {"active", "relationship_tone"},
        "delivered": {"action_id", "job_id"},
        "call_started": {"action_id", "call_id"},
        "call_result": {"call_id", "outcome"},
    }
    if (
        kind not in fields
        or set(value) - {"protocol", "client_id", "sequence", "kind"} - fields[kind]
    ):
        raise ValueError("Invalid episode command")
    try:
        client = str(UUID(value["client_id"]))
    except (KeyError, ValueError, TypeError, AttributeError) as error:
        raise ValueError("Invalid episode client") from error
    seq = value.get("sequence")
    if isinstance(seq, bool) or not isinstance(seq, int) or not 1 <= seq < 2**53:
        raise ValueError("Invalid episode sequence")
    if kind == "presence":
        if not isinstance(value.get("active"), bool) or value.get(
            "relationship_tone", "neutral"
        ) not in {"neutral", "warm", "cool"}:
            raise ValueError("Invalid episode presence")
    else:
        required = fields[kind]
        if not required <= set(value):
            raise ValueError("Missing episode action fields")
        for key in required - {"outcome"}:
            try:
                UUID(value[key])
            except (ValueError, TypeError, AttributeError) as error:
                raise ValueError("Invalid episode action ID") from error
        if kind == "call_result" and value["outcome"] not in {
            "missed",
            "declined",
            "idle",
            "ended",
        }:
            raise ValueError("Invalid episode call outcome")
    return {**value, "client_id": client}


class EpisodeStore:
    def __init__(self, db):
        self.db = db

    @staticmethod
    def load(connection, visitor, scenario):
        row = connection.execute(
            "SELECT state_json FROM episodes WHERE visitor_id=? AND scenario_version=?",
            (visitor, scenario),
        ).fetchone()
        return json.loads(row[0]) if row else None

    @staticmethod
    def save(connection, visitor, scenario, state):
        connection.execute(
            "INSERT INTO episodes VALUES (?, ?, ?) ON CONFLICT(visitor_id,scenario_version) "
            "DO UPDATE SET state_json=excluded.state_json",
            (
                visitor,
                scenario,
                json.dumps(state, ensure_ascii=False, separators=(",", ":")),
            ),
        )

    @staticmethod
    def initial():
        return {
            "episode_id": EPISODE_ID,
            "instance_id": str(uuid4()),
            "version": 1,
            "phase": "not_started",
            "contact_stage": "initial",
            "pending_proposal": None,
            "close_reason": None,
            "evidence_message_ids": [],
            "user_reports": [],
            "remaining_ms": INITIAL_MS,
            "call_wait_ms": None,
            "owner_client": None,
            "last_presence_at": None,
            "active": False,
            "clock_eligible": False,
            "relationship_tone": "neutral",
            "job_id": None,
            "call_id": None,
            "call_owner": None,
            "call_outcome": None,
            "interpretation_pending": False,
            "last_user_message_id": None,
            "invite_delivered": False,
            "followup_delivered": False,
        }

    def get(self, visitor, scenario):
        with self.db.connection() as connection:
            return self.load(connection, visitor, scenario)

    @staticmethod
    def context(state):
        return {key: state[key] for key in CONTEXT_KEYS} if state else None

    @staticmethod
    def is_active(state, now=None):
        now = time.time() if now is None else now
        return bool(
            state
            and state["active"]
            and state["last_presence_at"] is not None
            and 0 <= now - state["last_presence_at"] <= PRESENCE_TTL
        )

    @staticmethod
    def action(state):
        if not state:
            return None
        stage = state["contact_stage"]
        if (
            stage in {"invite_pending", "waiting_delivery", "followup_pending"}
            and state["job_id"]
        ):
            return {"kind": "message", "id": state["job_id"], "job_id": state["job_id"]}
        if stage == "call_ready":
            return {"kind": "call", "id": state["call_id"], "call_id": state["call_id"]}
        return None

    def response(self, visitor, scenario, *, enabled=True, accepted=None):
        state = self.get(visitor, scenario)
        result = {
            "protocol": PROTOCOL,
            "enabled": enabled,
            "episode": self.context(state) if enabled else None,
            "action": self.action(state) if enabled else None,
        }
        if accepted is not None:
            result["accepted"] = accepted
        return result

    def command(self, visitor, scenario, value, *, busy=False, now=None):
        value = validate_command(value)
        now = time.time() if now is None else now
        client, seq, kind = value["client_id"], value["sequence"], value["kind"]
        with self.db.connection(write=True) as connection:
            state = self.load(connection, visitor, scenario) or self.initial()
            prior = connection.execute(
                "SELECT sequence FROM episode_clients WHERE visitor_id=? AND scenario_version=? AND client_id=?",
                (visitor, scenario, client),
            ).fetchone()
            # Duplicate action acknowledgements are safe; reordered presence may
            # never revive an inactive client or count its time a second time.
            fresh = prior is None or seq > prior[0]
            if fresh:
                connection.execute(
                    "INSERT INTO episode_clients VALUES (?, ?, ?, ?, ?) ON CONFLICT(visitor_id,scenario_version,client_id) "
                    "DO UPDATE SET sequence=excluded.sequence,last_seen=excluded.last_seen",
                    (visitor, scenario, client, seq, now),
                )
            accepted = False
            if kind == "presence" and fresh:
                owner = state["owner_client"]
                previous = state["last_presence_at"]
                lease = previous is not None and 0 <= now - previous <= PRESENCE_TTL
                if owner == client or not lease:
                    elapsed = (
                        min(10.0, max(0.0, now - previous))
                        if owner == client
                        and lease
                        and state["active"]
                        and value["active"]
                        and state.get("clock_eligible", False)
                        and not busy
                        else 0.0
                    )
                    state.update(
                        owner_client=client,
                        active=value["active"],
                        last_presence_at=now,
                        relationship_tone=value.get("relationship_tone", "neutral"),
                        clock_eligible=value["active"] and not busy,
                    )
                    if (
                        not busy
                        and not state["interpretation_pending"]
                        and state["contact_stage"] in {"initial", "waiting_call"}
                    ):
                        state["remaining_ms"] = max(
                            0, state["remaining_ms"] - round(elapsed * 1000)
                        )
                    if (
                        state["contact_stage"] == "waiting_call"
                        and state["remaining_ms"] == 0
                        and value["active"]
                    ):
                        state.update(contact_stage="call_ready", call_id=str(uuid4()))
                    accepted = True
            elif kind == "delivered":
                job = connection.execute(
                    "SELECT status FROM requests WHERE job_id=? AND visitor_id=?",
                    (value["job_id"], visitor),
                ).fetchone()
                if (
                    value["action_id"] == value["job_id"] == state["job_id"]
                    and job
                    and job[0] == "complete"
                ):
                    if state["contact_stage"] == "waiting_delivery":
                        wait_ms = state["call_wait_ms"] or (
                            120_000 + secrets.randbelow(60_001)
                        )
                        state.update(
                            contact_stage="waiting_call",
                            remaining_ms=wait_ms,
                            call_wait_ms=wait_ms,
                            invite_delivered=True,
                            last_presence_at=now,
                        )
                        accepted = True
                    elif state["contact_stage"] == "followup_pending":
                        state.update(contact_stage="rest", followup_delivered=True)
                        accepted = True
                    elif state["invite_delivered"] or state["followup_delivered"]:
                        accepted = True
            elif kind == "call_started":
                correct = value["action_id"] == value["call_id"] == state["call_id"]
                if (
                    correct
                    and state["contact_stage"] == "call_ready"
                    and self.is_active(state, now)
                ):
                    state.update(contact_stage="call_active", call_owner=client)
                    accepted = True
                elif (
                    correct
                    and state["contact_stage"] == "call_active"
                    and state["call_owner"] == client
                ):
                    accepted = True
            elif kind == "call_result":
                if (
                    value["call_id"] == state["call_id"]
                    and state["call_owner"] is not None
                ):
                    if state["call_outcome"] is not None:
                        accepted = state["call_outcome"] == value["outcome"]
                    elif state["call_outcome"] is None:
                        outcome = value["outcome"]
                        state.update(
                            call_outcome=outcome,
                            contact_stage=(
                                "followup_due"
                                if outcome in {"missed", "declined", "idle"}
                                and not state["interpretation_pending"]
                                and state["phase"] != "closed"
                                else "rest"
                            ),
                        )
                        accepted = True
            self.save(connection, visitor, scenario, state)
        return accepted

    @classmethod
    def hold_for_user(cls, connection, visitor, scenario, message_id):
        state = cls.load(connection, visitor, scenario)
        if not state:
            return None
        state["version"] += 1
        state.update(
            interpretation_pending=True,
            last_user_message_id=message_id,
            resume_initial=state["phase"] == "not_started",
            contact_stage="rest",
        )
        cls.save(connection, visitor, scenario, state)
        return cls.context(state)

    def apply_decision(self, visitor, scenario, transition, message_id):
        if not isinstance(transition, dict):
            raise TypeError("Invalid episode decision")
        with self.db.connection(write=True) as connection:
            state = self.load(connection, visitor, scenario)
            if (
                not state
                or transition.get("episode_id") != EPISODE_ID
                or transition.get("version") != state["version"]
                or message_id != state["last_user_message_id"]
            ):
                return False
            decision = transition.get("decision")
            if decision not in {
                "no_change",
                "accept",
                "defer",
                "decline",
                "cancel",
                "report_outcome",
                "change_topic",
            }:
                raise ValueError("Invalid episode decision")
            evidence = transition.get("evidence_message_id")
            if evidence not in (
                {None, message_id} if decision == "no_change" else {message_id}
            ):
                raise ValueError("Decision must reference the current actual message")
            row = connection.execute(
                "SELECT m.content FROM messages m JOIN requests r ON r.job_id=m.job_id "
                "WHERE m.message_id=? AND m.role='user' AND r.visitor_id=? AND r.character_id='majima' AND r.scenario_version=?",
                (message_id, visitor, scenario),
            ).fetchone()
            if not row:
                raise ValueError("Missing decision evidence")
            state["interpretation_pending"] = False
            if decision == "accept":
                state.update(
                    phase="accepted", pending_proposal=row[0][:1000], close_reason=None
                )
            elif decision in {"defer", "change_topic"}:
                state.update(phase="deferred")
            elif decision in {"decline", "cancel", "report_outcome"}:
                state.update(
                    phase="closed", close_reason=decision, pending_proposal=None
                )
                if decision == "report_outcome":
                    state["user_reports"] = (
                        state["user_reports"]
                        + [{"message_id": message_id, "text": row[0]}]
                    )[-6:]
            elif state.pop("resume_initial", False) and state["phase"] == "not_started":
                state["contact_stage"] = "initial"
            if evidence:
                state["evidence_message_ids"] = list(
                    dict.fromkeys(state["evidence_message_ids"] + [evidence])
                )[-8:]
            self.save(connection, visitor, scenario, state)
            return True

    @classmethod
    def bind_job(cls, connection, visitor, scenario, job_id, ref):
        state = cls.load(connection, visitor, scenario)
        if (
            not state
            or ref.get("instance_id") != state["instance_id"]
            or ref.get("version") != state["version"]
            or state["interpretation_pending"]
        ):
            raise ValueError("Stale episode")
        expected = "initial" if ref["stage"] == "invite" else "followup_due"
        if state["contact_stage"] != expected:
            raise ValueError("Episode stage already reserved")
        state.update(
            job_id=job_id,
            contact_stage=(
                "invite_pending" if ref["stage"] == "invite" else "followup_pending"
            ),
        )
        if ref["stage"] == "invite":
            state["invitation_job_id"] = job_id
        cls.save(connection, visitor, scenario, state)

    @classmethod
    def valid_job(cls, connection, job):
        raw = job["episode_ref"]
        if not raw:
            return True
        ref = json.loads(raw) if isinstance(raw, str) else raw
        state = cls.load(connection, job["visitor_id"], job["scenario_version"])
        return bool(
            state
            and ref["instance_id"] == state["instance_id"]
            and ref["version"] == state["version"]
            and not state["interpretation_pending"]
            and state["job_id"] == job["job_id"]
        )

    @classmethod
    def completed(cls, connection, job):
        if not job["episode_ref"]:
            if job["character_id"] == "majima" and job["request_kind"] == "chat":
                state = cls.load(connection, job["visitor_id"], job["scenario_version"])
                if (
                    state
                    and state["phase"] == "not_started"
                    and state["last_user_message_id"] == job["job_id"] + "-user"
                ):
                    state.update(
                        interpretation_pending=False,
                        contact_stage="initial",
                        job_id=None,
                    )
                    cls.save(
                        connection, job["visitor_id"], job["scenario_version"], state
                    )
            return
        ref = json.loads(job["episode_ref"])
        state = cls.load(connection, job["visitor_id"], job["scenario_version"])
        if ref["stage"] == "invite":
            state.update(
                phase="awaiting_reply",
                contact_stage="waiting_delivery",
                pending_proposal="마지마가 제안한 볼링 승부. 사용자의 수락·일시·장소는 아직 미확정.",
            )
        cls.save(connection, job["visitor_id"], job["scenario_version"], state)

    def retry_inactive(self, job):
        ref = job.get("episode_ref")
        if not ref:
            return
        with self.db.connection(write=True) as connection:
            state = self.load(connection, job["visitor_id"], job["scenario_version"])
            if (
                state
                and state["version"] == ref["version"]
                and state["job_id"] == job["job_id"]
            ):
                state.update(
                    contact_stage="initial"
                    if ref["stage"] == "invite"
                    else "followup_due",
                    job_id=None,
                )
                self.save(connection, job["visitor_id"], job["scenario_version"], state)
