"""Validated, provenance-preserving exports for local character experiments.

Corpus and review artifacts are supplied explicitly; no private data is bundled.
The same message assembler is used for training and local inference.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

ALLOWED_CHARACTERS = frozenset(
    {
        "majima",
        "haruka",
        "nishiki",
        "date",
        "daigo",
        "mine",
        "saejima",
        "akiyama",
        "yuki",
    }
)


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()


def read_jsonl(path: str | Path) -> list[dict]:
    rows = []
    for line_number, line in enumerate(Path(path).read_text().splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise TypeError(f"{path}:{line_number}: expected object")
        rows.append(row)
    return rows


def _text(value: Any, field: str, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ValueError(
            f"{field} must be a {'possibly empty ' if allow_empty else ''}string"
        )
    if "\x00" in value:
        raise ValueError(f"{field} contains NUL")
    return value


def load_profiles(path: str | Path) -> dict[str, dict]:
    records = json.loads(Path(path).read_text())
    if not isinstance(records, list):
        raise TypeError("profiles must be a list")
    result = {}
    for profile in records:
        cid = profile.get("character_id")
        if cid not in ALLOWED_CHARACTERS or cid in result:
            raise ValueError("unknown or duplicate character profile")
        _text(profile.get("system_prompt"), "system_prompt")
        _text(profile.get("scenario_version"), "scenario_version")
        result[cid] = profile
    return result


def _context_items(items: list[dict] | None, kind: str) -> list[str]:
    if items is None:
        return []
    if not isinstance(items, list):
        raise TypeError(f"{kind} must be a list")
    result = []
    for item in items:
        if not isinstance(item, dict):
            raise TypeError(f"{kind} item must be an object")
        text = item.get("textKo", item.get("text", item.get("content")))
        result.append(_text(text, f"{kind}.text"))
    return result


def build_messages(
    profile: dict,
    known_context: str,
    history: list[dict],
    user_message: str,
    facts: list[dict] | None = None,
    memory: list[dict] | None = None,
) -> list[dict[str, str]]:
    """Assemble visible inputs only. Scope filtering belongs to the caller.

    Evidence/review labels, target replies and hidden emotions are never accepted
    by this interface. Input dictionaries are not mutated or retained.
    """
    system = _text(profile.get("system_prompt"), "system_prompt")
    context = _text(known_context, "known_context", allow_empty=True)
    if not isinstance(history, list) or len(history) % 2:
        raise ValueError("history must contain complete user/assistant pairs")
    clean_history = []
    for index, message in enumerate(history):
        expected_role = "user" if index % 2 == 0 else "assistant"
        if not isinstance(message, dict) or message.get("role") != expected_role:
            raise ValueError("history roles must alternate user/assistant")
        clean_history.append(
            {
                "role": expected_role,
                "content": _text(message.get("content"), "history.content"),
            }
        )
    sections = []
    if context:
        sections.append("현재 답변 전에 공유된 상황:\n" + context)
    for label, records in (
        ("이 인물에게 허용된 근거 사실", _context_items(facts, "facts")),
        ("이 방문자와의 확인된 기억", _context_items(memory, "memory")),
    ):
        if records:
            sections.append(
                label + ":\n" + "\n".join("- " + value for value in records)
            )
    if sections:
        system += "\n\n" + "\n\n".join(sections)
    return (
        [{"role": "system", "content": system}]
        + clean_history
        + [{"role": "user", "content": _text(user_message, "user_message")}]
    )


def validate_corpus(rows: list[dict], profiles: dict[str, dict]) -> dict:
    if not rows:
        raise ValueError("empty corpus")
    seen_ids: set[str] = set()
    groups: dict[str, str] = {}
    payloads: dict[str, str] = {}
    counts: Counter = Counter()
    history_counts: Counter = Counter()
    categories: Counter = Counter()
    for row in rows:
        sample_id = _text(row.get("sample_id"), "sample_id")
        if sample_id in seen_ids:
            raise ValueError(f"duplicate sample_id: {sample_id}")
        seen_ids.add(sample_id)
        cid = row.get("character_id")
        if cid not in profiles:
            raise ValueError(f"unknown character: {cid}")
        if row.get("scenario_version") != profiles[cid]["scenario_version"]:
            raise ValueError(f"profile version mismatch: {sample_id}")
        split = row.get("split")
        if split not in {"train", "dev"}:
            raise ValueError("only train/dev records may enter the training export")
        group = _text(row.get("group_id"), "group_id")
        if group in groups and groups[group] != split:
            raise ValueError(f"group crosses splits: {group}")
        groups[group] = split
        if (
            row.get("generation_kind") != "authored_if"
            or row.get("official_quote") is not False
        ):
            raise ValueError(
                "this exporter requires explicitly authored IF, not unverified quotations"
            )
        _text(row.get("author"), "author")
        refs = row.get("source_refs")
        if (
            not isinstance(refs, list)
            or not refs
            or any(not isinstance(x, str) or not x for x in refs)
        ):
            raise ValueError(f"missing provenance: {sample_id}")
        target = _text(row.get("target_response"), "target_response")
        if not re.search("[가-힣]", target):
            raise ValueError(f"target is not Korean: {sample_id}")
        messages = build_messages(
            profiles[cid],
            row.get("known_context", ""),
            row.get("history"),
            row.get("user_message"),
        )
        payload = digest({"messages": messages, "target": target})
        if payload in payloads:
            raise ValueError(
                f"duplicate dialogue payload: {sample_id} / {payloads[payload]}"
            )
        payloads[payload] = sample_id
        counts[f"{cid}:{split}"] += 1
        categories[f"{cid}:{split}:{row.get('category', 'unspecified')}"] += 1
        if row["history"]:
            history_counts[f"{cid}:{split}"] += 1
    return {
        "samples": len(rows),
        "counts": dict(sorted(counts.items())),
        "with_history": dict(sorted(history_counts.items())),
        "categories": dict(sorted(categories.items())),
        "groups": len(groups),
        "source_kind": "authored_if",
        "original_game_dialogue_count": 0,
    }


def _approved(
    rows: list[dict], reviews: list[dict], profiles: dict, profiles_file_sha256: str
) -> None:
    by_id = {}
    for review in reviews:
        sid = review.get("sample_id")
        if sid in by_id:
            raise ValueError(f"duplicate review: {sid}")
        by_id[sid] = review
    for row in rows:
        sid = row["sample_id"]
        review = by_id.get(sid)
        if not review or review.get("verdict") != "pass":
            raise ValueError(f"independent review missing: {sid}")
        reviewer = _text(review.get("reviewer"), "reviewer")
        if reviewer == row["author"]:
            raise ValueError(f"self-review cannot approve: {sid}")
        if review.get("sha256") != digest(row):
            raise ValueError(f"review hash is stale: {sid}")
        if review.get("profiles_file_sha256") != profiles_file_sha256 or review.get(
            "character_profile_sha256"
        ) != digest(profiles[row["character_id"]]):
            raise ValueError(f"review profile hash is stale: {sid}")
        _text(review.get("basis"), "review basis")


def export_dataset(
    samples_path: str | Path,
    profiles_path: str | Path,
    reviews_path: str | Path,
    output: str | Path,
    characters: list[str] | None = None,
) -> dict:
    profiles = load_profiles(profiles_path)
    all_rows = read_jsonl(samples_path)
    report = validate_corpus(all_rows, profiles)
    selected = set(characters or {row["character_id"] for row in all_rows})
    if not selected <= profiles.keys():
        raise ValueError("requested unknown character")
    rows = [row for row in all_rows if row["character_id"] in selected]
    if not rows or not any(row["split"] == "train" for row in rows):
        raise ValueError("selection has no training records")
    _approved(
        rows,
        read_jsonl(reviews_path),
        profiles,
        hashlib.sha256(Path(profiles_path).read_bytes()).hexdigest(),
    )
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    manifest = {
        "schemaVersion": 1,
        "corpus": report,
        "selectedCharacters": sorted(selected),
        "sourceFiles": {},
        "files": {},
        "fanReview": "pending",
        "purpose": "agent-reviewed local experiment; not fan-approved production data",
    }
    for name, value in (
        ("samples", samples_path),
        ("profiles", profiles_path),
        ("reviews", reviews_path),
    ):
        manifest["sourceFiles"][name] = {
            "path": str(Path(value).resolve()),
            "sha256": hashlib.sha256(Path(value).read_bytes()).hexdigest(),
        }
    provenance = []
    for source_split, filename in (("train", "train.jsonl"), ("dev", "valid.jsonl")):
        exported = []
        for row in rows:
            if row["split"] != source_split:
                continue
            messages = build_messages(
                profiles[row["character_id"]],
                row["known_context"],
                row["history"],
                row["user_message"],
            )
            messages.append({"role": "assistant", "content": row["target_response"]})
            exported.append(
                {
                    "sample_id": row["sample_id"],
                    "sampleId": row["sample_id"],
                    "messages": messages,
                }
            )
            provenance.append(
                {
                    "sample_id": row["sample_id"],
                    "source_sha256": digest(row),
                    "group_id": row["group_id"],
                    "generation_kind": row["generation_kind"],
                    "source_refs": row["source_refs"],
                    "split": source_split,
                }
            )
        encoded = "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in exported)
        (output / filename).write_text(encoded)
        manifest["files"][filename] = {
            "rows": len(exported),
            "sha256": hashlib.sha256(encoded.encode()).hexdigest(),
        }
    encoded_provenance = "".join(
        json.dumps(x, ensure_ascii=False) + "\n" for x in provenance
    )
    (output / "provenance.jsonl").write_text(encoded_provenance)
    manifest["files"]["provenance.jsonl"] = {
        "rows": len(provenance),
        "sha256": hashlib.sha256(encoded_provenance.encode()).hexdigest(),
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", required=True)
    parser.add_argument("--profiles", required=True)
    parser.add_argument("--reviews")
    parser.add_argument("--output")
    parser.add_argument("--characters", nargs="+")
    args = parser.parse_args()
    if args.output:
        if not args.reviews:
            parser.error("--output requires --reviews")
        result = export_dataset(
            args.samples, args.profiles, args.reviews, args.output, args.characters
        )
    else:
        result = validate_corpus(read_jsonl(args.samples), load_profiles(args.profiles))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
