"""Reproducible synthetic Gemma conversation runs, never automatic fan approval."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

from .chat_prompt import ChatPromptBuilder, InputBudgetError
from .chat_reader import EvidenceReader
from .chat_retrieval import E5Onnx, HybridRetriever
from .gemma_engine import (
    CONTEXT_TOKENS,
    OUTPUT_TOKENS,
    REASONING_TOKENS,
    GemmaEngine,
    GemmaFailure,
)


def percentile(values, quantile):
    return (
        sorted(values)[max(0, math.ceil(len(values) * quantile) - 1)]
        if values
        else None
    )


def memory_observation(model_pid):
    result = {}
    for name, command in (("swap", ["sysctl", "vm.swapusage"]), ("vm", ["vm_stat"])):
        try:
            result[name] = subprocess.check_output(
                command, text=True, timeout=5
            ).strip()
        except (OSError, subprocess.SubprocessError):
            result[name] = "unavailable"
    if model_pid:
        try:
            result["model_rss_kib"] = int(
                subprocess.check_output(
                    ["ps", "-p", str(model_pid), "-o", "rss="], text=True, timeout=5
                ).strip()
            )
        except (ValueError, OSError, subprocess.SubprocessError):
            result["model_rss_kib"] = None
    return result


def evaluate(args):
    os.umask(0o077)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if (output / "responses.jsonl").exists():
        raise ValueError("Use a fresh output directory; never mix runs")
    engine = GemmaEngine(
        api_key_file=args.api_key_file,
        manifest_path=args.manifest,
        thinking=args.thinking == "on",
        reasoning_tokens=args.reasoning_tokens,
        context_tokens=args.context_tokens,
    )
    engine.record_template()
    retriever = HybridRetriever(args.registry, E5Onnx(args.embedding_dir))
    reader = None
    if args.reading == "separate":
        reader = EvidenceReader(
            GemmaEngine(
                api_key_file=args.api_key_file,
                manifest_path=args.manifest,
                thinking=False,
            ),
            seed=42,
        )
    builder = ChatPromptBuilder(args.registry, args.cards, retriever, reader)
    source_paths = [Path(args.registry), Path(args.cards), Path(args.fixtures)] + [
        Path(__file__).with_name(name)
        for name in (
            "chat_prompt.py",
            "chat_reader.py",
            "chat_retrieval.py",
            "gemma_engine.py",
            "chat_evaluate.py",
        )
    ]
    source_hashes = {
        str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in source_paths
    }
    fixtures = json.loads(Path(args.fixtures).read_text())
    logs = []
    engine.reply(
        [
            {"role": "system", "content": "한국어 문자 한 문장으로 답한다."},
            {"role": "user", "content": "준비됐어?"},
        ],
        seed=42,
        max_tokens=args.max_tokens,
    )
    initial_memory = memory_observation(args.model_pid)

    def run_turn(case_id, character, history, message, turn, criteria, phase):
        begin = time.monotonic()
        assembled = {"metadata": {}, "retrieval_hits": []}
        error = None

        def record_stage(stage):
            nonlocal assembled
            assembled = stage

        try:
            assembled = builder.build(
                case_id,
                character,
                "daily-if-v1",
                message,
                history,
                engine.count_tokens,
                context_limit=args.context_tokens,
                max_tokens=args.max_tokens,
                on_stage=record_stage,
            )
            result = engine.reply(
                assembled["messages"], seed=42, max_tokens=args.max_tokens
            )
        except GemmaFailure as failure:
            result, error = failure.result, failure.code
        except InputBudgetError:
            result, error = {}, "context_limit"
        total = time.monotonic() - begin
        record = {
            "case_id": case_id,
            "character": character,
            "turn": turn,
            "phase": phase,
            "message": message,
            "result": result,
            "error": error,
            "pipeline_seconds": total,
            "metadata": assembled["metadata"],
            "retrieval_hits": assembled["retrieval_hits"],
            "review_criteria": criteria,
            "axes": dict.fromkeys(
                [
                    "speech",
                    "judgment",
                    "relationship",
                    "knowledge",
                    "context",
                    "format",
                ],
                "unrated",
            ),
            "fan_review": "pending",
            "synthetic_evaluation": True,
            "reading_mode": args.reading,
        }
        logs.append(record)
        with (output / "responses.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            handle.flush()
        if (
            not error
            and result.get("finish_reason") in {"stop", "eos"}
            and result.get("reply")
        ):
            now = datetime.now(UTC).isoformat()
            for role, content in (("user", message), ("assistant", result["reply"])):
                history.append(
                    {
                        "id": f"{case_id}-{turn}-{role}",
                        "role": role,
                        "content": content,
                        "time": now,
                    }
                )
        print(
            json.dumps(
                {
                    "case": case_id,
                    "turn": turn,
                    "phase": phase,
                    "seconds": round(total, 3),
                    "finish": result.get("finish_reason"),
                    "error": error,
                }
            ),
            flush=True,
        )

    for phase in ("conversations", "long_conversations"):
        for case in fixtures[phase]:
            history = []
            for turn, message in enumerate(case["turns"], 1):
                run_turn(
                    case["id"],
                    case["character"],
                    history,
                    message,
                    turn,
                    case["review_criteria"],
                    phase,
                )
    for case in fixtures["paired_cases"]:
        for index, condition in enumerate(case["conditions"]):
            case_id = f"{case['id']}-{index}"
            history = [
                {**m, "id": f"{case_id}-fixture-{i}", "time": None}
                for i, m in enumerate(condition["history"])
            ]
            run_turn(
                case_id,
                case["character"],
                history,
                case["last_message"],
                1,
                [condition["criteria"]],
                "paired_cases",
            )
    # All requests use one loaded model, no queue and a warmup excluded above.
    # The first 60 varying conversation turns are a declared workload, not a
    # claim about every input length or concurrent visitor latency.
    measured = logs[:60]
    timings = [r["pipeline_seconds"] for r in measured]
    summary = {
        "samples": len(logs),
        "successful": sum(
            not r["error"] and r["result"].get("finish_reason") in {"stop", "eos"}
            for r in logs
        ),
        "performance_samples": len(measured),
        "performance_workload": "first60 conversation turns, warm, no queue, includes retrieval+native counting",
        "p50_seconds": percentile(timings, 0.5),
        "p95_seconds": percentile(timings, 0.95),
        "goal_seconds": None,
        "goal_pass": None,
        "latency_policy": "Quality-first bounded inference; UI delivery delay is measured separately",
        "initial_memory": initial_memory,
        "final_memory": memory_observation(args.model_pid),
        "peak_observed_completion_tokens": max(
            (r["result"].get("completion_tokens") or 0 for r in logs), default=0
        ),
        "model_manifest": engine.manifest,
        "generation_seed": 42,
        "training": False,
        "quality_review": "pending separate six-axis agent review; fan review pending",
        "heldout_claim": False,
        "note": "Author-created conversational diagnostics; not external benchmark reproduction",
        "reading_mode": args.reading,
        "source_sha256": source_hashes,
        "source_files_unchanged": all(
            hashlib.sha256(Path(path).read_bytes()).hexdigest() == sha
            for path, sha in source_hashes.items()
        ),
    }
    (output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                k: v
                for k, v in summary.items()
                if k not in {"model_manifest", "initial_memory", "final_memory"}
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in [
        "registry",
        "cards",
        "fixtures",
        "api-key-file",
        "manifest",
        "embedding-dir",
        "output",
    ]:
        p.add_argument("--" + name, required=True)
    p.add_argument("--model-pid", type=int)
    p.add_argument("--reading", choices=["direct", "separate"], default="separate")
    p.add_argument("--thinking", choices=["on", "off"], default="on")
    p.add_argument("--reasoning-tokens", type=int, default=REASONING_TOKENS)
    p.add_argument("--context-tokens", type=int, default=CONTEXT_TOKENS)
    p.add_argument("--max-tokens", type=int, default=OUTPUT_TOKENS)
    evaluate(p.parse_args())


if __name__ == "__main__":
    main()
