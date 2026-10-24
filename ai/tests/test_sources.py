import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kiryu_ai.sources import (
    annotated_facts,
    cast_records,
    character_id,
    collect,
    ensure_private_output,
    sha256,
    text_from_html,
    transcript_candidates,
    validate_url,
)


class SourceTests(unittest.TestCase):
    def test_exact_character_alias_not_substring(self):
        self.assertEqual(character_id("유키"), "yuki")
        self.assertIsNone(character_id("테라다 유키오"))
        self.assertIsNone(character_id("사와다 유키"))
        self.assertEqual(character_id("真島   吾朗"), "majima")

    def test_url_and_output_boundaries(self):
        for url in [
            "http://ryu-ga-gotoku.com/",
            "https://127.0.0.1/",
            "https://ryu-ga-gotoku.com@evil.test/",
            "https://ryu-ga-gotoku.com:444/",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_url(url)
        validate_url("https://ryu-ga-gotoku.com/asia_en/story/three/")
        with self.assertRaises(ValueError):
            ensure_private_output(Path("public/raw"))

    def test_html_extraction_preserves_dialogue_and_excludes_scripts(self):
        html = "<nav>menu</nav><main><p>Haruka: Hello.</p><p>[She leaves.]</p><script>evil()</script></main>"
        self.assertEqual(
            text_from_html(html, page=True), "Haruka: Hello.\n[She leaves.]"
        )

    def test_inline_speaker_label_remains_with_its_dialogue(self):
        html = '<div class="post-body"><b>Kiryu:</b> Hello.<br><b>Haruka:</b> Hi.</div>'
        self.assertEqual(text_from_html(html, page=True), "Kiryu: Hello.\nHaruka: Hi.")

    def test_fan_labels_are_only_candidates(self):
        source = {
            "id": "test",
            "url": "https://game-scripts-wiki.blogspot.com/test",
            "language": "en",
            "scope": "kiwami",
        }
        rows = transcript_candidates(
            "Haruka: Hello.\n[She leaves.]\nUnknown next speaker", source, "a"
        )
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["trainingEligible"])
        self.assertFalse(rows[0]["speakerVerified"])

    def test_cast_title_scopes_and_evidence_gate(self):
        source = {
            "id": "sega-cast-ko",
            "url": "https://ryu-ga-gotoku.com/kr/cast/entries.json",
            "language": "ko",
        }
        raw = [
            {
                "id": "ryu3",
                "chara": [
                    {
                        "id": "ryu3_10",
                        "name": {"value": "사와무라 하루카"},
                        "copy": "<p>키류와 나팔꽃에서 산다.</p>",
                    }
                ],
            }
        ]
        rows = cast_records(raw, source, "hash")
        self.assertEqual(rows[0]["titleId"], "ryu3")
        annotation = {
            "id": "fact",
            "characterId": "haruka",
            "sourceId": source["id"],
            "sourceRecordId": "ryu3_10",
            "textKo": "하루카는 나팔꽃에서 산다.",
            "evidenceContains": "나팔꽃에서 산다.",
        }
        facts = annotated_facts(rows, [annotation])
        self.assertFalse(facts[0]["trainingEligible"])
        self.assertEqual(facts[0]["knownBy"], [])
        annotation["evidenceContains"] = "우주에 산다."
        with self.assertRaises(ValueError):
            annotated_facts(rows, [annotation])

    def test_collection_cache_integrity_and_excluded_source(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            output = base / "references/local/sources"
            source = {
                "id": "story",
                "url": "https://ryu-ga-gotoku.com/story/",
                "language": "en",
                "format": "html",
                "kind": "official_story_summary",
                "scope": "test",
            }
            catalog = {
                "sources": [
                    source,
                    {"id": "excluded", "fetch": False, "reason": "not cleared"},
                ]
            }
            catalog_path = base / "catalog.json"
            catalog_path.write_text(json.dumps(catalog))

            def fetch(url):
                data = (
                    b"User-agent: *\nAllow: /\n"
                    if url.endswith("robots.txt")
                    else b"<main><p>Reference story.</p></main>"
                )
                return data, {"status": 200, "finalUrl": url}

            with (
                patch("kiryu_ai.sources.download", side_effect=fetch),
                patch("kiryu_ai.sources.time.sleep"),
            ):
                first = collect(catalog_path, output)
                second = collect(catalog_path, output)
            self.assertEqual(first["counts"]["collected"], 1)
            self.assertEqual(first["counts"]["excluded"], 1)
            self.assertTrue(second["sources"][0]["cacheHit"])
            raw = output / second["sources"][0]["rawPath"]
            self.assertEqual(sha256(raw.read_bytes()), second["sources"][0]["sha256"])
            raw.write_bytes(b"corrupted")
            with patch("kiryu_ai.sources.download", side_effect=fetch):
                broken = collect(catalog_path, output)
            self.assertEqual(broken["counts"]["failed"], 1)
            self.assertIn("checksum mismatch", broken["sources"][0]["error"])


if __name__ == "__main__":
    unittest.main()
