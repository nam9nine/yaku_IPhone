"""Synthetic source/edition/retrieval boundary tests, without collected text."""

import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from kiryu_ai.story_reference import (
    build,
    build_records,
    query,
    source_file,
    spans,
    write_index,
)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fixture(root, long_text=None):
    root.mkdir(parents=True, exist_ok=True)
    games = [
        {
            "id": "original",
            "title": "Synthetic Original",
            "edition": "original-edition",
            "continuityPartition": "main",
            "releaseStatus": "released",
        },
        {
            "id": "remake",
            "title": "Synthetic Remake",
            "edition": "remake-edition",
            "continuityPartition": "main",
            "releaseStatus": "released",
        },
        {
            "id": "alternate",
            "title": "Synthetic Alternate",
            "edition": "alternate-edition",
            "continuityPartition": "alternate-world",
            "releaseStatus": "released",
        },
        {
            "id": "uncovered",
            "title": "Synthetic Uncovered",
            "edition": "uncovered-edition",
            "continuityPartition": "main",
            "releaseStatus": "released",
        },
    ]
    sources, associations = [], []
    for sid, gid, continuity, text in [
        (
            "blocked",
            "original",
            "main",
            long_text or "Kiryu " * 30 + "synthetic blocked report.",
        ),
        ("allowed", "original", "main", "Kiryu synthetic allowed report."),
        ("remake-source", "remake", "main", "Kiryu synthetic remake report."),
        (
            "alternate-source",
            "alternate",
            "alternate-world",
            "Kiryu synthetic alternate report.",
        ),
    ]:
        raw = root / f"{sid}.html"
        raw.write_text(f"<main><h1>Synthetic {sid}</h1><p>{text}</p></main>")
        extracted = root / f"{sid}.json"
        write_json(
            extracted,
            {
                "sourceId": sid,
                "rawSha256": sha(raw),
                "title": f"Synthetic {sid}",
                "revisionId": "synthetic-revision-1",
                "sections": [
                    {
                        "text": text,
                        "headingPath": ["Synthetic plot"],
                        "ragEligible": True,
                        "gameIds": [gid],
                        "continuityPartitions": [continuity],
                        "chapterId": "chapter-fixture",
                        "known_by": ["majima"],
                        "runtime_eligible": True,
                    }
                ],
            },
        )
        sources.append(
            {
                "id": sid,
                "status": "collected",
                "rawPath": raw.name,
                "sha256": sha(raw),
                "extractedPath": extracted.name,
                "extractedSha256": sha(extracted),
                "url": f"https://example.org/{sid}",
                "sourceClass": "synthetic_reference",
                "license": "synthetic_fixture",
            }
        )
        associations.append(
            {
                "source_id": sid,
                "game_id": gid,
                "section_indexes": [0],
                "association_basis": "Synthetic edition is explicitly scoped in the approved section.",
                "limitations": ["Fixture summary, not full chapter coverage."],
                "coverage_level": "summary",
            }
        )
    documents = {
        "manifest.json": {"sources": sources},
        "catalog.json": {"games": games},
        "source-associations.json": associations,
    }
    for name, data in documents.items():
        write_json(root / name, data)
    return documents


def rehash_extracted(root, documents, sid="blocked"):
    source = next(s for s in documents["manifest.json"]["sources"] if s["id"] == sid)
    source["extractedSha256"] = sha(root / source["extractedPath"])
    write_json(root / "manifest.json", documents["manifest.json"])


class StorySourceTests(unittest.TestCase):
    def test_unicode_chunks_reconstruct_exact_sections_and_cannot_become_memory(self):
        text = ("Kiryu 한글🙂과 합성 장면입니다.\n" * 16) + "마지막 합성 문장."
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root, text)
            records, report = build_records(root, max_chars=100)
            selected = [r for r in records if r["source_id"] == "blocked"]
            self.assertGreater(len(selected), 1)
            self.assertEqual("".join(r["text"] for r in selected), text)
            for row in selected:
                span = row["evidence_span"]
                self.assertEqual(text[span["start"] : span["end"]], row["text"])
                self.assertEqual(
                    row["source_section_sha256"],
                    hashlib.sha256(text.encode()).hexdigest(),
                )
            self.assertEqual(len({r["id"] for r in records}), len(records))
            self.assertEqual(records, build_records(root, max_chars=100)[0])
            for row in records:
                self.assertEqual(row["known_by"], [])
                self.assertFalse(row["scenario_adopted"])
                self.assertFalse(row["runtime_eligible"])
                self.assertFalse(row["training_eligible"])
                self.assertEqual(row["knowledge_scope"], "world_reference")
            self.assertFalse(report["runtime_connected"])
            self.assertTrue(
                all(not g["complete_story_claimed"] for g in report["games"])
            )
            uncovered = next(g for g in report["games"] if g["game_id"] == "uncovered")
            self.assertEqual(uncovered["reference_status"], "not_indexed")
            self.assertEqual(uncovered["source_ids"], [])

    def test_raw_and_extracted_checksum_tampering_fails(self):
        for name in ("blocked.html", "blocked.json"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                fixture(root)
                path = root / name
                path.write_bytes(path.read_bytes() + b"tampered")
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    build_records(root)

    def test_rehashed_extraction_still_requires_source_identity_and_raw_hash(self):
        for field, value in (
            ("sourceId", "another-source"),
            ("rawSha256", "unrelated-raw-hash"),
        ):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                documents = fixture(root)
                extracted = json.loads((root / "blocked.json").read_text())
                extracted[field] = value
                write_json(root / "blocked.json", extracted)
                rehash_extracted(root, documents)
                with self.assertRaisesRegex(ValueError, "identity mismatch"):
                    build_records(root)

    def test_edition_association_cannot_borrow_another_games_section(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            documents = fixture(root)
            documents["source-associations.json"][0]["game_id"] = "remake"
            write_json(
                root / "source-associations.json", documents["source-associations.json"]
            )
            with self.assertRaisesRegex(ValueError, "game edition"):
                build_records(root)

    def test_ineligible_or_wrong_continuity_section_is_not_indexed(self):
        for field, value in (
            ("ragEligible", False),
            ("continuityPartitions", ["alternate-world"]),
            ("text", "  \n"),
        ):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                documents = fixture(root)
                extracted = json.loads((root / "blocked.json").read_text())
                extracted["sections"][0][field] = value
                write_json(root / "blocked.json", extracted)
                rehash_extracted(root, documents)
                with self.assertRaises(ValueError):
                    build_records(root)

    def test_invalid_missing_and_duplicate_associations_fail(self):
        mutations = [
            lambda d: d["source-associations.json"][0].update(section_indexes=[]),
            lambda d: d["source-associations.json"][0].update(section_indexes=[-1]),
            lambda d: d["source-associations.json"][0].update(section_indexes=[9]),
            lambda d: d["source-associations.json"][0].update(
                source_id="not-collected"
            ),
            lambda d: d["source-associations.json"][0].update(game_id="unknown-game"),
            lambda d: d["source-associations.json"].append(
                copy.deepcopy(d["source-associations.json"][0])
            ),
            lambda d: d["catalog.json"]["games"][0].update(releaseStatus="announced"),
            lambda d: d["catalog.json"]["games"].append(
                copy.deepcopy(d["catalog.json"]["games"][0])
            ),
            lambda d: d["manifest.json"]["sources"].append(
                copy.deepcopy(d["manifest.json"]["sources"][0])
            ),
        ]
        for number, mutate in enumerate(mutations):
            with self.subTest(case=number), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                documents = fixture(root)
                mutate(documents)
                for name, value in documents.items():
                    write_json(root / name, value)
                with self.assertRaises(ValueError):
                    build_records(root)

    def test_raw_and_extracted_paths_cannot_escape_root_via_parent_absolute_or_symlink(
        self,
    ):
        for field in ("rawPath", "extractedPath"):
            for route in ("parent", "absolute", "symlink"):
                with (
                    self.subTest(field=field, route=route),
                    tempfile.TemporaryDirectory() as directory,
                ):
                    base = Path(directory)
                    root = base / "sources"
                    documents = fixture(root)
                    source = documents["manifest.json"]["sources"][0]
                    outside = base / "outside"
                    outside.write_bytes((root / source[field]).read_bytes())
                    if route == "symlink":
                        (root / "link").symlink_to(outside)
                        source[field] = "link"
                    else:
                        source[field] = (
                            "../outside" if route == "parent" else str(outside)
                        )
                    write_json(root / "manifest.json", documents["manifest.json"])
                    with self.assertRaisesRegex(ValueError, "inside source root"):
                        build_records(root)
            with (
                self.subTest(field=field, route="missing"),
                tempfile.TemporaryDirectory() as directory,
                self.assertRaises(ValueError),
            ):
                source_file(Path(directory), "missing-source")

    def test_chunk_size_rejects_degenerate_ranges_and_preserves_boundaries(self):
        with self.assertRaises(ValueError):
            spans("synthetic", 99)
        self.assertEqual(spans(""), [])
        text = "x" * 75 + "\n" + "y" * 80
        segments = spans(text, 100)
        self.assertEqual(segments[0], (0, 76))
        self.assertEqual(segments[-1][1], len(text))
        self.assertEqual("".join(text[a:b] for a, b in segments), text)

    def test_build_records_hashes_and_coverage_do_not_claim_full_story(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "sources"
            fixture(source)
            output = base / "output"
            report = build(source, output)
            self.assertEqual(report["indexed_games"], 3)
            self.assertEqual(report["game_count"], 4)
            for name, expected in report["input_checksums"].items():
                self.assertEqual(sha(source / name), expected)
            for name, expected in report["output_checksums"].items():
                self.assertEqual(sha(output / name), expected)
            self.assertTrue((output / "reference.sqlite").is_file())
            self.assertFalse(report["runtime_connected"])
            self.assertTrue(
                all(g["complete_story_claimed"] is False for g in report["games"])
            )
            with self.assertRaises(FileExistsError):
                build(source, output)


class StoryRetrievalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixture(self.root / "sources")
        self.records = build_records(self.root / "sources")[0]
        self.index = self.root / "reference.sqlite"
        write_index(self.records, self.index)

    def test_game_edition_and_continuity_filters_intersect_before_results(self):
        all_rows = query(self.index, "Kiryu", limit=20)
        self.assertEqual(
            {r["game_id"] for r in all_rows}, {"original", "remake", "alternate"}
        )
        for kwargs, expected in [
            ({"game_id": "original"}, {"original"}),
            ({"edition_id": "remake-edition"}, {"remake"}),
            ({"continuity_id": "alternate-world"}, {"alternate"}),
            ({"game_id": "original", "edition_id": "remake-edition"}, set()),
            ({"game_id": "original", "continuity_id": "alternate-world"}, set()),
        ]:
            with self.subTest(filters=kwargs):
                self.assertEqual(
                    {
                        r["game_id"]
                        for r in query(self.index, "Kiryu", limit=20, **kwargs)
                    },
                    expected,
                )
        self.assertTrue(query(self.index, "키류", game_id="original"))

    def test_korean_name_alias_matches_unsegmented_japanese_without_translation(self):
        text = "これは合成です。真島は架空の場所へ行く。桐生はそこにいない。澤村遥はアサガオで家族を大切にした。峯は架空の役です。"
        root = self.root / "japanese-sources"
        fixture(root, text)
        records = build_records(root)[0]
        index = self.root / "japanese.sqlite"
        write_index(records, index)
        for name in (
            "마지마",
            "키류",
            "真島",
            "桐生",
            "하루카",
            "遥",
            "미네",
            "峯",
            "나팔꽃",
            "アサガオ",
        ):
            matches = query(index, name, game_id="original")
            with self.subTest(name=name):
                matched = next(row for row in matches if row["source_id"] == "blocked")
                self.assertEqual(matched["text"], text)
                self.assertEqual(matched["game_id"], "original")
                self.assertFalse(matched["runtime_eligible"])
        self.assertEqual(query(index, "마지마", edition_id="remake-edition"), [])
        self.assertEqual(query(index, "싸움을 좋아하는 인물"), [])

    def test_excluded_sources_are_removed_before_limit_not_after_top_hit(self):
        first = query(self.index, "Kiryu", game_id="original", limit=1)
        self.assertEqual(first[0]["source_id"], "blocked")
        next_allowed = query(
            self.index,
            "Kiryu",
            game_id="original",
            limit=1,
            excluded_source_ids=("blocked",),
        )
        self.assertEqual(len(next_allowed), 1)
        self.assertEqual(next_allowed[0]["source_id"], "allowed")
        self.assertEqual(
            query(
                self.index,
                "Kiryu",
                game_id="original",
                excluded_source_ids=("blocked", "allowed"),
            ),
            [],
        )

    def test_text_and_filter_values_remain_data_and_queries_are_read_only(self):
        before = sha(self.index)
        self.assertEqual(query(self.index, "  !!! "), [])
        self.assertEqual(query(self.index, "Kiryu", game_id="original' OR 1=1 --"), [])
        self.assertTrue(
            query(
                self.index,
                'Kiryu" OR "not-a-command',
                excluded_source_ids=("bad') OR 1=1 --",),
            )
        )
        self.assertEqual(sha(self.index), before)
        missing = self.root / "missing.sqlite"
        with self.assertRaises(sqlite3.OperationalError):
            query(missing, "Kiryu")
        self.assertFalse(missing.exists())
        for limit in (0, 51):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                query(self.index, "Kiryu", limit=limit)

    def test_retrieval_does_not_assign_character_knowledge_or_runtime_eligibility(self):
        rows = query(self.index, "Kiryu", limit=20)
        self.assertTrue(rows)
        for row in rows:
            self.assertEqual(row["known_by"], [])
            self.assertFalse(row["scenario_adopted"])
            self.assertFalse(row["runtime_eligible"])
            self.assertFalse(row["training_eligible"])
            self.assertEqual(row["knowledge_scope"], "world_reference")
        for field, value in (
            ("known_by", ["haruka"]),
            ("scenario_adopted", True),
            ("runtime_eligible", True),
        ):
            records = copy.deepcopy(self.records)
            records[0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                write_index(records, self.root / f"bad-{field}.sqlite")
        with self.assertRaises(ValueError):
            write_index(self.records, self.index)


if __name__ == "__main__":
    unittest.main()
