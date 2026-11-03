"""Multi-turn naturalness runs on the real model, for comparing prompt versions.

Each scenario replays scripted visitor turns and keeps the model's own replies as
history, the way the app does. Imports are absolute so the same file can be run
against an older checkout by pointing PYTHONPATH at that checkout's ``ai/``.
Use a copied model manifest and a fresh output directory. Outputs are synthetic
diagnostics, not fan review.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path

import kiryu_ai
from kiryu_ai.chat_policy import output_allowed
from kiryu_ai.chat_prompt import DEFAULT_DATA, ChatPromptBuilder, InputBudgetError
from kiryu_ai.chat_reader import EvidenceReader
from kiryu_ai.chat_retrieval import E5Onnx, HybridRetriever
from kiryu_ai.gemma_engine import (
    CONTEXT_TOKENS,
    OUTPUT_TOKENS,
    GemmaEngine,
    GemmaFailure,
)

SCENARIO = "daily-if-v1"


def evaluate(args):
    os.umask(0o077)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    fixtures = json.loads(Path(args.fixtures).read_text(encoding="utf-8"))
    scenarios = fixtures["scenarios"]
    if args.scenarios:
        wanted = set(args.scenarios.split(","))
        scenarios = [s for s in scenarios if s["id"] in wanted]
    selection = importlib.util.find_spec("kiryu_ai.reply_checks") is not None
    if args.samples > 1 and not selection:
        raise ValueError("This checkout has no reply_checks; use --samples 1")
    engine = GemmaEngine(
        api_key_file=args.api_key_file,
        manifest_path=args.manifest,
        thinking=args.thinking == "on",
    )
    plain = GemmaEngine(
        api_key_file=args.api_key_file, manifest_path=args.manifest, thinking=False
    )
    builder = ChatPromptBuilder(
        DEFAULT_DATA / "registry.json",
        DEFAULT_DATA / "cards.json",
        HybridRetriever(DEFAULT_DATA / "registry.json", E5Onnx(args.embedding_dir)),
        EvidenceReader(plain, seed=args.seed),
    )
    package = Path(kiryu_ai.__file__).parent
    (output / "manifest.json").write_text(
        json.dumps(
            {
                "started_at": datetime.now(UTC).isoformat(),
                "package": str(package),
                "prompt_version": builder.version,
                "profile_version": builder.cards["version"],
                "choice_set": args.choice_set,
                "samples": args.samples,
                "thinking": args.thinking,
                "seed": args.seed,
                "fixture_version": fixtures["version"],
                "source_hashes": {
                    p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in sorted(package.glob("*.py"))
                },
                "model_manifest": engine.manifest,
                "fan_review": "pending",
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    counter = [0]

    def generate(messages):
        counter[0] += 1
        return engine.reply(
            messages, seed=args.seed + counter[0], max_tokens=OUTPUT_TOKENS
        )

    for scenario in scenarios:
        character = scenario["character"]
        visitor = "eval-" + scenario["id"]
        history, sequence = [], 0
        for number, turn in enumerate(scenario["turns"], 1):
            message = turn.get("text") or turn["texts"][args.choice_set]
            events = turn.get("events", [])
            started = time.monotonic()
            record = {
                "scenario": scenario["id"],
                "character": character,
                "turn": number,
                "message": message,
                "events": events,
            }
            try:
                assembled = builder.build(
                    visitor,
                    character,
                    SCENARIO,
                    message,
                    history,
                    count_tokens=engine.count_tokens,
                    context_limit=CONTEXT_TOKENS,
                    max_tokens=OUTPUT_TOKENS,
                    phone_events=events,
                )
                if selection and args.samples > 1:
                    from kiryu_ai.reply_checks import (
                        judge_messages,
                        parse_pick,
                        select_reply,
                    )

                    card = builder.cards["characters"][character]
                    name = card.get("short_name") or card["display_name"]

                    def judge(
                        candidates,
                        messages=assembled["messages"],
                        name=name,
                        persona=card["prompt"],
                    ):
                        prompt = judge_messages(name, persona, messages[1:], candidates)
                        reply = plain.reply(prompt, max_tokens=8).get("reply")
                        return parse_pick(reply, len(candidates))

                    result, audit = select_reply(
                        lambda messages=assembled["messages"]: generate(messages),
                        character=character,
                        user_message=message,
                        previous=assembled.get("recent_replies", ()),
                        count=args.samples,
                        allowed=output_allowed,
                        judge=judge,
                        seed=f"{scenario['id']}:{number}",
                        **(
                            {
                                "examples": assembled["example_replies"],
                                "repair_complaints": True,
                            }
                            if "example_replies" in assembled
                            else {}
                        ),
                    )
                    record["selection"] = audit
                else:
                    result = generate(assembled["messages"])
            except (GemmaFailure, InputBudgetError, ValueError) as error:
                record.update(
                    error=getattr(error, "code", type(error).__name__),
                    seconds=round(time.monotonic() - started, 2),
                )
                _write(output, record)
                break
            reply = result.get("reply", "")
            record.update(
                reply=reply,
                finish_reason=result.get("finish_reason"),
                seconds=round(time.monotonic() - started, 2),
                input_tokens=assembled["metadata"].get("input_tokens"),
            )
            _write(output, record)
            print(json.dumps(record, ensure_ascii=False)[:400], flush=True)
            if result.get("finish_reason") not in {"stop", "eos"} or not reply:
                break
            sequence += 2
            history += [
                {
                    "id": f"{visitor}-{number}-user",
                    "role": "user",
                    "content": message,
                    "sequence": sequence - 1,
                    "phone_events": events,
                    "time": None,
                },
                {
                    "id": f"{visitor}-{number}-assistant",
                    "role": "assistant",
                    "content": reply,
                    "sequence": sequence,
                    "time": None,
                },
            ]


def _write(output, record):
    with (output / "responses.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fixtures", default=str(DEFAULT_DATA / "naturalness-evaluation.json")
    )
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--api-key-file", required=True)
    parser.add_argument("--embedding-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--choice-set", choices=["before", "after"], default="after")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--thinking", choices=["on", "off"], default="on")
    parser.add_argument("--scenarios", help="Comma-separated scenario IDs")
    parser.add_argument("--seed", type=int, default=133)
    evaluate(parser.parse_args())


if __name__ == "__main__":
    main()
