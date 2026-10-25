import copy
import unittest

from kiryu_ai.community import parse_document
from test_community_inputs import convert, fixture


class ReviewedTurnMergeTests(unittest.TestCase):
    def setUp(self):
        self.documents, _ = fixture(
            "키류: 계속해라.\n하루카: 하지만.\n\n[IMAGE:7]\n\n하루카: 도망치고 싶지 않아요.\n키류: 알겠다.\n"
        )
        self.doc = self.documents[0]
        self.annotation = {
            "source_sha256": self.doc["text_sha256"],
            "reviewer": "synthetic-reviewer",
            "basis": "Synthetic same-speaker continuation.",
            "speaker_id": "haruka",
            "line_starts": [1, 5],
            "allowed_image_line_starts": [3],
        }
        self.doc["reviewed_turn_merges"] = [self.annotation]

    def test_merges_only_named_gap_and_preserves_raw(self):
        blocks, turns, scenes = parse_document(self.doc)
        turn = next(t for t in turns if t["speaker_id"] == "haruka")
        self.assertEqual(turn["text_clean"], "하지만. 도망치고 싶지 않아요.")
        self.assertIn("[IMAGE:7]", turn["text_raw"])
        self.assertEqual(
            turn["text_raw"], self.doc["text"][turn["char_start"] : turn["char_end"]]
        )
        self.assertFalse(turn["training_eligible"])
        self.assertEqual(
            turn["turn_merge_provenance"]["excluded_image_line_starts"], [3]
        )
        self.assertEqual(scenes[0]["block_ids"], [b["block_id"] for b in blocks])
        from kiryu_ai.community import prepare

        prepared = prepare(self.documents)
        canonical = convert(self.documents, prepared)["canonical-messages"]
        target = next(r for r in canonical if r["character_id"] == "haruka")
        self.assertEqual(target["target_response"], turn["text_clean"])
        self.assertEqual(target["history_turns"][-1]["speaker_id"], "kiryu")

    def test_without_annotation_image_still_breaks_context(self):
        self.doc.pop("reviewed_turn_merges")
        _, turns, _ = parse_document(self.doc)
        haruka = [t for t in turns if t["speaker_id"] == "haruka"]
        self.assertEqual(len(haruka), 2)
        self.assertNotEqual(haruka[0]["run_id"], haruka[1]["run_id"])

    def test_rejects_unreviewed_image_gap(self):
        self.annotation["allowed_image_line_starts"] = []
        with self.assertRaisesRegex(ValueError, "unreviewed gaps"):
            parse_document(self.doc)

    def test_cannot_merge_different_speakers(self):
        self.annotation["line_starts"] = [0, 1]
        self.annotation["allowed_image_line_starts"] = []
        with self.assertRaisesRegex(ValueError, "single explicit speaker"):
            parse_document(self.doc)

    def test_cannot_skip_another_speakers_speech(self):
        docs, _ = fixture("하루카: 하나.\n키류: 둘.\n하루카: 셋.\n")
        doc = docs[0]
        doc["reviewed_turn_merges"] = [
            {
                **self.annotation,
                "source_sha256": doc["text_sha256"],
                "line_starts": [0, 2],
                "allowed_image_line_starts": [1],
            }
        ]
        with self.assertRaisesRegex(ValueError, "cannot skip speech"):
            parse_document(doc)

    def test_cannot_skip_directions(self):
        docs, _ = fixture("하루카: 하나.\n장소가 바뀌었다\n하루카: 셋.\n")
        doc = docs[0]
        doc["reviewed_turn_merges"] = [
            {
                **self.annotation,
                "source_sha256": doc["text_sha256"],
                "line_starts": [0, 2],
                "allowed_image_line_starts": [1],
            }
        ]
        with self.assertRaisesRegex(ValueError, "cannot skip speech"):
            parse_document(doc)

    def test_rejects_stale_and_overlapping_annotations(self):
        self.doc["reviewed_turn_merges"].append(copy.deepcopy(self.annotation))
        with self.assertRaisesRegex(ValueError, "overlapping"):
            parse_document(self.doc)
        self.doc["reviewed_turn_merges"].pop()
        self.annotation["source_sha256"] = "stale"
        with self.assertRaisesRegex(ValueError, "stale"):
            parse_document(self.doc)

    def test_rejects_reversed_coordinates(self):
        self.annotation["line_starts"] = [5, 1]
        with self.assertRaisesRegex(ValueError, "coordinates"):
            parse_document(self.doc)
