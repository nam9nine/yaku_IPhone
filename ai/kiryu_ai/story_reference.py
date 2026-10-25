"""Source-bound world-reference retrieval, deliberately separate from memory.

Only explicitly associated source sections enter the index. A source URL or
publisher overview does not establish complete chapter or edition coverage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

from .data import digest

ALIASES = {
    "키류": ("Kiryu", "桐生"),
    "하루카": ("Haruka", "遥"),
    "마지마": ("Majima", "真島"),
    "사에지마": ("Saejima", "冴島"),
    "다이고": ("Daigo", "大吾"),
    "미네": ("Mine", "峯"),
    "니시키": ("Nishiki", "Nishikiyama", "錦山"),
    "이치반": ("Ichiban", "春日"),
    "아키야마": ("Akiyama", "秋山"),
    "다테": ("Date", "伊達"),
    "나팔꽃": ("Morning", "Glory", "アサガオ"),
    "야가미": ("Yagami", "八神"),
    "카이토": ("Kaito", "海藤"),
}


def hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_file(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError(
            "source path must identify an existing file inside source root"
        )
    return path


def spans(text: str, max_chars: int = 1600) -> list[tuple[int, int]]:
    if max_chars < 100:
        raise ValueError("chunk size too small")
    result, start = [], 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            boundary = text.rfind("\n", start + max_chars // 2, end)
            if boundary >= 0:
                end = boundary + 1
        result.append((start, end))
        start = end
    return result


def cjk_bigrams(text: str) -> str:
    """Let Japanese names match inside unsegmented source paragraphs.

    This is lexical retrieval, not automatic translation or semantic search.
    """
    grams = set()
    for word in re.findall(r"[\u3040-\u30ff\u3400-\u9fff]+", text):
        grams.update(word[i : i + 2] for i in range(len(word) - 1))
    # Explicit CJK aliases may be one character or longer than a bigram.
    # Do not substring-index Latin names (e.g. Mine inside an unrelated word).
    grams.update(
        alias
        for aliases in ALIASES.values()
        for alias in aliases
        if re.fullmatch(r"[\u3040-\u30ff\u3400-\u9fff]+", alias) and alias in text
    )
    return " ".join(sorted(grams))


def build_records(source_root: Path, max_chars: int = 1600) -> tuple[list[dict], dict]:
    manifest = json.loads((source_root / "manifest.json").read_text())
    catalog = json.loads((source_root / "catalog.json").read_text())
    associations = json.loads((source_root / "source-associations.json").read_text())
    games = {g["id"]: g for g in catalog["games"]}
    if len(games) != len(catalog["games"]):
        raise ValueError("duplicate game catalog ID")
    sources = {
        s["id"]: s for s in manifest["sources"] if s.get("status") == "collected"
    }
    if len(sources) != sum(s.get("status") == "collected" for s in manifest["sources"]):
        raise ValueError("duplicate collected source ID")
    seen, records, source_cache = set(), [], {}
    by_game = {
        gid: {
            "source_ids": set(),
            "coverage_levels": set(),
            "chapters": set(),
            "chunks": 0,
        }
        for gid in games
    }
    for association in associations:
        sid, gid = association["source_id"], association["game_id"]
        if sid not in sources or gid not in games:
            raise ValueError("association refers to missing collected source/game")
        source, game = sources[sid], games[gid]
        if game["releaseStatus"] != "released":
            raise ValueError("unreleased game cannot enter released story index")
        if not association.get("association_basis") or not isinstance(
            association.get("limitations"), list
        ):
            raise ValueError("association needs explicit basis and limitations")
        if sid not in source_cache:
            raw = source_file(source_root, source["rawPath"])
            if hash_file(raw) != source["sha256"]:
                raise ValueError("raw source checksum mismatch")
            extracted_path = source_file(source_root, source["extractedPath"])
            if hash_file(extracted_path) != source.get("extractedSha256"):
                raise ValueError("extracted source checksum mismatch")
            extracted = json.loads(extracted_path.read_text())
            if (
                extracted["sourceId"] != sid
                or extracted["rawSha256"] != source["sha256"]
            ):
                raise ValueError("extracted source identity mismatch")
            source_cache[sid] = (extracted, hash_file(extracted_path))
        extracted, extracted_hash = source_cache[sid]
        if not association["section_indexes"]:
            raise ValueError("empty eligible section association")
        for section_index in association["section_indexes"]:
            if not isinstance(section_index, int) or not 0 <= section_index < len(
                extracted["sections"]
            ):
                raise ValueError("invalid source section index")
            key = (sid, gid, section_index)
            if key in seen:
                raise ValueError("duplicate source section association")
            seen.add(key)
            section = extracted["sections"][section_index]
            if section.get("ragEligible") is not True or gid not in section.get(
                "gameIds", []
            ):
                raise ValueError(
                    "section is not explicitly approved for this game edition"
                )
            if game["continuityPartition"] not in section.get(
                "continuityPartitions", []
            ):
                raise ValueError("section continuity does not match catalog")
            text = section["text"]
            if not isinstance(text, str) or not text.strip():
                raise ValueError("empty story section")
            section_hash = hashlib.sha256(text.encode()).hexdigest()
            chapter = association.get("chapter_id") or section.get("chapterId")
            for start, end in spans(text, max_chars):
                excerpt = text[start:end]
                if not excerpt.strip():
                    continue
                row = {
                    "id": "world-"
                    + digest([sid, gid, section_index, start, end, section_hash])[:24],
                    "game_id": gid,
                    "edition_id": game["edition"],
                    "continuity_id": game["continuityPartition"],
                    "continuity_status": game.get(
                        "continuityStatus", "catalog_partition"
                    ),
                    "chapter_id": chapter,
                    "source_id": sid,
                    "source_url": source["url"],
                    "source_title": extracted["title"],
                    "source_revision": extracted.get("revisionId"),
                    "source_revision_url": source.get("revisionUrl"),
                    "source_language": source.get("language", "unverified"),
                    "source_sha256": source["sha256"],
                    "extracted_sha256": extracted_hash,
                    "source_section_sha256": section_hash,
                    "section_index": section_index,
                    "heading_path": section["headingPath"],
                    "evidence_span": {"start": start, "end": end},
                    "text": excerpt,
                    "source_class": source["sourceClass"],
                    "license": source.get("license", "unresolved"),
                    "coverage_level": association["coverage_level"],
                    "reference_layer": association.get(
                        "reference_layer",
                        section.get("referenceLayer", "plot_reference"),
                    ),
                    "assertion_status": association.get(
                        "assertion_status",
                        section.get(
                            "assertionStatus", "source_claim_not_character_knowledge"
                        ),
                    ),
                    "association_basis": association["association_basis"],
                    "limitations": association["limitations"],
                    "knowledge_scope": "world_reference",
                    "kind": "source_excerpt",
                    "known_by": [],
                    "scenario_adopted": False,
                    "runtime_eligible": False,
                    "reference_ready": True,
                    "spoiler_scope": "full_source_section",
                    "training_eligible": False,
                }
                records.append(row)
                by_game[gid]["chunks"] += 1
            by_game[gid]["source_ids"].add(sid)
            by_game[gid]["coverage_levels"].add(association["coverage_level"])
            if chapter is not None:
                by_game[gid]["chapters"].add(str(chapter))
    coverage = []
    for gid, game in games.items():
        stats = by_game[gid]
        coverage.append(
            {
                "game_id": gid,
                "title": game["title"],
                "release_status": game["releaseStatus"],
                "source_ids": sorted(stats["source_ids"]),
                "coverage_levels": sorted(stats["coverage_levels"]),
                "indexed_chapters": sorted(stats["chapters"]),
                "chunks": stats["chunks"],
                "reference_status": "indexed" if stats["chunks"] else "not_indexed",
                "chapter_coverage": game.get("chapterCoverage", {}),
                "catalog_limitations": game.get("coverageLimitations", []),
                "catalog_coverage_caution": game.get("coverageCaution"),
                "complete_story_claimed": False,
            }
        )
    return records, {
        "games": coverage,
        "sources_used": len(source_cache),
        "records": len(records),
        "indexed_games": sum(g["chunks"] > 0 for g in coverage),
        "game_count": len(games),
        "knowledge_scope": "world_reference",
        "runtime_connected": False,
        "source_class_counts": dict(Counter(r["source_class"] for r in records)),
    }


def write_index(records: list[dict], path: Path) -> None:
    if path.exists():
        raise ValueError("index already exists")
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE chunks(id TEXT PRIMARY KEY, game_id TEXT, edition_id TEXT, continuity_id TEXT, chapter_id TEXT, record_json TEXT)"
        )
        db.execute(
            "CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED, text, title, heading, cjk)"
        )
        for row in records:
            if (
                row.get("known_by")
                or row.get("scenario_adopted") is not False
                or row.get("runtime_eligible") is not False
            ):
                raise ValueError(
                    "world reference must not be promoted to character memory"
                )
            db.execute(
                "INSERT INTO chunks VALUES (?,?,?,?,?,?)",
                (
                    row["id"],
                    row["game_id"],
                    row["edition_id"],
                    row["continuity_id"],
                    row["chapter_id"],
                    json.dumps(row, ensure_ascii=False),
                ),
            )
            db.execute(
                "INSERT INTO search VALUES (?,?,?,?,?)",
                (
                    row["id"],
                    row["text"],
                    row["source_title"],
                    " / ".join(row["heading_path"]),
                    cjk_bigrams(row["text"] + " " + row["source_title"]),
                ),
            )


def query(
    path: Path,
    text: str,
    *,
    game_id: str | None = None,
    edition_id: str | None = None,
    continuity_id: str | None = None,
    reference_layer: str | None = None,
    limit: int = 5,
    excluded_source_ids: tuple[str, ...] = (),
) -> list[dict]:
    if not 1 <= limit <= 50:
        raise ValueError("query limit must be1..50")
    terms = re.findall(r"[^\W_]+", text, re.UNICODE)
    if not terms:
        return []
    expanded = set(terms)
    for term in terms:
        expanded.update(ALIASES.get(term, ()))
    match = " OR ".join(
        '"' + term.replace('"', '""') + '"' for term in sorted(expanded)
    )
    clauses, params = ["search MATCH ?"], [match]
    for column, value in (
        ("game_id", game_id),
        ("edition_id", edition_id),
        ("continuity_id", continuity_id),
    ):
        if value is not None:
            clauses.append(f"c.{column} = ?")
            params.append(value)
    if reference_layer is not None:
        clauses.append("json_extract(c.record_json, '$.reference_layer') = ?")
        params.append(reference_layer)
    # Source exclusions are applied before LIMIT, not after ranking a small set.
    if excluded_source_ids:
        clauses.append(
            "json_extract(c.record_json, '$.source_id') NOT IN ("
            + ",".join("?" for _ in excluded_source_ids)
            + ")"
        )
        params.extend(excluded_source_ids)
    params.append(limit)
    sql = (
        "SELECT c.record_json, bm25(search) FROM search JOIN chunks c ON c.id=search.id WHERE "
        + " AND ".join(clauses)
        + " ORDER BY bm25(search),c.id LIMIT ?"
    )
    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as db:
        return [
            {**json.loads(row), "retrieval_score": score}
            for row, score in db.execute(sql, params)
        ]


def build(source_root: Path, output: Path) -> dict:
    records, report = build_records(source_root)
    output.mkdir(parents=True, exist_ok=False)
    path = output / "world-reference.jsonl"
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in records)
    )
    write_index(records, output / "reference.sqlite")
    report["input_checksums"] = {
        name: hash_file(source_root / name)
        for name in ("manifest.json", "catalog.json", "source-associations.json")
    }
    report["output_checksums"] = {
        name: hash_file(output / name)
        for name in ("world-reference.jsonl", "reference.sqlite")
    }
    report["code_sha256"] = hash_file(Path(__file__))
    (output / "coverage.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("build")
    create.add_argument("--sources", type=Path, required=True)
    create.add_argument("--output", type=Path, required=True)
    search = sub.add_parser("query")
    search.add_argument("--index", type=Path, required=True)
    search.add_argument("--text", required=True)
    search.add_argument("--game")
    search.add_argument("--edition")
    search.add_argument("--continuity")
    search.add_argument("--layer")
    search.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()
    result = (
        build(args.sources, args.output)
        if args.command == "build"
        else query(
            args.index,
            args.text,
            game_id=args.game,
            edition_id=args.edition,
            continuity_id=args.continuity,
            reference_layer=args.layer,
            limit=args.limit,
        )
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
