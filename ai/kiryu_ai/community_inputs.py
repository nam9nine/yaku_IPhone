"""Create auditable model-input candidates without granting training approval.

Canonical continuations retain the actual transcript speakers. Authored SMS
adaptations use the existing runtime assembler, but require separate lineage
and semantic review; neither output is an approved training dataset.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from copy import deepcopy
from pathlib import Path

from .community import prepare, sha256, stable_hash
from .data import build_messages, load_profiles, validate_corpus
from .masking import validate_messages

CANONICAL_SYSTEM = (
    "원문 대화 이어쓰기 과제입니다. 사용자 메시지의 transcript는 실제 사용자의 "
    "문자가 아니라 여러 등장인물의 이전 발화 기록입니다. 각 speaker_id와 "
    "speaker_label을 유지해 읽고 target_speaker가 이어서 하는 발화만 답하세요. "
    "기록의 발화자를 모두 키류로 간주하지 마세요. 직전 발화자가 답변 수신인으로 "
    "확정된 것은 아닙니다. 기록에 없는 미래 사건이나 다른 인물의 다음 발화를 "
    "추가하지 마세요. 인물 이름표나 해설 없이 발화 내용만 출력하세요."
)
SPAN_FIELDS = (
    "turn_id",
    "source_id",
    "source_sha256",
    "source_path",
    "scene_id",
    "run_id",
    "line_start",
    "line_end",
    "char_start",
    "char_end",
    "text_raw",
    "speaker_id",
    "speaker_label_raw",
)


def _index(rows: list[dict], key: str) -> dict[str, dict]:
    result = {}
    for row in rows:
        value = row.get(key)
        if not isinstance(value, str) or not value.strip() or value in result:
            raise ValueError(f"missing or duplicate {key}: {value}")
        result[value] = row
    return result


def _without(row: dict, *keys: str) -> dict:
    return {key: value for key, value in row.items() if key not in keys}


def _strings(value, name: str) -> list[str]:
    if (
        not isinstance(value, list)
        or not value
        or any(not isinstance(x, str) or not x.strip() for x in value)
        or len(set(value)) != len(value)
    ):
        raise ValueError(f"{name} must contain unique nonempty strings")
    return value


def prepare_inputs(
    documents: list[dict],
    candidates: list[dict],
    turns: list[dict],
    split_groups: list[dict],
) -> dict:
    """Reconstruct inputs from hashed documents; preserve the frozen split map.

    Re-running the deterministic parser checks speaker assignments, exact raw
    spans, complete preceding windows, target eligibility and event grouping.
    Only split *assignment* is read from the already frozen map; this function
    neither reseeds nor reassigns it. Candidate subsets are allowed.
    """
    if not candidates:
        raise ValueError("empty candidate input")
    expected = prepare(documents)
    supplied_groups = _index(split_groups, "split_group")
    expected_groups = _index(expected["split-groups"], "split_group")
    if supplied_groups.keys() != expected_groups.keys():
        raise ValueError("split groups do not reconstruct from source documents")
    for gid, group in supplied_groups.items():
        if group.get("split") not in {"train", "dev", "test"}:
            raise ValueError(f"invalid frozen split: {gid}")
        if _without(group, "split") != _without(expected_groups[gid], "split"):
            raise ValueError(f"source/event split membership mismatch: {gid}")

    supplied_turns = _index(turns, "turn_id")
    expected_turns = _index(expected["normalized-turns"], "turn_id")
    if supplied_turns.keys() != expected_turns.keys():
        raise ValueError("normalized turns do not reconstruct from source documents")
    for tid, turn in supplied_turns.items():
        regenerated = expected_turns[tid]
        if _without(turn, "split") != _without(regenerated, "split"):
            raise ValueError(f"source/speaker/span reconstruction mismatch: {tid}")
        if turn["split"] != supplied_groups[turn["split_group"]]["split"]:
            raise ValueError(f"turn split differs from frozen group: {tid}")

    expected_candidates = _index(expected["sft-candidates"], "sample_id")
    _index(candidates, "sample_id")
    rows = []
    for candidate in candidates:
        sid = candidate["sample_id"]
        expected_candidate = expected_candidates.get(sid)
        if expected_candidate is None or _without(candidate, "split") != _without(
            expected_candidate, "split"
        ):
            raise ValueError(f"candidate source/history/target mismatch: {sid}")
        if candidate["split"] != supplied_groups[candidate["split_group"]]["split"]:
            raise ValueError(f"candidate split differs from frozen group: {sid}")

        history = [supplied_turns[t["turn_id"]] for t in candidate["history_turns"]]
        target = supplied_turns[candidate["target_turn_id"]]
        transcript = [
            {
                "speaker_id": turn["speaker_id"],
                "speaker_label": turn["speaker_label_raw"],
                "text": turn["text_clean"],
            }
            for turn in history
        ]
        visible = {
            "task": "canonical_dialogue_continuation",
            "target_speaker": {
                "speaker_id": target["speaker_id"],
                "speaker_label": target["speaker_label_raw"],
            },
            "transcript": transcript,
        }
        messages = [
            {"role": "system", "content": CANONICAL_SYSTEM},
            {"role": "user", "content": json.dumps(visible, ensure_ascii=False)},
            {"role": "assistant", "content": candidate["target_response"]},
        ]
        validate_messages(messages, final_role="assistant")
        participants = sorted({turn["speaker_id"] for turn in history + [target]})
        rows.append(
            {
                **deepcopy(candidate),
                "schema_version": 1,
                "task_kind": "canonical_dialogue_continuation",
                "messages": messages,
                "candidate_sha256": stable_hash(candidate),
                "recipient_status": "unresolved",
                "immediate_previous_speaker": history[-1]["speaker_id"],
                "history_participant_ids": sorted({t["speaker_id"] for t in history}),
                "participant_ids": participants,
                "multi_party_history": len(participants) > 2,
                "speaker_policy": "preserve_individual_source_labels; unresolved or collective speakers are not assigned to individuals",
                "recipient_policy": "turn order does not establish addressee; recipient_ids remain empty",
                "history_source_spans": [
                    {field: t[field] for field in SPAN_FIELDS} for t in history
                ],
                "target_source_span": {field: target[field] for field in SPAN_FIELDS},
                "approval_status": "unapproved_input_candidate",
                "training_eligible": False,
                "runtime_input_aligned": False,
                "source_reconstruction_verified": True,
            }
        )
    return {
        "canonical-messages": rows,
        "report": {
            "schema_version": 1,
            "canonical_candidates": len(rows),
            "counts": dict(
                sorted(
                    Counter(f"{r['character_id']}:{r['split']}" for r in rows).items()
                )
            ),
            "multi_party_candidates": sum(r["multi_party_history"] for r in rows),
            "recipient_confirmed": 0,
            "source_documents_reconstructed": len(documents),
            "source_reconstruction_verified": True,
            "frozen_split_preserved": True,
            "training_approved": 0,
            "runtime_input_aligned": False,
            "limitations": [
                "Source extraction fidelity is not translation, canonical truth, recipient or fan approval.",
                "Canonical continuation is a different task from the Kiryu-phone SMS runtime.",
                "Crowd, collective and unresolved speaker lines are held by the source parser, never attributed to a single character.",
                "The supplied frozen split map is preserved, not independently authenticated as an earlier release.",
                "No model training, generation or semantic approval is performed by this exporter.",
            ],
        },
    }


def validate_sms_adaptations(
    rows: list[dict], canonical_rows: list[dict], profiles: dict[str, dict]
) -> dict:
    """Validate lineage and runtime input structure, not authored reply quality.

    All SMS answers must be newly authored. Input-only paraphrases with quoted
    targets need a mixed-origin contract and are deliberately unsupported here.
    """
    report = validate_corpus(rows, profiles)
    canonical = _index(canonical_rows, "sample_id")
    for row in rows:
        sid = row["sample_id"]
        parents = _strings(row.get("parent_sample_ids"), "parent_sample_ids")
        if any(parent not in canonical for parent in parents):
            raise ValueError(f"unknown SMS parent: {sid}")
        source_rows = [canonical[parent] for parent in parents]
        cid = row["character_id"]
        if any(parent["character_id"] != cid for parent in source_rows):
            raise ValueError(f"SMS parent character differs: {sid}")
        groups = {parent["split_group"] for parent in source_rows}
        splits = {parent["split"] for parent in source_rows}
        events = {parent["canonical_event_group"] for parent in source_rows}
        if groups != {row["group_id"]} or splits != {row["split"]}:
            raise ValueError(f"SMS changes or crosses parent split/group: {sid}")
        if events != {row.get("canonical_event_group")}:
            raise ValueError(f"SMS changes or crosses parent canonical event: {sid}")
        hashes = {
            parent["sample_id"]: parent["source_sha256"] for parent in source_rows
        }
        if row.get("parent_source_sha256") != hashes:
            raise ValueError(f"SMS parent source hash differs: {sid}")
        if any(
            parent["source_url"] not in row["source_refs"] for parent in source_rows
        ):
            raise ValueError(f"SMS source_refs omit a parent source URL: {sid}")
        if row.get("facts") or row.get("memory"):
            raise ValueError(
                f"SMS exporter does not accept unassembled facts/memory: {sid}"
            )
        previous = sorted(
            {parent["immediate_previous_speaker"] for parent in source_rows}
        )
        expected_relationship = {
            "target_character_id": cid,
            "immediate_previous_speaker_ids": previous,
            "recipient_status": "unresolved",
        }
        if row.get("source_relationship") != expected_relationship:
            raise ValueError(f"SMS source relationship is not evidenced: {sid}")
        if row.get("adapted_relationship") != {
            "sender_id": "kiryu",
            "recipient_id": cid,
        }:
            raise ValueError(f"SMS relationship differs from phone runtime: {sid}")
        if row.get("adaptation_kind") not in {
            "authored_sms_adaptation",
            "authored_relationship_adaptation",
        }:
            raise ValueError(f"SMS requires an explicitly authored adaptation: {sid}")
        if row["adaptation_kind"] == "authored_sms_adaptation" and any(
            parent["immediate_previous_speaker"] != "kiryu"
            or not set(parent["history_participant_ids"]) <= {cid, "kiryu"}
            for parent in source_rows
        ):
            raise ValueError(f"SMS needs explicit relationship adaptation: {sid}")
        if any(
            row["target_response"] == parent["target_response"]
            for parent in source_rows
        ):
            raise ValueError(
                f"SMS authored answer cannot be an unchanged parent quotation: {sid}"
            )
        _strings(row.get("changed_elements"), "changed_elements")
        _strings(row.get("visible_information_basis"), "visible_information_basis")
        if (
            row.get("training_eligible") is not False
            or row.get("fan_reviewed") is not False
        ):
            raise ValueError(
                f"SMS input conversion cannot claim training/fan approval: {sid}"
            )
        messages = build_messages(
            profiles[cid], row["known_context"], row["history"], row["user_message"]
        ) + [{"role": "assistant", "content": row["target_response"]}]
        validate_messages(messages, final_role="assistant")
    return {
        **report,
        "lineage_validated": True,
        "training_approved": 0,
        "semantic_review": "not_performed",
    }


def prepare_sms_inputs(
    rows: list[dict], canonical_rows: list[dict], profiles: dict[str, dict]
) -> dict:
    report = validate_sms_adaptations(rows, canonical_rows, profiles)
    converted = []
    for row in rows:
        profile = profiles[row["character_id"]]
        converted.append(
            {
                **deepcopy(row),
                "task_kind": "authored_if_sms",
                "messages": build_messages(
                    profile, row["known_context"], row["history"], row["user_message"]
                )
                + [{"role": "assistant", "content": row["target_response"]}],
                "candidate_sha256": stable_hash(row),
                "character_profile_sha256": stable_hash(profile),
                "approval_status": "unapproved_input_candidate",
                "runtime_input_aligned": True,
            }
        )
    return {"sms-messages": converted, "report": report}


def _read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def export_inputs(
    documents_path: Path,
    prepared_dir: Path,
    output_dir: Path,
    sms_path: Path | None = None,
    profiles_path: Path | None = None,
) -> dict:
    if output_dir.exists():
        raise ValueError(
            "output directory already exists; previous evidence is immutable"
        )
    if (sms_path is None) != (profiles_path is None):
        raise ValueError("--sms and --profiles must be provided together")
    sources = {
        "documents": documents_path,
        "candidates": prepared_dir / "sft-candidates.jsonl",
        "turns": prepared_dir / "normalized-turns.jsonl",
        "split_groups": prepared_dir / "split-groups.jsonl",
    }
    result = prepare_inputs(
        *[
            _read_jsonl(sources[key])
            for key in ("documents", "candidates", "turns", "split_groups")
        ]
    )
    canonical = result["canonical-messages"]
    outputs = {"canonical-messages": canonical}
    for split in ("train", "dev", "test"):
        outputs[f"canonical-{split}-messages"] = [
            r for r in canonical if r["split"] == split
        ]
    if sms_path is not None:
        sms = prepare_sms_inputs(
            _read_jsonl(sms_path), canonical, load_profiles(profiles_path)
        )
        outputs["sms-messages"] = sms["sms-messages"]
        result["report"]["sms"] = sms["report"]
        sources.update(sms=sms_path, profiles=profiles_path)
    manifest = {
        "schema_version": 1,
        "purpose": "unapproved model-input candidates; not a training or fan approval",
        "source_files": {
            key: {"path": str(path.resolve()), "sha256": sha256(path.read_bytes())}
            for key, path in sources.items()
        },
        "code_sha256": {
            name: sha256(Path(__file__).with_name(name).read_bytes())
            for name in ("community_inputs.py", "community.py", "data.py", "masking.py")
        },
        "training_approved": 0,
        "token_audit": "not_performed_by_exporter",
        "files": {},
    }
    output_dir.mkdir(parents=True, exist_ok=False)
    for name, rows in outputs.items():
        data = "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows
        ).encode()
        filename = name + ".jsonl"
        (output_dir / filename).write_bytes(data)
        manifest["files"][filename] = {"rows": len(rows), "sha256": sha256(data)}
    report_bytes = (
        json.dumps(result["report"], ensure_ascii=False, sort_keys=True, indent=2)
        + "\n"
    ).encode()
    (output_dir / "report.json").write_bytes(report_bytes)
    manifest["files"]["report.json"] = {"sha256": sha256(report_bytes)}
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    )
    return result["report"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--documents", required=True, type=Path)
    parser.add_argument("--prepared", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--sms", type=Path)
    parser.add_argument("--profiles", type=Path)
    args = parser.parse_args()
    print(
        json.dumps(
            export_inputs(
                args.documents, args.prepared, args.output, args.sms, args.profiles
            ),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
