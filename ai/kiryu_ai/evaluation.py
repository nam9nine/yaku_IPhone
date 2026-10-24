"""Prepare fixed-input experiments and report observations without automatic judging.

Only development cases are accepted here. Final holdouts require a separate,
explicit release. All generated files belong in the private local data directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from collections import defaultdict
from pathlib import Path

from .data import build_messages, digest, load_profiles, read_jsonl
from .session import filter_knowledge


def _index(rows, field="sample_id"):
    result = {}
    for row in rows:
        key = row.get(field)
        if not isinstance(key, str) or not key or key in result:
            raise ValueError(f"Missing or duplicate {field}: {key!r}")
        result[key] = row
    return result


def _file_sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _write_json(path, value):
    with Path(path).open("x") as handle:
        handle.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def _write_jsonl(path, rows):
    with Path(path).open("x") as handle:
        handle.writelines(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)


def prepare(cases_path, profiles_path, knowledge_path, scenario_path, output):
    profiles = load_profiles(profiles_path)
    cases = read_jsonl(cases_path)
    _index(cases)
    source_facts = _index(read_jsonl(knowledge_path), "id")
    scenario = json.loads(Path(scenario_path).read_text())
    active = set(scenario.get("active_characters", ["majima", "haruka"]))
    if active != {"majima", "haruka"}:
        raise ValueError("This pilot requires exactly majima and haruka")
    rules = _index(scenario["adopted_facts"], "id")
    facts = []
    for fid, rule in rules.items():
        if fid not in source_facts:
            raise ValueError(f"Scenario fact has no source: {fid}")
        known_by = rule.get("known_by")
        if not isinstance(known_by, list) or any(
            cid not in profiles for cid in known_by
        ):
            raise ValueError(f"Invalid explicit known_by: {fid}")
        facts.append({**source_facts[fid], "known_by": list(known_by)})
    requests, keys = [], []
    for case in cases:
        if case.get("split") != "dev":
            raise ValueError(
                "Only dev cases may be prepared; do not open final holdouts"
            )
        if case.get("category") not in METRICS:
            raise ValueError("Evaluation case has no supported scoring category")
        cid = case.get("character_id")
        if cid not in active:
            continue
        profile = profiles[cid]
        version = scenario["scenario_version"]
        if (
            case.get("scenario_version") != version
            or profile["scenario_version"] != version
        ):
            raise ValueError(f"Scenario version mismatch: {case['sample_id']}")
        selected = filter_knowledge(facts, cid, rules.keys())
        for condition in ("facts-off", "facts-on"):
            visible = selected if condition == "facts-on" else []
            messages = build_messages(
                profile,
                case.get("known_context", ""),
                case["history"],
                case["user_message"],
                facts=visible,
            )
            sid = case["sample_id"] + "::" + condition
            request = {
                "sample_id": sid,
                "character_id": cid,
                "scenario_version": version,
                "condition": condition,
                "messages": messages,
                "input_sha256": digest(messages),
                "profile_sha256": digest(profile),
                "fact_ids": [fact["id"] for fact in visible],
            }
            requests.append(request)
            keys.append(
                {
                    "sample_id": sid,
                    "source_sample_id": case["sample_id"],
                    "source_sha256": digest(case),
                    "character_id": cid,
                    "condition": condition,
                    "category": case.get("category"),
                    "pair_id": case.get("pair_id"),
                    "pair_condition": case.get("condition"),
                    "expected_behavior": case.get("expected_behavior"),
                    "reference_response": case.get("target_response"),
                    "input_sha256": request["input_sha256"],
                    "profile_sha256": request["profile_sha256"],
                    "fact_ids": request["fact_ids"],
                    "known_context_present_in_both_conditions": bool(
                        case.get("known_context")
                    ),
                    "review_status": "pending",
                }
            )
    if not requests:
        raise ValueError("No active-character development cases")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    names = ["requests.jsonl", "private-key.jsonl", "manifest.json"]
    if any((output / name).exists() for name in names):
        raise FileExistsError("Refusing to overwrite prepared evaluation evidence")
    _write_jsonl(output / names[0], requests)
    _write_jsonl(output / names[1], keys)
    manifest = {
        "schema_version": 1,
        "split": "dev",
        "requests": len(requests),
        "characters": sorted(active),
        "model_conditions": ["base", "trained"],
        "fact_conditions": ["facts-off", "facts-on"],
        "sources": {
            name: _file_sha(path)
            for name, path in (
                ("cases", cases_path),
                ("profiles", profiles_path),
                ("knowledge", knowledge_path),
                ("scenario", scenario_path),
            )
        },
        "requests_sha256": _file_sha(output / names[0]),
        "private_key_sha256": _file_sha(output / names[1]),
        "interpretation": (
            "Fixed extra facts, not a live retriever. Known context and history remain "
            "identical across fact conditions. Existing factual cases may already provide "
            "their answer in known_context; facts-off is not necessarily closed-book."
        ),
        "fan_review": "pending",
        "automatic_quality_verdict": None,
    }
    _write_json(output / names[2], manifest)
    return manifest


def distribution(values):
    values = sorted(
        float(x)
        for x in values
        if isinstance(x, (int, float))
        and not isinstance(x, bool)
        and math.isfinite(x)
        and x >= 0
    )
    if not values:
        return {"n": 0, "p50": None, "p95": None}

    def percentile(q):
        index = (len(values) - 1) * q
        lower = math.floor(index)
        return values[lower] + (values[math.ceil(index)] - values[lower]) * (
            index - lower
        )

    return {
        "n": len(values),
        "p50": percentile(0.5),
        "p95": percentile(0.95),
        "min": values[0],
        "max": values[-1],
        "quantile_method": "linear interpolation (type 7)",
        "small_sample_tail_warning": len(values) < 20,
    }


def latency_summary(rows, manifest=None):
    _index(rows)
    ok = [row for row in rows if row.get("status") == "ok"]
    if any(row.get("status") not in {"ok", "error"} for row in rows):
        raise ValueError("Each execution must have an explicit ok/error status")
    manifest = manifest or {}
    return {
        "executed_requests": len(rows),
        "successful_requests": len(ok),
        "errors": len(rows) - len(ok),
        "length_limited_responses": sum(
            row.get("finish_reason") == "length" for row in ok
        ),
        "executor": manifest.get("executor", "unrecorded"),
        "burst": manifest.get("burst"),
        "loading_included_in_request_latency": manifest.get(
            "loading_included_in_request_latency"
        ),
        "model_load_seconds": manifest.get("model_load_seconds"),
        "prompt_cache_modes": sorted(
            {row.get("prompt_cache", "unrecorded") for row in ok}
        ),
        "ttft_service_seconds": distribution([row.get("ttft_seconds") for row in ok]),
        "first_text_service_seconds": distribution(
            [row.get("first_text_seconds") for row in ok]
        ),
        "first_text_queue_inclusive_seconds": distribution(
            [
                row["queue_seconds"] + row["first_text_seconds"]
                for row in ok
                if isinstance(row.get("queue_seconds"), (int, float))
                and isinstance(row.get("first_text_seconds"), (int, float))
            ]
        ),
        "ttft_queue_inclusive_seconds": distribution(
            [
                row["queue_seconds"] + row["ttft_seconds"]
                for row in ok
                if isinstance(row.get("queue_seconds"), (int, float))
                and isinstance(row.get("ttft_seconds"), (int, float))
            ]
        ),
        "service_seconds": distribution([row.get("total_seconds") for row in ok]),
        "queue_seconds": distribution([row.get("queue_seconds") for row in ok]),
        "arrival_to_finish_seconds": distribution(
            [row.get("arrival_to_finish_seconds") for row in ok]
        ),
        "actual_prompt_tokens": distribution([row.get("prompt_tokens") for row in ok]),
        "actual_generation_tokens": distribution(
            [row.get("generation_tokens") for row in ok]
        ),
        "automatic_quality_verdict": None,
    }


METRICS = {
    "context_pair": "context_correct",
    "provided_fact": "fact_correct",
    "allowed_lore": "fact_correct",
    "unknown": "unknown_correct",
    "boundary": "boundary_correct",
}


def quality_summary(results, key_rows, judgments=()):
    observed, keys = _index(results), _index(key_rows)
    if not observed.keys() <= keys.keys():
        raise ValueError("Execution contains unknown evaluation IDs")
    for sid, row in observed.items():
        for field in ("character_id", "condition"):
            if row.get(field) != keys[sid].get(field):
                raise ValueError(f"Execution/key {field} mismatch: {sid}")
        for field in ("input_sha256", "profile_sha256"):
            if field in row and row[field] != keys[sid].get(field):
                raise ValueError(f"Execution/key {field} mismatch: {sid}")
    reviews = {}
    for review in judgments:
        sid, kind = review.get("sample_id"), review.get("reviewer_kind")
        if sid not in observed or kind not in {"independent_agent", "fan"}:
            raise ValueError(
                "Judgment must name an executed ID and explicit reviewer kind"
            )
        if not review.get("reviewer") or not review.get("basis"):
            raise ValueError("Judgments require reviewer identity and a concrete basis")
        if review.get("result_sha256") != digest(observed[sid]):
            raise ValueError(f"Stale or missing result hash: {sid}")
        if (sid, kind) in reviews:
            raise ValueError("Duplicate reviewer-kind judgment for the same response")
        for field in set(METRICS.values()):
            if field in review and type(review[field]) is not bool:
                raise ValueError(f"{field} must be a literal boolean")
        score = review.get("style_score")
        if score is not None and (
            type(score) not in (int, float) or not 1 <= score <= 5
        ):
            raise ValueError("style_score must be between 1 and 5")
        if observed[sid].get("status") != "ok":
            raise ValueError(
                "Failed generation cannot receive a response quality judgment"
            )
        reviews[sid, kind] = review
    groups = defaultdict(list)
    for sid, key in keys.items():
        groups[key["character_id"], key["condition"]].append(sid)
    report = {}
    for (cid, condition), ids in sorted(groups.items()):
        group = {
            "expected": len(ids),
            "executed": sum(sid in observed for sid in ids),
            "metrics": {},
            "fan_style": {},
        }
        for category, field in METRICS.items():
            expected = [sid for sid in ids if keys[sid].get("category") == category]
            rated = [
                reviews[sid, "independent_agent"][field]
                for sid in expected
                if field in reviews.get((sid, "independent_agent"), {})
            ]
            group["metrics"][category] = {
                "expected": len(expected),
                "reviewed": len(rated),
                "pending": len(expected) - len(rated),
                "correct": sum(rated),
                "accuracy_on_reviewed": sum(rated) / len(rated) if rated else None,
                "status": "reviewed"
                if rated and len(rated) == len(expected)
                else "pending",
            }
        pairs = defaultdict(list)
        for sid in ids:
            if keys[sid].get("category") == "context_pair":
                if not keys[sid].get("pair_id"):
                    raise ValueError("Context pair has no pair_id")
                pairs[keys[sid]["pair_id"]].append(sid)
        if any(len(members) != 2 for members in pairs.values()):
            raise ValueError("Each context pair needs exactly two conditions")
        rated_pairs = [
            [reviews[sid, "independent_agent"]["context_correct"] for sid in members]
            for members in pairs.values()
            if all(
                "context_correct" in reviews.get((sid, "independent_agent"), {})
                for sid in members
            )
        ]
        group["context_pairs"] = {
            "expected": len(pairs),
            "reviewed": len(rated_pairs),
            "both_correct": sum(all(pair) for pair in rated_pairs),
            "pending": len(pairs) - len(rated_pairs),
            "pair_accuracy_on_reviewed": (
                sum(all(pair) for pair in rated_pairs) / len(rated_pairs)
                if rated_pairs
                else None
            ),
        }
        fan_scores = [
            reviews[sid, "fan"]["style_score"]
            for sid in ids
            if "style_score" in reviews.get((sid, "fan"), {})
        ]
        group["fan_style"] = {
            "expected": len(ids),
            "reviewed": len(fan_scores),
            "pending": len(ids) - len(fan_scores),
            "mean": sum(fan_scores) / len(fan_scores) if fan_scores else None,
            "status": "reviewed" if len(fan_scores) == len(ids) else "pending",
        }
        report[f"{cid}:{condition}"] = group
    return {
        "groups": report,
        "automatic_quality_verdict": None,
        "note": "Unreviewed cases remain pending; no keyword scoring or inferred fan approval.",
    }


def blind_pack(requests, base, trained, *, seed=42):
    inputs, first, second = _index(requests), _index(base), _index(trained)
    if not first or first.keys() != second.keys() or not first.keys() <= inputs.keys():
        raise ValueError(
            "Base/trained outputs must have exactly matching, known request IDs"
        )
    rng = random.Random(seed)
    ids = sorted(first)
    rng.shuffle(ids)
    pack, mapping = [], []
    for index, sid in enumerate(ids, 1):
        request, left, right = inputs[sid], first[sid], second[sid]
        if request.get("input_sha256") != digest(request["messages"]):
            raise ValueError("Prepared input hash does not match messages")
        if not request.get("profile_sha256"):
            raise ValueError("Missing prepared profile hash")
        if any(row.get("status") != "ok" for row in (left, right)):
            raise ValueError("Failed runs cannot enter a blind response comparison")
        for field in ("prompt_sha256", "generation_seed", "sampling"):
            if field not in left or field not in right or left[field] != right[field]:
                raise ValueError(f"Comparison differs in {field}: {sid}")
        for row in (left, right):
            if (
                row.get("character_id") != request["character_id"]
                or row.get("condition") != request["condition"]
            ):
                raise ValueError("Execution character/fact condition mismatch")
            for field in ("input_sha256", "profile_sha256"):
                if field in row and row[field] != request[field]:
                    raise ValueError(f"Execution {field} mismatch")
        labels = ["base", "trained"]
        rng.shuffle(labels)
        by_name = {"base": left, "trained": right}
        blind_id = f"comparison-{index:04d}"
        entry = {
            "blind_id": blind_id,
            "character_id": request["character_id"],
            "messages": request["messages"],
            "responses": {
                label: by_name[name]["reply"] for label, name in zip(("A", "B"), labels)
            },
        }
        entry["comparison_sha256"] = digest(entry)
        pack.append(entry)
        mapping.append(
            {
                "blind_id": blind_id,
                "sample_id": sid,
                "comparison_sha256": entry["comparison_sha256"],
                "labels": dict(zip(("A", "B"), labels)),
                "input_sha256": request["input_sha256"],
                "profile_sha256": request["profile_sha256"],
                "base_result_sha256": digest(left),
                "trained_result_sha256": digest(right),
            }
        )
    return pack, mapping


def comparison_summary(mapping, votes):
    keys = _index(mapping, "blind_id")
    seen, counts = set(), {"base": 0, "trained": 0, "tie": 0}
    kinds = set()
    for vote in votes:
        bid = vote.get("blind_id")
        if (
            bid not in keys
            or bid in seen
            or vote.get("preference") not in {"A", "B", "tie"}
        ):
            raise ValueError("Invalid, unknown or duplicate blind vote")
        if (
            not keys[bid].get("comparison_sha256")
            or vote.get("comparison_sha256") != keys[bid]["comparison_sha256"]
        ):
            raise ValueError("Blind vote has a stale or missing comparison hash")
        if (
            vote.get("reviewer_kind") not in {"independent_agent", "fan"}
            or not vote.get("reviewer")
            or not vote.get("basis")
        ):
            raise ValueError("Votes require explicit reviewer type, identity and basis")
        kinds.add(vote["reviewer_kind"])
        if len(kinds) > 1:
            raise ValueError("Summarize agent and fan votes separately")
        seen.add(bid)
        winner = (
            "tie"
            if vote["preference"] == "tie"
            else keys[bid]["labels"][vote["preference"]]
        )
        counts[winner] += 1
    n = len(votes)
    return {
        "expected": len(keys),
        "reviewed": n,
        "pending": len(keys) - n,
        "reviewer_kind": next(iter(kinds), None),
        "trained_wins": counts["trained"],
        "trained_losses": counts["base"],
        "ties": counts["tie"],
        "net_win_fraction_of_all_reviewed": (counts["trained"] - counts["base"]) / n
        if n
        else None,
        "tie_fraction": counts["tie"] / n if n else None,
        "tie_adjusted_win_fraction": (counts["trained"] + 0.5 * counts["tie"]) / n
        if n
        else None,
        "effect_status": "unclear"
        if not n or counts["tie"] >= n / 2
        else "requires_preregistered_criterion",
        "automatic_quality_verdict": None,
    }


def validate_run_pair(base, trained):
    if (
        not base.get("model")
        or base["model"] != trained.get("model")
        or base.get("adapter") is not None
        or not trained.get("adapter")
        or base.get("adapter_files") is not None
        or not trained.get("adapter_files")
    ):
        raise ValueError(
            "Comparison requires the same base model, without/with an adapter"
        )
    for field in ("model_files", "serialization_sha256", "code_sha256"):
        if not base.get(field) or base[field] != trained.get(field):
            raise ValueError(
                f"Comparison has missing or different artifact hashes: {field}"
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare")
    for name in ("cases", "profiles", "knowledge", "scenario", "output"):
        prep.add_argument("--" + name, required=True)
    summary = commands.add_parser("summary")
    for name in ("results", "key", "output"):
        summary.add_argument("--" + name, required=True)
    summary.add_argument("--judgments")
    blind = commands.add_parser("blind")
    for name in ("requests", "base", "trained", "output"):
        blind.add_argument("--" + name, required=True)
    blind.add_argument("--seed", type=int, default=42)
    votes = commands.add_parser("votes")
    for name in ("mapping", "votes", "output"):
        votes.add_argument("--" + name, required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        result = prepare(
            args.cases, args.profiles, args.knowledge, args.scenario, args.output
        )
    elif args.command == "summary":
        rows = read_jsonl(args.results)
        manifest_path = Path(args.results).with_suffix(".manifest.json")
        manifest = (
            json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
        )
        result = {
            "latency": latency_summary(rows, manifest),
            "quality": quality_summary(
                rows,
                read_jsonl(args.key),
                read_jsonl(args.judgments) if args.judgments else [],
            ),
        }
        _write_json(args.output, result)
    elif args.command == "blind":
        manifests = []
        for path in (args.base, args.trained):
            manifest = json.loads(Path(path).with_suffix(".manifest.json").read_text())
            if manifest.get("requests_sha256") != _file_sha(args.requests):
                raise ValueError("Actual run used a different requests file")
            manifests.append(manifest)
        validate_run_pair(*manifests)
        pack, mapping = blind_pack(
            read_jsonl(args.requests),
            read_jsonl(args.base),
            read_jsonl(args.trained),
            seed=args.seed,
        )
        output = Path(args.output)
        output.mkdir(parents=True, exist_ok=True)
        if any(
            (output / name).exists()
            for name in (
                "comparison.jsonl",
                "private-mapping.jsonl",
                "private-manifest.json",
            )
        ):
            raise FileExistsError("Refusing to overwrite blind comparison evidence")
        _write_jsonl(output / "comparison.jsonl", pack)
        _write_jsonl(output / "private-mapping.jsonl", mapping)
        result = {
            "comparisons": len(pack),
            "expected_requests": len(read_jsonl(args.requests)),
            "randomization_seed": args.seed,
            "fan_review": "pending",
            "requests_sha256": _file_sha(args.requests),
            "base_results_sha256": _file_sha(args.base),
            "trained_results_sha256": _file_sha(args.trained),
        }
        _write_json(output / "private-manifest.json", result)
    else:
        result = comparison_summary(read_jsonl(args.mapping), read_jsonl(args.votes))
        _write_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
