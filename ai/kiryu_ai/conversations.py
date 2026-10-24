"""Authored development diagnostics using actual model replies across turns.

These public synthetic scenarios are not a sealed evaluation set or official
game dialogue. Rubrics are separate from inputs, and no response is auto-scored.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
from datetime import UTC, datetime
from pathlib import Path

from .data import digest, load_profiles
from .runtime import assemble_input, load_scenario_facts
from .session import SessionStore

# Only incoming user messages belong in scenarios. No target assistant turns.
SCENARIOS = (
    {
        "scenario_id": "majima-library",
        "character_id": "majima",
        "user_turns": [
            "형님, 오늘 네 시에 도서관 앞에서 뵙겠습니다.",
            "사정이 생겨서 다섯 시로 바꿔도 되겠습니까?",
            "장소는 도서관이 아니라 역 앞입니다. 시간은 방금 바꾼 그대로입니다.",
            "그럼 제가 언제 어디로 가면 됩니까?",
        ],
    },
    {
        "scenario_id": "majima-bags",
        "character_id": "majima",
        "user_turns": [
            "검은 가방은 제 것이고 회색 가방은 형님 것입니다.",
            "검은 가방에 파란 우산을 넣었습니다. 회색 가방은 비어 있습니다.",
            "우산을 검은 가방에서 꺼내 문 옆 선반으로 옮겼습니다.",
            "제 가방은 어느 것이고 우산은 지금 어디에 있습니까?",
        ],
    },
    {
        "scenario_id": "majima-envelope",
        "character_id": "majima",
        "user_turns": [
            "처음 보는 봉투를 주웠는데 누구 것인지 아십니까?",
            "겉에는 이름이 없고 주소도 없습니다.",
            "찾는 사람이 나타났습니다. 봉투 안에 자기 공연 입장권이 있다고 합니다.",
            "그 말만 믿고 바로 줘도 되겠습니까?",
        ],
    },
    {
        "scenario_id": "haruka-bookshop",
        "character_id": "haruka",
        "user_turns": [
            "하루카, 내일 오전 열 시에 서점 앞에서 만나자.",
            "오전에는 일이 생겼다. 오후 한 시로 바꾸자.",
            "서점은 문을 닫는구나. 시간은 그대로 두고 빵집 앞에서 보자.",
            "마지막으로 정한 시간과 장소가 어떻게 됐지?",
        ],
    },
    {
        "scenario_id": "haruka-notebooks",
        "character_id": "haruka",
        "user_turns": [
            "초록 공책은 네 것이고 노란 공책은 내 것이다.",
            "초록 공책 안에 버스 표를 넣어뒀다. 노란 공책에는 아무것도 없다.",
            "표만 꺼내서 식탁 위 상자에 옮겼다. 공책은 그대로 뒀다.",
            "네 공책은 무슨 색이고 표는 지금 어디에 있지?",
        ],
    },
    {
        "scenario_id": "haruka-package",
        "character_id": "haruka",
        "user_turns": [
            "현관에 상자가 하나 있는데 누가 보낸 건지 아니?",
            "배송 표시가 지워져서 보낸 사람은 아직 모르겠다.",
            "방금 가게에서 연락이 왔다. 내가 주문한 컵을 보냈다고 하더구나.",
            "이 상자가 그 컵이라고 확실히 말할 수 있나?",
        ],
    },
)


# Reviewer-only guidance. The inference assembler never receives this mapping.
RUBRICS = {
    "majima-library": [
        "새 약속의 네 시·도서관을 이해하되 실제 예약을 했다고 주장하지 않는다.",
        "제안된 다섯 시 변경을 이해한다. 거절했다면 이후 답에서 실제 거절 이력을 반영한다.",
        "역 앞이라는 최신 장소를 반영하고 시간을 임의로 새로 정하지 않는다.",
        "사용자가 제안한 최신 조건은 다섯 시·역 앞이다. 실제 이전 응답에서 변경을 거절했다면 그 충돌을 설명한다.",
    ],
    "majima-bags": [
        "검은 가방은 키류, 회색 가방은 마지마 소유임을 구분한다.",
        "파란 우산의 당시 위치는 검은 가방이고 회색 가방은 비어 있음을 이해한다.",
        "우산의 최신 위치를 문 옆 선반으로 갱신한다.",
        "키류의 가방은 검은색, 우산은 문 옆 선반으로 답한다.",
    ],
    "majima-envelope": [
        "제공되지 않은 봉투 주인의 이름이나 정체를 만들어내지 않는다.",
        "주인을 단정하지 않고 확인할 수 있는 정보를 묻거나 안전한 확인 방법을 제시한다.",
        "상대의 주장은 새 정보이나 소유권이 검증됐다고 과장하지 않는다.",
        "주장만으로 소유자를 확정하지 않으며 적절한 확인을 제안한다.",
    ],
    "haruka-bookshop": [
        "내일 오전 열 시·서점 앞이라는 약속을 이해한다.",
        "오후 한 시라는 최신 시간 정정을 반영한다.",
        "최신 장소는 빵집 앞이며 시간은 오후 한 시로 유지한다.",
        "최신 조건인 내일 오후 한 시·빵집 앞을 반영한다. 실제 생성 이력의 갈등도 숨기지 않는다.",
    ],
    "haruka-notebooks": [
        "초록 공책은 하루카, 노란 공책은 키류 소유임을 구분한다.",
        "버스 표의 당시 위치는 초록 공책이라고 이해한다.",
        "표만 식탁 위 상자로 옮겼고 공책의 소유권은 바뀌지 않았음을 이해한다.",
        "하루카의 공책은 초록색, 표의 최신 위치는 식탁 위 상자라고 답한다.",
    ],
    "haruka-package": [
        "발송자 정보가 없으므로 구체적인 이름이나 물품을 단정하지 않는다.",
        "발송자를 계속 모르는 상태를 유지하고 근거 없이 아는 척하지 않는다.",
        "가게가 컵을 보냈다는 연락을 반영하되 현관 상자와 동일하다고 확정하지 않는다.",
        "같은 배송인지 아직 확인되지 않았음을 설명하고 송장·주문 정보 등으로 확인을 제안한다.",
    ],
}


def _validate_scenario(profile, scenario):
    if scenario.get("character_id") not in {"majima", "haruka"}:
        raise ValueError("Only majima and haruka are active diagnostics")
    if scenario["character_id"] != profile.get("character_id"):
        raise ValueError("Scenario and profile characters differ")
    sid = scenario.get("scenario_id")
    if not isinstance(sid, str) or not sid:
        raise ValueError("scenario_id must be a nonempty string")
    turns = scenario.get("user_turns")
    if not isinstance(turns, list) or not 4 <= len(turns) <= 6:
        raise ValueError("Each diagnostic must have four to six incoming turns")
    if any(not isinstance(turn, str) or not turn.strip() for turn in turns):
        raise ValueError("Incoming turns must be nonempty strings, not target messages")
    if (
        "scenario_version" in scenario
        and scenario["scenario_version"] != profile["scenario_version"]
    ):
        raise ValueError("Scenario and profile versions differ")


def conversation_turns(
    profile,
    scenario,
    generate,
    *,
    store=None,
    facts=(),
    memory=(),
    allowed_fact_ids=(),
    seed=42,
    max_tokens=128,
    temperature=0.7,
    top_p=0.8,
    top_k=20,
):
    """Yield observed turns; generate is compatible with LocalModel.reply.

    A failed/incomplete response aborts this conversation, with remaining turns
    explicitly skipped. It is never replaced by an authored reference answer.
    """
    _validate_scenario(profile, scenario)
    if store is None:
        store = SessionStore()
    sid = scenario["scenario_id"]
    visitor = scenario.get("visitor_id", "diagnostic:" + sid)
    blocked = False
    for index, incoming in enumerate(scenario["user_turns"], 1):
        identity = {
            "sample_id": f"{sid}::turn-{index:02d}",
            "scenario_id": sid,
            "turn": index,
            "visitor_id": visitor,
            "character_id": profile["character_id"],
            "scenario_version": profile["scenario_version"],
            "profile_sha256": digest(profile),
            "user_message": incoming,
            "review_status": "pending",
            "fan_review": "pending",
        }
        if blocked:
            yield {
                **identity,
                "status": "skipped",
                "reason": "previous_generation_incomplete",
            }
            continue
        messages, scope = assemble_input(
            profile,
            store,
            visitor,
            incoming,
            known_context=scenario.get("known_context", ""),
            facts=facts,
            memory=memory,
            allowed_fact_ids=allowed_fact_ids,
        )
        audit = {
            **identity,
            "messages": json.loads(json.dumps(messages)),
            "input_sha256": digest(messages),
            "scope": scope,
            "fact_ids": scope["fact_ids"],
            "generation_seed": seed + index - 1,
        }
        try:
            result = generate(
                messages,
                seed=seed + index - 1,
                max_tokens=max_tokens,
                temperature=temperature,
                top_p=top_p,
                top_k=top_k,
            )
            if not isinstance(result, dict):
                raise TypeError(
                    "Generator must return the LocalModel.reply result object"
                )
            text = result.get("reply")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("Generator returned no nonempty reply")
            if result.get("finish_reason") != "stop":
                blocked = True
                yield {
                    **result,
                    **audit,
                    "status": "incomplete",
                    "stored_in_history": False,
                }
                continue
            store.append_exchange(
                visitor,
                profile["character_id"],
                profile["scenario_version"],
                incoming,
                text,
            )
            yield {**result, **audit, "status": "ok", "stored_in_history": True}
        except (ValueError, RuntimeError, KeyError, TypeError) as error:
            blocked = True
            yield {
                **audit,
                "status": "error",
                "stored_in_history": False,
                "error": f"{type(error).__name__}: {error}",
            }


def execute(args, *, model_factory=None):
    """Load one model for the complete suite; a factory enables CPU-only tests."""
    root, output = Path(args.data_root), Path(args.output)
    profiles = load_profiles(root / "data/profiles.json")
    registry, facts = load_scenario_facts(root)
    active = set(registry.get("active_characters", ["majima", "haruka"]))
    if active != {"majima", "haruka"}:
        raise ValueError("Diagnostic scope is exactly majima and haruka")
    for cid in active:
        if profiles[cid]["scenario_version"] != registry["scenario_version"]:
            raise ValueError("Profile and fact registry scenario versions differ")
    names = ("turns.jsonl", "private-rubric.jsonl", "manifest.json", "summary.json")
    output.mkdir(parents=True, exist_ok=True)
    if any((output / name).exists() for name in names):
        raise FileExistsError("Refusing to overwrite conversation evidence")
    for scenario in SCENARIOS:
        _validate_scenario(profiles[scenario["character_id"]], scenario)
    artifacts = {"injected_test_engine": model_factory is not None}
    if model_factory is None:
        from .inference import LocalModel, artifact_hashes
        from .models import sha256

        model_factory = LocalModel
        artifacts.update(
            {
                "model_files": artifact_hashes(args.model),
                "adapter_files": artifact_hashes(args.adapter)
                if args.adapter
                else None,
                "serialization_sha256": sha256(Path(__file__).with_name("masking.py")),
                "inference_sha256": sha256(Path(__file__).with_name("inference.py")),
            }
        )
    engine = model_factory(args.model, args.adapter)
    manifest = {
        **artifacts,
        "started_at": datetime.now(UTC).isoformat(),
        "purpose": "authored, public development diagnostics; not sealed final evaluation",
        "model": args.model,
        "adapter": args.adapter,
        "model_load_seconds": engine.load_seconds,
        "loading_included_in_request_latency": False,
        "executor": "one process, one loaded model, sequential conversations; fresh KV cache per request",
        "platform": platform.platform(),
        "python": platform.python_version(),
        "scenario_sha256": digest(SCENARIOS),
        "rubric_sha256": digest(RUBRICS),
        "profiles_sha256": digest(profiles),
        "fact_registry_sha256": digest(registry),
        "code_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "generation_seed_base": args.seed,
        "facts_enabled": not args.no_facts,
        "scenario_count": len(SCENARIOS),
        "expected_turns": sum(len(scenario["user_turns"]) for scenario in SCENARIOS),
        "automatic_quality_verdict": None,
        "fan_review": "pending",
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    with (output / "private-rubric.jsonl").open("x") as handle:
        for scenario in SCENARIOS:
            for index, behavior in enumerate(RUBRICS[scenario["scenario_id"]], 1):
                handle.write(
                    json.dumps(
                        {
                            "sample_id": f"{scenario['scenario_id']}::turn-{index:02d}",
                            "expected_behavior": behavior,
                            "review_status": "pending",
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
    store = SessionStore()
    counts = {"ok": 0, "error": 0, "incomplete": 0, "skipped": 0}
    allowed = (
        [] if args.no_facts else [rule["id"] for rule in registry["adopted_facts"]]
    )
    with (output / "turns.jsonl").open("x") as handle:
        offset = 0
        for scenario in SCENARIOS:
            for row in conversation_turns(
                profiles[scenario["character_id"]],
                scenario,
                engine.reply,
                store=store,
                facts=facts,
                allowed_fact_ids=allowed,
                seed=args.seed + offset,
                max_tokens=args.max_tokens,
                temperature=args.temperature,
                top_p=args.top_p,
                top_k=args.top_k,
            ):
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
                handle.flush()
                counts[row["status"]] += 1
            offset += len(scenario["user_turns"])
    summary = {
        "turns": counts,
        "execution_complete": counts["ok"] == manifest["expected_turns"],
        "automatic_quality_verdict": None,
        "fan_review": "pending",
    }
    (output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
    )
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--adapter")
    parser.add_argument("--output", required=True)
    parser.add_argument("--no-facts", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--top-p", type=float, default=0.8)
    parser.add_argument("--top-k", type=int, default=20)
    args = parser.parse_args()
    if args.max_tokens < 1:
        parser.error("max-tokens must be positive")
    summary = execute(args)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not summary["execution_complete"]:
        raise SystemExit(
            "Conversation execution incomplete; inspect the recorded turns"
        )


if __name__ == "__main__":
    main()
