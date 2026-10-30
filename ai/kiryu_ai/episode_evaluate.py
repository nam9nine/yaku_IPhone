"""Synthetic real-model episode conversations through the actual API and DB.

Run in a fresh private directory. The controlled presence clock accelerates only
setup; it does not measure real-world notification timing or approve fan quality.
"""

from __future__ import annotations

import argparse
import functools
import hashlib
import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from starlette.testclient import TestClient

from .chat_server import SCENARIO, create_app


def evaluate(args):
    os.umask(0o077)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    fixtures_path = Path(args.fixtures)
    fixtures = json.loads(fixtures_path.read_text())
    sources = list(Path(__file__).parent.glob("*.py")) + list(
        fixtures_path.parent.glob("*.json")
    )
    manifest = {
        "started_at": datetime.now(UTC).isoformat(),
        "fixture_sha256": hashlib.sha256(fixtures_path.read_bytes()).hexdigest(),
        "source_hashes": {
            str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources
        },
        "model_manifest": json.loads(Path(args.manifest).read_text()),
        "seed": fixtures["seed"],
        "fan_review": "pending",
        "setup_clock": "synthetic active heartbeats; not public timing validation",
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2)
    )
    app = create_app(
        output / "state",
        manifest_path=args.manifest,
        api_key_file=args.api_key_file,
        embedding_dir=args.embedding_dir,
        episodes_enabled=True,
    )
    records = []
    with TestClient(app) as client:
        service = app.state.service
        deadline = time.monotonic() + 120
        while service.status != "ready":
            if service.status == "error" or time.monotonic() >= deadline:
                raise RuntimeError("Model setup failed")
            time.sleep(0.1)
        # Only deterministic sampling changes: the production builder, DB, queue,
        # reader and both engine profiles are used without replacement outputs.
        for engine in (service.engine, service.followup_engine):
            engine.reply = functools.partial(engine.reply, seed=fixtures["seed"])
        for case in fixtures["cases"][: args.limit]:
            session = service.db.issue_session()
            token = session["token"]
            record = service.db.authenticate(token)
            visitor = record["visitor_id"]
            auth = {"Authorization": "Bearer " + token}
            client_id, seq = str(uuid4()), 0

            def command(
                kind, *, now=None, client_id=client_id, record=record, **values
            ):
                nonlocal seq
                seq += 1
                body = {
                    "protocol": 1,
                    "client_id": client_id,
                    "sequence": seq,
                    "kind": kind,
                    **values,
                }
                return client.portal.call(
                    functools.partial(
                        service.episode_command,
                        record,
                        body,
                        address="synthetic-eval",
                        now=now,
                    )
                )

            def poll(
                job_id,
                label,
                user_message=None,
                *,
                auth=auth,
                case=case,
                visitor=visitor,
                command=command,
            ):
                started = time.monotonic()
                heartbeat = started
                while True:
                    response = client.get(
                        "/v1/jobs/" + job_id + "?episodes=1", headers=auth
                    )
                    response.raise_for_status()
                    job = response.json()
                    if job["status"] in ("complete", "error"):
                        break
                    if time.monotonic() - started > 360:
                        raise TimeoutError("Synthetic model turn timed out")
                    if time.monotonic() - heartbeat > 10:
                        command("presence", active=True)
                        heartbeat = time.monotonic()
                    time.sleep(0.25)
                detail = service.db.request_detail(job_id)
                item = {
                    "case_id": case["id"],
                    "stage": label,
                    "user_message": user_message,
                    "job": job,
                    "episode": service.db.episodes.get(visitor, SCENARIO),
                    "run": detail.get("run"),
                    "seconds": round(time.monotonic() - started, 3),
                    "criteria": case["criteria"],
                    "axes": dict.fromkeys(
                        ("judgment", "speech", "canon_boundary", "context"), "unrated"
                    ),
                    "fan_review": "pending",
                }
                records.append(item)
                with (output / "responses.jsonl").open("a") as handle:
                    handle.write(json.dumps(item, ensure_ascii=False) + "\n")
                print(
                    json.dumps(
                        {
                            "case": case["id"],
                            "stage": label,
                            "status": job["status"],
                            "reply": job.get("reply"),
                            "error": job.get("error"),
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                return job

            # Ten heartbeats spanning 90 seconds; last timestamp is real now so
            # the ordinary production foreground guard remains effective.
            current = time.time()
            state = None
            for i in range(10):
                state = command("presence", active=True, now=current - 90 + i * 10)
            action = state.get("action")
            if not action or action["kind"] != "message":
                raise RuntimeError("Invitation was not scheduled")
            invitation = poll(action["job_id"], "invitation")
            if invitation["status"] != "complete":
                continue
            command("delivered", action_id=action["id"], job_id=action["job_id"])
            if case.get("initial_followup"):
                # Accelerate only synthetic active-use time, then restore actual
                # presence before dispatching the real followup generation.
                current = time.time()
                for i in range(1, 20):
                    state = command("presence", active=True, now=current + i * 10)
                state = command("presence", active=True)
                call = state.get("action")
                if not call or call["kind"] != "call":
                    raise RuntimeError("Synthetic call was not scheduled")
                command("call_started", action_id=call["id"], call_id=call["call_id"])
                state = command(
                    "call_result",
                    call_id=call["call_id"],
                    outcome=case["initial_followup"],
                )
                action = state.get("action")
                if not action or action["kind"] != "message":
                    state = command("presence", active=True)
                    action = state.get("action")
                if not action or action["kind"] != "message":
                    raise RuntimeError("Synthetic followup was not scheduled")
                followup = poll(action["job_id"], "followup")
                if followup["status"] == "complete":
                    command(
                        "delivered", action_id=action["id"], job_id=action["job_id"]
                    )
            for turn, message in enumerate(case["messages"], 1):
                response = client.post(
                    "/v1/chat",
                    headers=auth,
                    json={
                        "character": "majima",
                        "message": message,
                        "request_id": str(uuid4()),
                    },
                )
                response.raise_for_status()
                poll(response.json()["job_id"], f"turn-{turn}", message)
            command("presence", active=False)
    summary = {
        "records": len(records),
        "complete": sum(r["job"]["status"] == "complete" for r in records),
        "errors": sum(r["job"]["status"] != "complete" for r in records),
        "semantic_review": "pending",
        "fan_review": "pending",
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", default="ai/chat/bowling-evaluation.json")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--api-key-file", required=True)
    parser.add_argument("--embedding-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int, default=12)
    args = parser.parse_args()
    if not 1 <= args.limit <= 12:
        parser.error("limit must be 1..12")
    evaluate(args)


if __name__ == "__main__":
    main()
