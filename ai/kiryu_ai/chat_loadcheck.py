"""Synthetic single-model FIFO, restoration and final-input isolation diagnostics.

This uses an isolated SQLite database and in-process HTTP transport, not the
public Worker or real visitors. It never starts/stops llama-server. Run only
after other model work has stopped; one warmup + eight measured/probe replies
share the already-running model. --self-test uses only a tiny CPU fake.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from .chat_prompt import reconstruct_input
from .chat_server import create_app


def private_json(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def system_memory_sample():
    """System-wide observations only; never label these as model RSS/peak usage."""
    result = {"observed_at_unix": time.time(), "scope": "system-wide"}
    for name, command in (
        ("swapusage", ["/usr/sbin/sysctl", "vm.swapusage"]),
        ("vm_stat", ["/usr/bin/vm_stat"]),
    ):
        try:
            completed = subprocess.run(
                command, capture_output=True, text=True, timeout=5, check=True
            )
            result[name] = completed.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            result[name] = None
    return result


@dataclass
class Visitor:
    label: str
    visitor_id: str
    token: str = field(repr=False)

    @property
    def headers(self):
        return {"Authorization": "Bearer " + self.token}


class LoadCheck:
    def __init__(self, output, *, poll_seconds=1.0, request_timeout=420):
        self.output = Path(output)
        if self.output.exists() and any(self.output.iterdir()):
            raise ValueError("Use a new empty private output directory")
        self.output.mkdir(parents=True, mode=0o700, exist_ok=True)
        self.output.chmod(0o700)
        self.data_root = self.output / "state"
        self.poll_seconds = poll_seconds
        self.request_timeout = request_timeout
        self.records = []
        self.visitors = []
        self.sentinels = {}
        self.memory = []
        self.memory_stop = asyncio.Event()
        self.wave_summaries = []

    async def sample_memory(self):
        while True:
            self.memory.append(await asyncio.to_thread(system_memory_sample))
            try:
                await asyncio.wait_for(self.memory_stop.wait(), timeout=1)
                return
            except TimeoutError:
                pass

    async def ready(self, client):
        until = time.monotonic() + 180
        while time.monotonic() < until:
            response = await client.get("/v1/health")
            status = response.json().get("status")
            if status == "ready":
                return
            if status == "error":
                raise RuntimeError("Production readiness verification failed")
            await asyncio.sleep(0.2)
        raise TimeoutError("Model readiness timeout")

    async def visitor(self, client, db, label):
        response = await client.post("/v1/sessions", json={})
        if response.status_code != 200:
            raise RuntimeError("Anonymous session issue failed")
        token = response.json()["token"]
        identity = db.authenticate(token)
        if identity is None:
            raise RuntimeError("New session is not present in the isolated database")
        visitor = Visitor(label, identity["visitor_id"], token)
        self.visitors.append(visitor)
        return visitor

    async def turn(self, client, db, visitor, character, message, label, phase):
        request_id = str(uuid4())
        arrival = time.monotonic()
        body = {"character": character, "message": message, "request_id": request_id}
        response = await client.post("/v1/chat", headers=visitor.headers, json=body)
        accepted_response = time.monotonic()
        record = {
            "label": label,
            "phase": phase,
            "visitor_id": visitor.visitor_id,
            "visitor_label": visitor.label,
            "character": character,
            "request": body,
            "arrival_monotonic": arrival,
            "accept_http_seconds": accepted_response - arrival,
            "accept_status": response.status_code,
            "poll_seconds": self.poll_seconds,
            "synthetic": True,
        }
        if response.status_code != 202:
            record["status"] = "not_accepted"
        else:
            job_id = response.json()["job_id"]
            record["job_id"] = job_id
            until = accepted_response + self.request_timeout
            while time.monotonic() < until:
                result = await client.get("/v1/jobs/" + job_id, headers=visitor.headers)
                if result.status_code != 200:
                    raise RuntimeError("Owned job lookup failed")
                public = result.json()
                if public["status"] in {"complete", "error"}:
                    break
                await asyncio.sleep(self.poll_seconds)
            else:
                raise TimeoutError("Synthetic job polling deadline exceeded")
            record["status"] = public["status"]
            record["accept_response_to_observed_terminal_seconds"] = (
                time.monotonic() - accepted_response
            )
            detail = db.request_detail(job_id)
            run = detail["run"] or {}
            metrics = run.get("metrics", {})
            reply = (
                detail.get("reply", "")
                if public["status"] == "complete"
                else run.get("output_text") or ""
            )
            record.update(
                accepted_at=detail["accepted_at"],
                completed_at=detail["updated_at"],
                accept_to_terminal_seconds=(
                    datetime.fromisoformat(detail["updated_at"])
                    - datetime.fromisoformat(detail["accepted_at"])
                ).total_seconds(),
                queue_seconds=metrics.get("queue_seconds"),
                generation_seconds=metrics.get("generation_seconds"),
                generation_ttft_seconds=metrics.get("ttft_seconds"),
                service_seconds=metrics.get("service_seconds"),
                completion_tokens=metrics.get("completion_tokens"),
                output_kind="normal_reply"
                if public["status"] == "complete"
                else "failed_partial",
                output_characters=len(reply),
                output_utf8_bytes=len(reply.encode()),
                detail=detail,
            )
        self.records.append(record)
        private_json(self.output / (label + ".json"), record)
        return record

    async def wave(self, client, db, size):
        specs = []
        for index in range(size):
            label = f"wave{size}-{index + 1}"
            visitor = await self.visitor(client, db, label)
            # Wave2 seeds two independent histories in the same character scope.
            character = "haruka" if size == 2 or index % 2 == 0 else "majima"
            sentinel = "SYNTHETIC_SCOPE_" + uuid4().hex
            self.sentinels[sentinel] = (visitor.visitor_id, character)
            message = f"오늘 약속 확인에 쓸 내 표시는 {sentinel}야. 알았다고만 답해줘."
            specs.append((visitor, character, message, label))
        results = await asyncio.gather(
            *(
                self.turn(client, db, visitor, character, message, label, f"wave{size}")
                for visitor, character, message, label in specs
            )
        )
        accepted = sorted(
            (r for r in results if r.get("job_id")), key=lambda r: r["accepted_at"]
        )
        started = sorted(
            accepted, key=lambda r: r["detail"]["run"].get("started_at") or ""
        )
        summary = {
            "concurrent_arrivals": size,
            "samples": len(results),
            "successful": sum(r["status"] == "complete" for r in results),
            "arrival_spread_seconds": max(r["arrival_monotonic"] for r in results)
            - min(r["arrival_monotonic"] for r in results),
            "accepted_order": [r["job_id"] for r in accepted],
            "generation_order": [r["job_id"] for r in started],
            "fifo_matches": [r["job_id"] for r in accepted]
            == [r["job_id"] for r in started],
            "request_metrics": [
                {k: v for k, v in r.items() if k not in {"detail", "request"}}
                for r in results
            ],
        }
        self.wave_summaries.append(summary)
        return specs

    def input_audit(self):
        audits = []
        for record in self.records:
            if record.get("status") != "complete":
                audits.append({"label": record["label"], "audit_error": "not_complete"})
                continue
            detail = record["detail"]
            try:
                messages = reconstruct_input(
                    detail["run"]["metadata"], detail["messages"]
                )
            except (KeyError, ValueError):
                audits.append(
                    {"label": record["label"], "audit_error": "cannot_reconstruct"}
                )
                continue
            serialized = json.dumps(messages, ensure_ascii=False)
            scope = (record["visitor_id"], record["character"])
            foreign = [s for s, owner in self.sentinels.items() if owner != scope]
            foreign_input = [s for s in foreign if s in serialized]
            foreign_output = [s for s in foreign if s in detail.get("reply", "")]
            expected = [
                s
                for s, owner in self.sentinels.items()
                if owner == scope
                and (
                    s in record["request"]["message"]
                    or record["phase"] == "same-scope-probe"
                )
            ]
            audit = {
                "label": record["label"],
                "foreign_input_sentinels": foreign_input,
                "foreign_output_sentinels": foreign_output,
                "expected_own_missing": [s for s in expected if s not in serialized],
                "reconstruction_hash_verified": True,
                "final_messages": messages,
            }
            audits.append(audit)
        private_json(self.output / "input-audit.json", audits)
        return {
            "samples": len(audits),
            "audit_errors": sum(bool(a.get("audit_error")) for a in audits),
            "foreign_input_cases": sum(
                bool(a.get("foreign_input_sentinels")) for a in audits
            ),
            "foreign_output_cases": sum(
                bool(a.get("foreign_output_sentinels")) for a in audits
            ),
            "expected_own_missing_cases": sum(
                bool(a.get("expected_own_missing")) for a in audits
            ),
            "scope": "final serialized input and returned text; not a hidden KV-state audit",
        }

    async def run(self, app_options, *, cpu_only=False):
        import httpx2 as httpx

        memory_task = asyncio.create_task(self.sample_memory())
        try:
            app = create_app(self.data_root, **app_options)
            async with (
                app.router.lifespan_context(app),
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://loadcheck.local",
                ) as client,
            ):
                await self.ready(client)
                db = app.state.service.db
                warmup = await self.visitor(client, db, "warmup")
                warmup_result = await self.turn(
                    client, db, warmup, "haruka", "준비됐어?", "warmup", "warmup"
                )
                if warmup_result["status"] != "complete":
                    raise RuntimeError(
                        "Warmup failed; concurrent model requests not started"
                    )
                wave2 = await self.wave(client, db, 2)
                await self.wave(client, db, 4)
                # B's history should survive while A's same-contact marker is excluded.
                await self.turn(
                    client,
                    db,
                    wave2[1][0],
                    "haruka",
                    "방금 내가 알려 준 표시 기억나?",
                    "same-scope-probe",
                    "same-scope-probe",
                )
                # A switches contact: even A's Haruka-only marker must be absent.
                await self.turn(
                    client,
                    db,
                    wave2[0][0],
                    "majima",
                    "내가 오늘 약속 표시를 알려 줬었나?",
                    "cross-character-probe",
                    "cross-character-probe",
                )
                histories = {}
                for visitor in self.visitors:
                    for character in ("haruka", "majima"):
                        response = await client.get(
                            "/v1/history",
                            headers=visitor.headers,
                            params={"character": character},
                        )
                        histories[(visitor.visitor_id, character)] = response.json()
                before_counts = counts(db)
                model_manifest = app.state.service.engine.manifest
            # Closing this isolated API does not stop the externally owned model.
            restart = create_app(self.data_root, **app_options)
            restored = []
            duplicates = []
            async with (
                restart.router.lifespan_context(restart),
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=restart),
                    base_url="http://loadcheck.local",
                ) as client,
            ):
                await self.ready(client)
                for visitor in self.visitors:
                    for character in ("haruka", "majima"):
                        response = await client.get(
                            "/v1/history",
                            headers=visitor.headers,
                            params={"character": character},
                        )
                        restored.append(
                            response.status_code == 200
                            and response.json()
                            == histories[(visitor.visitor_id, character)]
                        )
                by_id = {v.visitor_id: v for v in self.visitors}
                for record in self.records:
                    if not record.get("job_id"):
                        duplicates.append(False)
                        continue
                    visitor = by_id[record["visitor_id"]]
                    response = await client.post(
                        "/v1/chat", headers=visitor.headers, json=record["request"]
                    )
                    duplicates.append(
                        response.status_code == 202
                        and response.json().get("job_id") == record["job_id"]
                    )
                other = wave2[1][0]
                owned = next(r for r in self.records if r["label"] == "wave2-1")
                denied = await client.get(
                    "/v1/jobs/" + owned["job_id"], headers=other.headers
                )
                after_counts = counts(restart.state.service.db)
            restoration = {
                "same_tokens_history_checks": len(restored),
                "all_histories_restored": all(restored),
                "uuid_replays": len(duplicates),
                "all_job_ids_unchanged": all(duplicates),
                "counts_before": before_counts,
                "counts_after": after_counts,
                "no_additional_rows_or_generations": before_counts == after_counts,
                "cross_visitor_job_denied": denied.status_code == 404,
            }
            audit = self.input_audit()
            summary = {
                "cpu_self_test": cpu_only,
                "transport": "in-process ASGI HTTP; excludes public network/Worker latency",
                "model_processes_started": 0,
                "generation_slots": 1,
                "queue": "one service FIFO, maximum8 waiting, distinct visitors",
                "samples": len(self.records),
                "warmup_samples_excluded_from_waves": 1,
                "waves": self.wave_summaries,
                "restoration": restoration,
                "isolation": audit,
                "model_manifest": model_manifest,
                "system_memory_samples": len(self.memory),
                "memory_command_successes": {
                    name: sum(sample.get(name) is not None for sample in self.memory)
                    for name in ("swapusage", "vm_stat")
                },
                "p95_claim": "none: 2/4 arrival cohorts are individual observations, not a p95 sample",
                "fan_quality_review": "not performed",
            }
            summary["pass"] = (
                all(
                    w["successful"] == w["samples"] and w["fifo_matches"]
                    for w in self.wave_summaries
                )
                and all(restored)
                and all(duplicates)
                and before_counts == after_counts
                and denied.status_code == 404
                and not any(
                    audit[k]
                    for k in (
                        "audit_errors",
                        "foreign_input_cases",
                        "foreign_output_cases",
                        "expected_own_missing_cases",
                    )
                )
            )
            private_json(self.output / "summary.json", summary)
            private_json(
                self.output / "visitors.json",
                [{"label": v.label, "visitor_id": v.visitor_id} for v in self.visitors],
            )
            return summary
        except Exception as error:
            private_json(
                self.output / "failure.json",
                {
                    "type": type(error).__name__,
                    "note": "Incomplete run; inspect private records. No pass claim.",
                },
            )
            raise
        finally:
            self.memory_stop.set()
            await memory_task
            private_json(
                self.output / "system-memory.json",
                {
                    "scope": "system-wide, sampled; not model RSS or exact peak",
                    "samples": self.memory,
                },
            )


def counts(db):
    with db.connection() as connection:
        return {
            table: connection.execute("SELECT count(*) FROM " + table).fetchone()[0]
            for table in ("requests", "messages", "generation_runs")
        }


def cpu_options():
    """Same API/SQLite/FIFO paths; only generation and input assembly are synthetic."""

    class Engine:
        def __init__(self):
            self.manifest = {"model_file": "CPU_SYNTHETIC_ONLY"}
            self.lock = threading.Lock()

        def count_tokens(self, messages):
            return len(str(messages))

        def reply(self, messages, **_):
            if not self.lock.acquire(blocking=False):
                raise RuntimeError(
                    "Concurrent fake generation violated one-slot contract"
                )
            try:
                time.sleep(0.04)
                return {
                    "reply": "검증용 답장",
                    "finish_reason": "stop",
                    "total_seconds": 0.04,
                    "ttft_seconds": 0.01,
                    "completion_tokens": 6,
                }
            finally:
                self.lock.release()

    class Builder:
        def build(
            self,
            *,
            visitor_id,
            character_id,
            scenario_version,
            user_message,
            history,
            **_,
        ):
            system = "SYNTHETIC " + character_id
            messages = (
                [{"role": "system", "content": system}]
                + [{"role": m["role"], "content": m["content"]} for m in history]
                + [{"role": "user", "content": user_message}]
            )
            digest = hashlib.sha256(
                json.dumps(
                    messages, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ).encode()
            ).hexdigest()
            return {
                "messages": messages,
                "metadata": {
                    "visitor_id": visitor_id,
                    "character_id": character_id,
                    "scenario_version": scenario_version,
                    "system_snapshot": system,
                    "user_envelope_snapshot": user_message,
                    "input_message_ids": [m["id"] for m in history],
                    "input_sha256": digest,
                },
                "retrieval_hits": [],
            }

    engine = Engine()
    return {"engine_factory": lambda: engine, "builder": Builder()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument(
        "--run-model",
        action="store_true",
        help="Explicitly permit real generation against the already-running model",
    )
    parser.add_argument("--manifest")
    parser.add_argument("--api-key-file")
    parser.add_argument("--embedding-dir")
    parser.add_argument("--model-url", default="http://127.0.0.1:8791")
    args = parser.parse_args()
    if args.self_test == args.run_model:
        parser.error("Choose exactly one of --self-test or --run-model")
    if not args.self_test and not all(
        (args.manifest, args.api_key_file, args.embedding_dir)
    ):
        parser.error(
            "Real generation requires --manifest, --api-key-file and --embedding-dir"
        )
    os.umask(0o077)
    options = (
        cpu_options()
        if args.self_test
        else {
            "manifest_path": args.manifest,
            "api_key_file": args.api_key_file,
            "embedding_dir": args.embedding_dir,
            "model_url": args.model_url,
        }
    )
    check = LoadCheck(args.output)
    try:
        summary = asyncio.run(check.run(options, cpu_only=args.self_test))
    except Exception:  # noqa: BLE001 -- suppress private HTTP/provider diagnostics
        print(json.dumps({"status": "incomplete", "output": str(check.output)}))
        raise SystemExit(1) from None
    print(
        json.dumps(
            {
                "pass": summary["pass"],
                "samples": summary["samples"],
                "cpu_self_test": args.self_test,
                "output": str(check.output),
            }
        )
    )
    raise SystemExit(0 if summary["pass"] else 1)


if __name__ == "__main__":
    main()
