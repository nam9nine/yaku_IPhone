"""Interactive local text chat using the same input builder as SFT export."""

import argparse
import json
from pathlib import Path

from .data import build_messages
from .session import SessionStore, filter_knowledge, select_scoped_memory


def read_jsonl(path):
    return [
        json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()
    ]


def load_scenario_facts(data_root):
    root = Path(data_root)
    facts = {row["id"]: row for row in read_jsonl(root / "sources" / "knowledge.jsonl")}
    registry = json.loads((root / "data" / "scenario-facts.json").read_text())
    adopted = []
    for rule in registry["adopted_facts"]:
        if rule["id"] not in facts:
            raise ValueError(f"Adopted fact missing from source evidence: {rule['id']}")
        adopted.append({**facts[rule["id"]], "known_by": list(rule["known_by"])})
    return registry, adopted


def assemble_input(
    profile,
    store,
    visitor_id,
    user_message,
    *,
    known_context="",
    facts=(),
    memory=(),
    allowed_fact_ids=(),
):
    character = profile["character_id"]
    scenario = profile["scenario_version"]
    history = store.history(visitor_id, character, scenario)
    selected_facts = filter_knowledge(facts, character, allowed_fact_ids)
    selected_memory = select_scoped_memory(memory, visitor_id, character, scenario)
    messages = build_messages(
        profile,
        known_context,
        history,
        user_message,
        facts=selected_facts,
        memory=selected_memory,
    )
    return messages, {
        "visitor_id": visitor_id,
        "character_id": character,
        "scenario_version": scenario,
        "fact_ids": [f["id"] for f in selected_facts],
        "memory_count": len(selected_memory),
        "history_messages": len(history),
    }


def main():
    from .inference import LocalModel

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--character", default="majima")
    parser.add_argument("--visitor", default="local-user")
    parser.add_argument("--model")
    parser.add_argument("--adapter")
    parser.add_argument("--message")
    parser.add_argument("--no-facts", action="store_true")
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.message is not None and not args.message.strip():
        parser.error("--message must contain non-whitespace text")
    root = Path(args.data_root)
    profiles = {
        p["character_id"]: p
        for p in json.loads((root / "data" / "profiles.json").read_text())
    }
    if args.character not in profiles:
        parser.error("Unknown character: " + args.character)
    selected_file = root / "selected-model.json"
    selected = json.loads(selected_file.read_text()) if selected_file.exists() else {}
    model = args.model or selected.get("model")
    adapter = args.adapter if args.model else args.adapter or selected.get("adapter")
    if not model:
        parser.error(
            "Provide --model or create selected-model.json from an actual evaluated run"
        )
    registry, facts = load_scenario_facts(root)
    active = registry.get("active_characters", ["majima", "haruka"])
    if args.character not in active:
        parser.error("This experiment only activates: " + ", ".join(active))
    engine = LocalModel(model, adapter)
    store = SessionStore(root / "sessions")
    profile = profiles[args.character]
    if profile["scenario_version"] != registry["scenario_version"]:
        raise ValueError("Profile and knowledge registry scenario versions differ")
    allowed = [] if args.no_facts else [r["id"] for r in registry["adopted_facts"]]
    print(f"{profile['display_name']} · 로컬 실험 모델 (팬 평가 전)", flush=True)
    while True:
        if args.message is not None:
            message = args.message
        else:
            try:
                message = input("키류> ").strip()
            except (EOFError, KeyboardInterrupt):
                break
        if message in {"/quit", "/exit"}:
            break
        if not message:
            continue
        messages, scope = assemble_input(
            profile, store, args.visitor, message, facts=facts, allowed_fact_ids=allowed
        )
        try:
            result = engine.reply(messages, seed=args.seed, max_tokens=args.max_tokens)
        except ValueError as error:
            print(f"입력 제한: {error}", flush=True)
            if args.message is not None:
                raise
            continue
        print(f"{profile['display_name']}> {result['reply']}", flush=True)
        if result["finish_reason"] == "length":
            print(
                "응답이 출력 한도에서 중단되었습니다. 대화 기록에는 저장하지 않았습니다.",
                flush=True,
            )
        elif result["reply"].strip():
            store.append_exchange(
                args.visitor,
                args.character,
                profile["scenario_version"],
                message,
                result["reply"],
            )
        if args.message is not None:
            print(
                json.dumps(
                    {
                        "scope": scope,
                        "seconds": result["total_seconds"],
                        "finish_reason": result["finish_reason"],
                    },
                    ensure_ascii=False,
                )
            )
            break


if __name__ == "__main__":
    main()
