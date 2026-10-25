"""Offline, provenance-preserving preparation of community dialogue for review.

This module never exports an approved training set or assigns a recipient. In
particular, original dialogue is not converted to the authored-IF contract.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

TARGETS = frozenset({"majima", "haruka", "kiryu"})
ALIASES = {
    "마지마": "majima",
    "마지마 고로": "majima",
    "키류": "kiryu",
    "키류 카즈마": "kiryu",
    "하루카": "haruka",
    "사와무라 하루카": "haruka",
    "사에지마": "saejima",
    "사에지마 타이가": "saejima",
    "다테": "date",
    "다테 마코토": "date",
    "다이고": "daigo",
    "도지마 다이고": "daigo",
    "미네": "mine",
    "니시다": "nishida",
    "아키야마": "akiyama",
    "유미": "yumi",
    "니시키": "nishiki",
    "니시키야마": "nishiki",
    "리키야": "rikiya",
    "카스가": "ichiban",
    "이치반": "ichiban",
    "카시와기": "kashiwagi",
    "시마노": "shimano",
    "테라다": "terada",
    "신지": "shinji",
    "유우야": "yuya",
    "카즈키": "kazuki",
    "사야마": "sayama",
    "유키": "yuki",
    "아몬": "amon",
    "아몬 죠": "amon",
    "미나미다": "minamida",
    "이부키": "ibuki",
}
LABEL = r"[가-힣A-Za-z?？][가-힣A-Za-z0-9?？·ㆍ ,()（）.\-]{0,29}?"
INLINE = re.compile(r"^\s*(" + LABEL + r")\s*[:：]\s*(.*?)\s*$")
BARE_LABEL = re.compile(r"^\s*(" + LABEL + r")\s*$")
NON_SPEAKERS = frozenset(
    {
        "http",
        "https",
        "image",
        "ps",
        "p.s.",
        "출처",
        "참고",
        "주의",
        "번역",
        "역주",
        "주석",
        "대본",
        "문제",
        "메일제목",
        "메일 제목",
    }
)
HEADING = re.compile(
    r"^\s*(?:[-*# ]*(?:제\s*)?\d+\s*(?:화|장|편)(?:\s|$|[.:：])"
    r"|(?:19|20)\d{2}년|프롤로그|에필로그|[-=―─━]{3,}"
    r"|[【\[].*[】\]]\s*$)"
)
OPTION = re.compile(r"^\s*(?:<?\s*선택(?:지|문)|선택\s*[:：]|[①②③④⑤⑥■▶]|\d+[.)]\s)")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_hash(value: object) -> str:
    return sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
    )


def clean(text: str) -> str:
    """Only NFC and whitespace; preserve diction, punctuation and repetition."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip()


def _required_text(row: dict, key: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise ValueError(f"{key}: expected nonempty string without NUL")
    return value


def validate_documents(documents: list[dict]) -> list[dict]:
    if not documents:
        raise ValueError("empty document input")
    seen = set()
    for doc in documents:
        if not isinstance(doc, dict):
            raise TypeError("document must be an object")
        for key in (
            "source_id",
            "url",
            "title",
            "text",
            "text_sha256",
            "source_kind",
            "language",
            "canonical_event_group",
            "permission_status",
            "source_path",
        ):
            _required_text(doc, key)
        sid = doc["source_id"]
        if sid in seen:
            raise ValueError(f"duplicate source_id: {sid}")
        seen.add(sid)
        if sha256(doc["text"].encode()) != doc["text_sha256"]:
            raise ValueError(f"text SHA256 mismatch: {sid}")
        overrides = doc.get("speaker_overrides", {})
        if not isinstance(overrides, dict) or any(
            not isinstance(k, str)
            or not k.strip()
            or (v is not None and (not isinstance(v, str) or not v.strip()))
            for k, v in overrides.items()
        ):
            raise ValueError(f"invalid speaker_overrides: {sid}")
    return sorted(documents, key=lambda d: d["source_id"])


def _speaker(label: str, doc: dict) -> str | None:
    if label in doc.get("speaker_overrides", {}):
        return doc["speaker_overrides"][label]
    if label.casefold() in NON_SPEAKERS:
        return None
    return ALIASES.get(label)


def _next_nonblank(lines: list[str], start: int) -> int | None:
    for i in range(start, len(lines)):
        if lines[i].strip():
            return i
    return None


def _is_structural(lines: list[str], index: int, doc: dict) -> bool:
    value = lines[index].strip()
    if INLINE.fullmatch(value) or HEADING.match(value) or OPTION.match(value):
        return True
    if value.startswith(("프로필", "http://", "https://")):
        return True
    if _speaker(value, doc) is not None:
        following = _next_nonblank(lines, index + 1)
        return following is not None and lines[following].strip() in {":", "："}
    return False


def _labelled(lines: list[str], index: int, doc: dict):
    """Return label, utterance, exclusive end line; never attach continuations."""
    match = INLINE.fullmatch(lines[index].rstrip("\r\n"))
    if match:
        label, utterance = match.groups()
        label = clean(label)
        if utterance:
            return label, utterance, index + 1
        following = _next_nonblank(lines, index + 1)
        if following is not None:
            value = lines[following].strip()
            if not _is_structural(lines, following, doc):
                return label, value, following + 1
        return label, "", index + 1
    match = BARE_LABEL.fullmatch(lines[index].strip())
    if match and _speaker(clean(match.group(1)), doc) is not None:
        colon = _next_nonblank(lines, index + 1)
        if colon is not None and lines[colon].strip() in {":", "："}:
            following = _next_nonblank(lines, colon + 1)
            if following is not None:
                value = lines[following].strip()
                if not _is_structural(lines, following, doc):
                    return clean(match.group(1)), value, following + 1
    return None


def _utterance_kind(label: str, utterance: str, speaker: str | None) -> str:
    if not utterance:
        return "empty_label"
    if label.casefold() in NON_SPEAKERS:
        return "non_speaker_label"
    if speaker is None:
        return "unresolved_speaker"
    if utterance.startswith(("(", "（", "[", "【")):
        return "parenthetical_or_direction"
    if any(
        mark in utterance
        for mark in ("(", "（", "역주", "번역자 주", "편지:", "편지：")
    ):
        return "inline_annotation_or_quote_requires_review"
    if OPTION.match(utterance):
        return "choice_or_numbered_text"
    if re.search(r"\[IMAGE:\d+\]", utterance):
        return "image_pending"
    return "labelled_speech_candidate"


def parse_document(doc: dict) -> tuple[list[dict], list[dict], list[dict]]:
    lines = doc["text"].splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    blocks, turns, scenes = [], [], []
    current_blocks, current_turns = [], []
    scene_number = 0
    run = 0
    index = 0
    source_allowed = doc["source_kind"] == "fan_translation" and doc["language"] == "ko"

    def flush_scene():
        nonlocal current_blocks, current_turns, scene_number
        if not current_blocks:
            return
        scenes.append(
            {
                "scene_id": f"{doc['source_id']}:scene-{scene_number}",
                "source_id": doc["source_id"],
                "canonical_event_group": doc["canonical_event_group"],
                "block_ids": list(current_blocks),
                "turn_ids": list(current_turns),
                "boundary_status": "provisional_text_boundaries",
                "order_verified": False,
                "fan_reviewed": False,
                "training_eligible": False,
            }
        )
        scene_number += 1
        current_blocks, current_turns = [], []

    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue
        parsed = _labelled(lines, index, doc)
        if parsed:
            label, utterance, end = parsed
            speaker = _speaker(label, doc)
            kind = _utterance_kind(label, utterance, speaker)
        else:
            label, speaker, utterance, end = None, None, line.strip(), index + 1
            if re.search(r"\[IMAGE:\d+\]", utterance):
                kind = "image_pending"
            elif HEADING.match(utterance):
                kind = "section_boundary"
            elif OPTION.match(utterance):
                kind = "choice_or_numbered_text"
            else:
                kind = "unlabelled_text"
        if kind == "section_boundary":
            flush_scene()
        block_id = f"{doc['source_id']}:lines-{index}-{end}"
        block = {
            "block_id": block_id,
            "source_id": doc["source_id"],
            "source_url": doc["url"],
            "source_sha256": doc["text_sha256"],
            "source_path": doc["source_path"],
            "line_start": index,
            "line_end": end,
            "char_start": offsets[index],
            "char_end": offsets[end],
            "text_raw": "".join(lines[index:end]),
            "text_clean": clean(utterance),
            "speaker_label_raw": label,
            "speaker_id": speaker,
            "recipient_ids": [],
            "utterance_kind": kind,
            "scene_id": f"{doc['source_id']}:scene-{scene_number}",
            "source_kind": doc["source_kind"],
            "language": doc["language"],
            "translation_kind": "community_fan_translation_unverified",
            "permission_status": doc["permission_status"],
            "speaker_verified": False,
            "fan_reviewed": False,
            "training_eligible": False,
        }
        blocks.append(block)
        current_blocks.append(block_id)
        if kind == "labelled_speech_candidate" and source_allowed:
            turn = {
                **block,
                "turn_id": block_id,
                "run_id": f"{doc['source_id']}:run-{run}",
                "generation_kind": "fan_translation",
                "official_korean_quote_verified": False,
            }
            turns.append(turn)
            current_turns.append(turn["turn_id"])
        else:
            run += 1
        index = end
    flush_scene()
    # A labelled first line followed by unlabelled prose may be only the start
    # of a longer utterance. Retain it for review, not as a complete response.
    positions = {block["block_id"]: i for i, block in enumerate(blocks)}
    for turn_index, turn in enumerate(turns):
        following = positions[turn["block_id"]] + 1
        turn["quality_flags"] = ["source_beginning_and_ending_completeness_unverified"]
        if (
            following < len(blocks)
            and blocks[following]["utterance_kind"] == "unlabelled_text"
        ):
            turn["quality_flags"].append("possible_unlabelled_continuation")
        if turn_index + 1 < len(turns):
            next_turn = turns[turn_index + 1]
            if (
                next_turn["run_id"] == turn["run_id"]
                and next_turn["speaker_id"] == turn["speaker_id"]
            ):
                turn["quality_flags"].append("possible_labelled_continuation")
        if not any(character.isalnum() for character in turn["text_clean"]):
            turn["quality_flags"].append("nonlexical_response")
        blocks[positions[turn["block_id"]]]["quality_flags"] = list(
            turn["quality_flags"]
        )
    return blocks, turns, scenes


class _Groups:
    def __init__(self, sources):
        self.parent = {sid: sid for sid in sources}

    def find(self, item):
        if self.parent[item] != item:
            self.parent[item] = self.find(self.parent[item])
        return self.parent[item]

    def join(self, sources):
        roots = sorted({self.find(s) for s in sources})
        for root in roots[1:]:
            self.parent[root] = roots[0]


def _split(key: str, seed: str) -> str:
    bucket = int(stable_hash([seed, key])[:8], 16) % 100
    return "train" if bucket < 80 else "dev" if bucket < 90 else "test"


def prepare(documents: list[dict], seed: str = "community-v1") -> dict[str, object]:
    documents = validate_documents(documents)
    by_source = {d["source_id"]: d for d in documents}
    blocks, turns, scenes = [], [], []
    for doc in documents:
        b, t, s = parse_document(doc)
        blocks.extend(b)
        turns.extend(t)
        scenes.extend(s)
    groups = _Groups(by_source)
    duplicate_keys = defaultdict(set)
    for doc in documents:
        duplicate_keys[("canonical_event", doc["canonical_event_group"])].add(
            doc["source_id"]
        )
        duplicate_keys[("exact_body", doc["text_sha256"])].add(doc["source_id"])
    runs = defaultdict(list)
    interrupted = Counter()
    for turn in turns:
        run_id = turn["run_id"]
        if "possible_unlabelled_continuation" in turn["quality_flags"]:
            interrupted[run_id] += 1
            continue
        runs[(run_id, interrupted[run_id])].append(turn)
    for run in runs.values():
        for index in range(len(run) - 2):
            window = [
                (t["speaker_id"], t["text_clean"]) for t in run[index : index + 3]
            ]
            if sum(len(t[1]) for t in window) >= 80:
                duplicate_keys[("long_three_turn_sequence", stable_hash(window))].add(
                    run[index]["source_id"]
                )
    duplicate_groups = []
    for (reason, key), sources in sorted(duplicate_keys.items()):
        if len(sources) > 1:
            groups.join(sources)
            duplicate_groups.append(
                {"reason": reason, "key": key, "source_ids": sorted(sources)}
            )
    components = defaultdict(list)
    for sid in by_source:
        components[groups.find(sid)].append(sid)
    split_groups, source_splits = [], {}
    for members in sorted(components.values()):
        events = sorted({by_source[s]["canonical_event_group"] for s in members})
        key = "event-" + stable_hash(events)[:20]
        row = {
            "split_group": key,
            "split": _split(key, seed),
            "source_ids": sorted(members),
            "canonical_event_groups": events,
        }
        split_groups.append(row)
        for sid in members:
            source_splits[sid] = {"split_group": key, "split": row["split"]}
    for row in blocks + turns + scenes:
        row.update(source_splits[row["source_id"]])

    candidates, candidate_keys = [], {}
    held = []
    for block in blocks:
        doc = by_source[block["source_id"]]
        reasons = []
        if doc["source_kind"] != "fan_translation":
            reasons.append("source_kind_not_admitted")
        if doc["language"] != "ko":
            reasons.append("not_korean_style_data")
        if block["utterance_kind"] != "labelled_speech_candidate":
            reasons.append(block["utterance_kind"])
        if "possible_unlabelled_continuation" in block.get("quality_flags", []):
            reasons.append("possible_unlabelled_continuation")
        if reasons:
            held.append(
                {
                    "block_id": block["block_id"],
                    "source_id": doc["source_id"],
                    "reasons": reasons,
                    "training_eligible": False,
                }
            )
    for run in runs.values():
        for index, target in enumerate(run):
            if target["speaker_id"] not in TARGETS:
                continue
            target_reasons = [
                flag
                for flag in target["quality_flags"]
                if flag in {"possible_labelled_continuation", "nonlexical_response"}
            ]
            if index == 0 or run[index - 1]["speaker_id"] == target["speaker_id"]:
                target_reasons.append("no_immediately_preceding_other_speaker")
            if target_reasons:
                held.append(
                    {
                        "block_id": target["turn_id"],
                        "source_id": target["source_id"],
                        "reasons": target_reasons,
                        "training_eligible": False,
                    }
                )
                continue
            history = run[max(0, index - 6) : index]
            key = stable_hash(
                [(t["speaker_id"], t["text_clean"]) for t in history + [target]]
            )
            # Duplicate response windows are only collapsed within an event group.
            # A short reply appearing in unrelated scenes remains distinct.
            candidate_key = (target["split_group"], key)
            if candidate_key in candidate_keys:
                held.append(
                    {
                        "block_id": target["turn_id"],
                        "source_id": target["source_id"],
                        "reasons": ["exact_duplicate_response_window"],
                        "duplicate_of": candidate_keys[candidate_key],
                        "training_eligible": False,
                    }
                )
                continue
            sample_id = "candidate-" + stable_hash([target["turn_id"], key])[:24]
            candidate_keys[candidate_key] = sample_id
            source = by_source[target["source_id"]]
            candidates.append(
                {
                    "sample_id": sample_id,
                    "source_id": target["source_id"],
                    "source_url": target["source_url"],
                    "source_sha256": target["source_sha256"],
                    "character_id": target["speaker_id"],
                    "recipient_ids": [],
                    "scene_id": target["scene_id"],
                    "run_id": target["run_id"],
                    "split_group": target["split_group"],
                    "split": target["split"],
                    "generation_kind": "fan_translation",
                    "official_korean_quote_verified": False,
                    "canonical_event_group": source["canonical_event_group"],
                    "game": source.get("game"),
                    "edition": source.get("edition"),
                    "period": source.get("period"),
                    "permission_status": source["permission_status"],
                    "history_turns": [
                        {
                            "turn_id": t["turn_id"],
                            "speaker_id": t["speaker_id"],
                            "text": t["text_clean"],
                        }
                        for t in history
                    ],
                    "target_turn_id": target["turn_id"],
                    "target_response": target["text_clean"],
                    "eligibility_reasons": [
                        "speaker_and_scene_review_required",
                        "recipient_unknown",
                        "translation_provenance_review_required",
                        "fan_evaluation_pending",
                        "runtime_input_adaptation_not_performed",
                        "source_beginning_and_ending_completeness_unverified",
                    ],
                    "training_eligible": False,
                    "fan_reviewed": False,
                }
            )
    by_block = {b["block_id"]: b for b in blocks}
    rag = []
    for scene in scenes:
        doc = by_source[scene["source_id"]]
        if doc["source_kind"] != "fan_translation":
            continue
        evidence = [by_block[k] for k in scene["block_ids"]]
        if not any(
            block["speaker_label_raw"] is not None
            and block["utterance_kind"]
            not in {
                "non_speaker_label",
                "empty_label",
                "image_pending",
                "choice_or_numbered_text",
            }
            for block in evidence
        ):
            continue
        rag.append(
            {
                "id": "evidence-" + stable_hash(scene["scene_id"])[:24],
                "source_id": doc["source_id"],
                "source_url": doc["url"],
                "source_sha256": doc["text_sha256"],
                "source_scene_id": scene["scene_id"],
                "canonical_event_group": doc["canonical_event_group"],
                "split_group": scene["split_group"],
                "split": scene["split"],
                "game": doc.get("game"),
                "edition": doc.get("edition"),
                "period": doc.get("period"),
                "language": doc["language"],
                "evidence_block_ids": scene["block_ids"],
                "evidence_turn_ids": scene["turn_ids"],
                "text": "\n".join(b["text_raw"].rstrip("\r\n") for b in evidence),
                "kind": "unreviewed_transcript_evidence_not_fact_summary",
                "known_by": [],
                "scenario_adopted": False,
                "approved": False,
                "fan_reviewed": False,
                "training_eligible": False,
            }
        )
    counts = Counter(t["speaker_id"] for t in turns if t["speaker_id"] in TARGETS)
    report = {
        "schema_version": 1,
        "seed": seed,
        "documents": len(documents),
        "normalized_blocks": len(blocks),
        "speech_turns": len(turns),
        "target_speech_turns": dict(sorted(counts.items())),
        "sft_candidates": len(candidates),
        "sft_candidates_by_character": dict(
            sorted(Counter(c["character_id"] for c in candidates).items())
        ),
        "rag_evidence_candidates": len(rag),
        "held_records": len(held),
        "held_reasons": dict(
            sorted(Counter(r for h in held for r in h["reasons"]).items())
        ),
        "split_groups": len(split_groups),
        "duplicate_groups": len(duplicate_groups),
        "source_documents_by_kind": dict(
            sorted(Counter(d["source_kind"] for d in documents).items())
        ),
        "training_rows_exported": 0,
        "training_approved": 0,
        "limitations": [
            "Only text order is preserved; canonical scene/speaker/recipient verification is pending.",
            "Unlabelled lines break response context and are never attached to a preceding speaker.",
            "RAG chunks are unapproved source evidence, not factual summaries or runtime knowledge.",
            "No image OCR or translation correction is performed.",
            "Same-event assignments depend on the supplied provenance catalog; unknown related events can remain.",
            "Test/dev splits are provisional source groups, not the sealed project evaluation set.",
        ],
    }
    return {
        "normalized-blocks": blocks,
        "normalized-turns": turns,
        "scene-candidates": scenes,
        "sft-candidates": candidates,
        "rag-candidates": rag,
        "held": held,
        "duplicate-groups": duplicate_groups,
        "split-groups": split_groups,
        "report": report,
    }


def export(input_path: Path, output_path: Path, seed: str = "community-v1") -> dict:
    """Do not overwrite previous evidence or an existing training directory."""
    if output_path.exists() and any(output_path.iterdir()):
        raise ValueError("output directory must be empty")
    raw = input_path.read_bytes()
    documents = [json.loads(line) for line in raw.decode().splitlines() if line.strip()]
    result = prepare(documents, seed)
    result["report"]["input_sha256"] = sha256(raw)
    result["report"]["code_sha256"] = sha256(Path(__file__).read_bytes())
    output_path.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name, rows in result.items():
        if name == "report":
            continue
        data = "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows
        ).encode()
        (output_path / f"{name}.jsonl").write_bytes(data)
        hashes[f"{name}.jsonl"] = sha256(data)
    (output_path / "report.json").write_text(
        json.dumps(result["report"], ensure_ascii=False, sort_keys=True, indent=2)
        + "\n"
    )
    hashes["report.json"] = sha256((output_path / "report.json").read_bytes())
    (output_path / "checksums.json").write_text(
        json.dumps(hashes, sort_keys=True, indent=2) + "\n"
    )
    return result["report"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--seed", default="community-v1")
    args = parser.parse_args()
    print(
        json.dumps(
            export(args.input, args.output, args.seed), ensure_ascii=False, indent=2
        )
    )


if __name__ == "__main__":
    main()
