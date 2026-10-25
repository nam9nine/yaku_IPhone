"""Release reviewed quotations without relabelling them as authored phone SMS.

No source/review files are bundled. A release preserves unreviewed/held/rejected
records as distinct dispositions and never mutates the original candidates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from copy import deepcopy
from pathlib import Path

from .community_inputs import prepare_inputs, prepare_sms_inputs
from .data import digest, load_profiles, read_jsonl
from .masking import validate_messages


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def index(rows: list[dict], field: str) -> dict[str, dict]:
    result = {}
    for row in rows:
        key = row.get(field)
        if not isinstance(key, str) or not key or key in result:
            raise ValueError(f"missing/duplicate {field}")
        result[key] = row
    return result


def required_text(row: dict, field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"missing {field}")
    return value


def review_basis(review: dict) -> str:
    value = review.get("basis")
    if (
        isinstance(value, list)
        and value
        and all(isinstance(x, str) and x.strip() for x in value)
    ):
        return "\n".join(value)
    return required_text(review, "basis")


def validate_review_sources(reviews: list[dict], documents: list[dict]) -> None:
    """Resolve review citations against the immutable source, not just a URL."""
    sources = index(documents, "source_id")
    for review in reviews:
        refs = review.get("source_refs", []) + review.get("period_scope", {}).get(
            "evidence_refs", []
        )
        if not refs:
            raise ValueError("review must cite source evidence")
        for ref in refs:
            if not isinstance(ref, dict) or ref.get("source_id") not in sources:
                raise ValueError("review citation refers to unknown source")
            doc = sources[ref["source_id"]]
            expected = hashlib.sha256(doc["text"].encode()).hexdigest()
            supplied = ref.get("source_sha256", ref.get("source_text_sha256"))
            if supplied != expected or doc["text_sha256"] != expected:
                raise ValueError("review citation source checksum mismatch")
            lines = doc["text"].splitlines(keepends=True)
            start, end = ref.get("line_start"), ref.get("line_end")
            if (
                type(start) is not int
                or type(end) is not int
                or not 0 <= start < end <= len(lines)
            ):
                raise ValueError("review citation has invalid line span")
            raw = "".join(lines[start:end])
            if "char_start" in ref or "char_end" in ref:
                first = sum(map(len, lines[:start]))
                last = first + len(raw)
                if (
                    type(ref.get("char_start")) is not int
                    or type(ref.get("char_end")) is not int
                    or (ref["char_start"], ref["char_end"]) != (first, last)
                ):
                    raise ValueError(
                        "review citation character and line spans disagree"
                    )
            if "text_raw" in ref and ref["text_raw"] != raw:
                raise ValueError("review citation text differs from source span")


def canonical_messages(row: dict, review: dict) -> list[dict]:
    """Expose only bounded source metadata, never review prose or future turns."""
    scope = review.get("game_scope", {})
    if scope.get("game") != row.get("game") or scope.get("edition") != row.get(
        "edition"
    ):
        raise ValueError("reviewed game/translation edition differs from candidate")
    period = review.get("period_scope", {})
    if period.get("status") not in {"unresolved", "source_stated"}:
        raise ValueError("unknown period evidence status")
    value, status = None, "unresolved"
    if period["status"] == "source_stated":
        candidate = required_text(period, "value")
        # A later statement is review evidence, not prior knowledge at this turn.
        prior = [
            ref
            for ref in period.get("evidence_refs", [])
            if ref.get("source_id") == row["source_id"]
            and ref.get("source_text_sha256") == row["source_sha256"]
            and isinstance(ref.get("line_start"), int)
            and isinstance(ref.get("line_end"), int)
            and 0
            <= ref["line_start"]
            < ref["line_end"]
            <= row["target_source_span"]["line_start"]
        ]
        if prior:
            value, status = candidate, "source_stated"
    messages = deepcopy(row["messages"])
    visible = json.loads(messages[-2]["content"])
    visible["source_context"] = {
        "game": row["game"],
        "translation_edition": row["edition"],
        "period": {"value": value, "status": status},
    }
    messages[-2]["content"] = json.dumps(visible, ensure_ascii=False)
    return messages


def release_canonical(candidates: list[dict], reviews: list[dict]) -> dict:
    candidates_by_id = index(candidates, "sample_id")
    reviews_by_id = index(reviews, "sample_id")
    if not reviews_by_id.keys() <= candidates_by_id.keys():
        raise ValueError("review refers to unknown candidate")
    groups = {}
    outputs = {"train": [], "dev": [], "test": []}
    dispositions, provenance = [], []
    for sid, row in candidates_by_id.items():
        if row.get("task_kind") != "canonical_dialogue_continuation":
            raise ValueError("canonical release requires original transcript task")
        if row.get("generation_kind") != "fan_translation":
            raise ValueError(
                "this release does not verify official localization or OCR"
            )
        if row.get("official_korean_quote_verified") is not False:
            raise ValueError("fan translation cannot become official localization")
        if row.get("source_reconstruction_verified") is not True:
            raise ValueError("source reconstruction must precede semantic release")
        if (
            row.get("recipient_ids") != []
            or row.get("recipient_status") != "unresolved"
        ):
            raise ValueError("canonical release must not invent an addressee")
        split, group = row.get("split"), required_text(row, "split_group")
        if split not in outputs or (group in groups and groups[group] != split):
            raise ValueError("invalid or leaking source group split")
        groups[group] = split
        validate_messages(row["messages"], final_role="assistant")
        if row["messages"][-1]["content"] != row["target_response"]:
            raise ValueError("canonical answer changed")
        visible = json.loads(row["messages"][-2]["content"])
        expected = [
            {"speaker_id": t["speaker_id"], "text": t["text"]}
            for t in row["history_turns"]
        ]
        observed = [
            {"speaker_id": t["speaker_id"], "text": t["text"]}
            for t in visible["transcript"]
        ]
        if (
            observed != expected
            or visible["target_speaker"]["speaker_id"] != row["character_id"]
        ):
            raise ValueError("canonical speaker/history changed")
        review = reviews_by_id.get(sid)
        state = "unreviewed"
        reason = "No semantic review supplied."
        if review:
            if review.get("canonical_row_sha256") != digest(row):
                raise ValueError(f"stale candidate review: {sid}")
            if review.get("source_text_sha256") != row["source_sha256"]:
                raise ValueError(f"stale source review: {sid}")
            reviewer = required_text(review, "reviewer")
            if (
                reviewer == row.get("author")
                or review.get("reviewer_is_author") is True
            ):
                raise ValueError("self approval is not permitted")
            reason = review_basis(review)
            if not review.get("source_refs"):
                raise ValueError("review must cite source evidence")
            if (
                review.get("fan_reviewed") is not False
                or review.get("official_localization_verified") is not False
            ):
                raise ValueError("agent review is not fan/localization approval")
            verdict = review.get("verdict")
            if verdict not in {"approve", "hold", "reject"}:
                raise ValueError("unknown semantic review verdict")
            state = {
                "approve": "approved_canonical_experiment",
                "hold": "reviewed_hold",
                "reject": "rejected",
            }[verdict]
            if verdict == "approve":
                if review.get("approved_task") != row["task_kind"]:
                    raise ValueError("approval is for a different task")
                if review.get("review_type") != "agent_source_semantic":
                    raise ValueError("semantic source review is required")
                if review.get("recipient_status") != "unresolved":
                    raise ValueError("review changed unresolved recipient")
                messages = canonical_messages(row, review)
                outputs[split].append({"sample_id": sid, "messages": messages})
                provenance.append(
                    {
                        "sample_id": sid,
                        "task_kind": row["task_kind"],
                        "character_id": row["character_id"],
                        "quote_origin": "source_verified_korean_fan_translation",
                        "split": split,
                        "split_group": group,
                        "canonical_event_group": row["canonical_event_group"],
                        "source_id": row["source_id"],
                        "source_url": row["source_url"],
                        "source_sha256": row["source_sha256"],
                        "candidate_sha256": digest(row),
                        "review_sha256": digest(review),
                        "reviewer": reviewer,
                        "exported_messages_sha256": digest(messages),
                        "source_context": json.loads(messages[-2]["content"])[
                            "source_context"
                        ],
                        "period_scope": review.get("period_scope"),
                        "game_scope": review.get("game_scope"),
                        "recipient_status": "unresolved",
                        "runtime_sms_aligned": False,
                        "approval_scope": "offline_canonical_experiment",
                        "fan_reviewed": False,
                    }
                )
        dispositions.append(
            {
                "sample_id": sid,
                "candidate_sha256": digest(row),
                "state": state,
                "reason": reason,
                "review_sha256": digest(review) if review else None,
            }
        )
    counts = dict(Counter(r["state"] for r in dispositions))
    return {
        "splits": outputs,
        "dispositions": dispositions,
        "provenance": provenance,
        "report": {
            "candidates": len(candidates),
            "dispositions": counts,
            "all_semantically_reviewed": counts.get("unreviewed", 0) == 0,
            "export_counts": {k: len(v) for k, v in outputs.items()},
            "test_is_training": False,
            "fan_approved": False,
            "runtime_sms_aligned": False,
        },
    }


def ocr_dispositions(images: list[dict], reviews: list[dict]) -> list[dict]:
    """Account for every image while distinguishing inspection from triage."""
    originals = index(images, "image_sha256")
    reviewed = index(reviews, "image_sha256")
    if not reviewed.keys() <= originals.keys():
        raise ValueError("unknown reviewed image")
    result = []
    for key, image in originals.items():
        review = reviewed.get(key)
        row = {
            "image_sha256": key,
            "image_record_sha256": digest(image),
            "state": "unreviewed",
            "training_eligible": False,
        }
        if review:
            if review.get("image_record_sha256") != digest(image):
                raise ValueError("stale OCR image review")
            required_text(review, "reviewer")
            required_text(review, "basis")
            if review.get("human_reviewed") is not False:
                raise ValueError("agent inspection must not claim human review")
            if review.get("state") not in {
                "reviewed_hold",
                "rejected",
                "reference_only",
                "verified_quote",
            }:
                raise ValueError("OCR inspection alone does not approve SFT")
            if review["state"] == "verified_quote":
                if (
                    review.get("source_language") != "ko"
                    or review.get("speaker_evidence_kind") != "explicit_nameplate"
                ):
                    raise ValueError(
                        "verified quote requires Korean text and visible speaker evidence"
                    )
                required_text(review, "speaker_id")
                required_text(review, "corrected_text")
                if not review.get("evidence_refs"):
                    raise ValueError("missing direct visual evidence")
            row.update(
                state=review["state"],
                review_sha256=digest(review),
                reviewer=review["reviewer"],
                basis=review["basis"],
            )
        result.append(row)
    return result


def release_sms(
    rows: list[dict],
    reviews: list[dict],
    canonical: list[dict],
    canonical_approvals: list[dict],
    profiles: dict,
    profiles_hash: str,
) -> dict:
    """Approve authored IF separately, binding the original independent review."""
    converted = prepare_sms_inputs(rows, canonical, profiles)["sms-messages"]
    originals = index(rows, "sample_id")
    review_index = index(reviews, "sample_id")
    parents = index(canonical, "sample_id")
    approved_parents = set()
    for approval in canonical_approvals:
        pid = approval.get("sample_id")
        if (
            pid not in parents
            or approval.get("approval_scope") != "offline_canonical_experiment"
            or approval.get("task_kind") != "canonical_dialogue_continuation"
            or approval.get("candidate_sha256") != digest(parents[pid])
        ):
            raise ValueError("invalid or stale canonical parent approval")
        approved_parents.add(pid)
    if originals.keys() != review_index.keys():
        raise ValueError("every authored SMS requires exactly one review")
    splits = {"train": [], "dev": [], "test": []}
    provenance = []
    for row in converted:
        sid = row["sample_id"]
        original, review = originals[sid], review_index[sid]
        if review.get("sha256") != digest(original):
            raise ValueError("stale authored SMS review")
        if review.get("profiles_file_sha256") != profiles_hash or review.get(
            "character_profile_sha256"
        ) != digest(profiles[row["character_id"]]):
            raise ValueError("stale authored SMS profile review")
        reviewer = required_text(review, "reviewer")
        if (
            reviewer == row["author"]
            or review.get("independent_of_sms_author") is not True
        ):
            raise ValueError("SMS author cannot independently approve own output")
        if (
            review.get("fan_reviewed") is not False
            or review.get("verdict") != "agent_review_pass"
        ):
            raise ValueError(
                "experimental SMS requires an agent review, not a fabricated fan approval"
            )
        review_basis(review)
        parent_ids = row["parent_sample_ids"]
        if not set(parent_ids) <= approved_parents:
            raise ValueError("SMS parent is not in the approved canonical release")
        if review.get("parent_candidate_sha256") != {
            pid: parents[pid]["candidate_sha256"] for pid in parent_ids
        }:
            raise ValueError("stale SMS parent review")
        splits[row["split"]].append({"sample_id": sid, "messages": row["messages"]})
        provenance.append(
            {
                "sample_id": sid,
                "character_id": row["character_id"],
                "split": row["split"],
                "split_group": row["group_id"],
                "task_kind": "authored_if_sms",
                "quote_origin": "newly_authored_if_not_game_quote",
                "sample_sha256": digest(original),
                "review_sha256": digest(review),
                "exported_messages_sha256": digest(row["messages"]),
                "character_profile_sha256": row["character_profile_sha256"],
                "parent_sample_ids": parent_ids,
                "reviewer": reviewer,
                "approval_scope": "offline_sms_experiment",
                "fan_reviewed": False,
            }
        )
    return {
        "splits": splits,
        "provenance": provenance,
        "independent_event_groups": len({r["split_group"] for r in provenance}),
        "standalone_quality_evaluation_ready": bool(splits["dev"] and splits["test"]),
    }


def export_canonical(
    candidates_path: Path,
    reviews_path: Path,
    output: Path,
    documents_path: Path,
    prepared_dir: Path,
    sms_path: Path | None = None,
    sms_reviews_path: Path | None = None,
    profiles_path: Path | None = None,
) -> dict:
    sources = [candidates_path, reviews_path, documents_path] + [
        prepared_dir / name
        for name in (
            "sft-candidates.jsonl",
            "normalized-turns.jsonl",
            "split-groups.jsonl",
        )
    ]
    reconstructed = prepare_inputs(*[read_jsonl(p) for p in sources[2:]])[
        "canonical-messages"
    ]
    candidates = read_jsonl(candidates_path)
    if index(candidates, "sample_id") != index(reconstructed, "sample_id"):
        raise ValueError(
            "release candidates do not reconstruct from original documents"
        )
    reviews = read_jsonl(reviews_path)
    validate_review_sources(reviews, read_jsonl(documents_path))
    result = release_canonical(candidates, reviews)
    optional = (sms_path, sms_reviews_path, profiles_path)
    if any(p is not None for p in optional) and not all(
        p is not None for p in optional
    ):
        raise ValueError("SMS, SMS reviews and profiles must be supplied together")
    sms = None
    if sms_path is not None:
        sms = release_sms(
            read_jsonl(sms_path),
            read_jsonl(sms_reviews_path),
            candidates,
            result["provenance"],
            load_profiles(profiles_path),
            file_hash(profiles_path),
        )
        sources.extend(optional)
    output.mkdir(parents=True, exist_ok=False)
    files = {}
    names = {
        "train": "canonical/train.jsonl",
        "dev": "canonical/valid.jsonl",
        "test": "evaluation/canonical-test.jsonl",
    }
    for name, rows in [
        (names[split], rows) for split, rows in result["splits"].items()
    ] + [
        ("training-provenance.jsonl", result["provenance"]),
        ("dispositions.jsonl", result["dispositions"]),
    ]:
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
        )
        files[name] = file_hash(path)
    manifest = {
        "schema_version": 1,
        **result["report"],
        "files": files,
        "source_files": {str(p.resolve()): file_hash(p) for p in sources},
        "code_sha256": file_hash(Path(__file__)),
        "purpose": "agent-reviewed canonical experiment; held-out test file is never training input",
    }
    if sms is not None:
        for split, rows in sms["splits"].items():
            # Keep empty evaluation partitions explicit; never duplicate train as validation.
            relative = {
                "train": "authored-sms/train.jsonl",
                "dev": "authored-sms/valid.jsonl",
                "test": "evaluation/authored-sms-test.jsonl",
            }[split]
            path = output / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
            )
            files[relative] = file_hash(path)
        path = output / "sms-provenance.jsonl"
        path.write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in sms["provenance"])
        )
        files[path.name] = file_hash(path)
        manifest["authored_sms"] = {
            "counts": {k: len(v) for k, v in sms["splits"].items()},
            "independent_event_groups": sms["independent_event_groups"],
            "standalone_quality_evaluation_ready": sms[
                "standalone_quality_evaluation_ready"
            ],
            "official_game_quotes": False,
        }
    (output / "release-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidates", required=True, type=Path)
    parser.add_argument("--reviews", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--documents", required=True, type=Path)
    parser.add_argument("--prepared", required=True, type=Path)
    parser.add_argument("--sms", type=Path)
    parser.add_argument("--sms-reviews", type=Path)
    parser.add_argument("--profiles", type=Path)
    args = parser.parse_args()
    print(
        json.dumps(
            export_canonical(
                args.candidates,
                args.reviews,
                args.output,
                args.documents,
                args.prepared,
                args.sms,
                args.sms_reviews,
                args.profiles,
            ),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
