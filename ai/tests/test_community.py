import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from kiryu_ai.community import export, prepare


def document(text, sid="one", event=None, **changes):
    result = {
        "source_id": sid,
        "url": f"https://example.org/{sid}",
        "title": "합성 검사 문서",
        "text": text,
        "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
        "source_kind": "fan_translation",
        "language": "ko",
        "canonical_event_group": event or sid,
        "game": "synthetic-fixture",
        "edition": "test",
        "period": "test",
        "permission_status": "test_fixture",
        "source_path": f"fixtures/{sid}.txt",
    }
    return {**result, **changes}


class CommunityTests(unittest.TestCase):
    def test_labelled_continuations_are_not_partial_target_responses(self):
        text = "키류: 무슨 일이냐?\n하루카: 먼저 전할 게 있어요.\n하루카: 조금 늦게 도착한대요.\n마지마: 그렇군.\n"
        result = prepare([document(text)])
        self.assertEqual(
            [c["character_id"] for c in result["sft-candidates"]], ["majima"]
        )
        first = next(
            t for t in result["normalized-turns"] if t["speaker_id"] == "haruka"
        )
        self.assertIn("possible_labelled_continuation", first["quality_flags"])
        self.assertTrue(
            any(
                h["block_id"] == first["turn_id"]
                and "possible_labelled_continuation" in h["reasons"]
                for h in result["held"]
            )
        )
        self.assertEqual(len(result["sft-candidates"][0]["history_turns"]), 3)

    def test_labelled_continuation_still_detected_when_following_turn_is_incomplete(
        self,
    ):
        text = "키류: 무슨 일이냐?\n하루카: 전할 말이 있어요.\n하루카: 그리고\n이어서 말할게요.\n"
        result = prepare([document(text)])
        self.assertEqual(result["sft-candidates"], [])
        self.assertIn(
            "possible_labelled_continuation",
            result["normalized-turns"][1]["quality_flags"],
        )

    def test_nonlexical_targets_are_held_but_can_remain_in_history(self):
        for reply in ("...", "……", "?", "…?!"):
            with self.subTest(reply=reply):
                text = f"키류: 괜찮나?\n하루카: {reply}\n마지마: 기다려 보자.\n"
                result = prepare([document(text)])
                self.assertEqual(
                    [c["character_id"] for c in result["sft-candidates"]], ["majima"]
                )
                self.assertIn("nonlexical_response", result["report"]["held_reasons"])
                self.assertEqual(
                    result["sft-candidates"][0]["history_turns"][-1]["text"], reply
                )

    def test_headings_and_author_notes_alone_are_not_rag_evidence(self):
        text = "#1화\n번역자 소개 글입니다.\nPS: 번역 설명\n대본: 안내\n문제: 풀이\n메일제목: 안부\n제2장\n낯선 행인: 저쪽으로 가세요.\n"
        result = prepare([document(text)])
        self.assertEqual(len(result["rag-candidates"]), 1)
        self.assertEqual(result["rag-candidates"][0]["evidence_turn_ids"], [])
        self.assertIn("낯선 행인", result["rag-candidates"][0]["text"])
        self.assertNotIn("번역자 소개", result["rag-candidates"][0]["text"])

    def test_many_html_blank_lines_do_not_hide_label_or_continuation(self):
        text = (
            "키류:"
            + "\n" * 15
            + "어디로 가나?\n하루카: 저쪽이에요."
            + "\n" * 15
            + "할 말이 더 있어요.\n"
        )
        result = prepare([document(text)])
        self.assertEqual(result["normalized-turns"][0]["text_clean"], "어디로 가나?")
        self.assertEqual(result["sft-candidates"], [])
        self.assertIn(
            "possible_unlabelled_continuation",
            result["normalized-turns"][1]["quality_flags"],
        )

    def test_empty_label_cannot_steal_next_speaker_or_choice_heading(self):
        text = "키류:\n하루카\n:\n어디 있나요?\n마지마:\n< 선택문 >\n키류: 여기다.\n"
        result = prepare([document(text)])
        self.assertEqual(
            [t["speaker_id"] for t in result["normalized-turns"]], ["haruka", "kiryu"]
        )
        self.assertEqual(result["sft-candidates"], [])
        self.assertIn("empty_label", result["report"]["held_reasons"])

    def test_source_offsets_reconstruct_raw_multiline_speaker(self):
        text = "제1장\r\n키류\r\n:\r\n어디로 가야 하지?\r\n하루카:\r\n저쪽이에요!\r\n"
        result = prepare([document(text)])
        for block in result["normalized-blocks"]:
            self.assertEqual(
                text[block["char_start"] : block["char_end"]], block["text_raw"]
            )
            self.assertEqual(
                "".join(
                    text.splitlines(keepends=True)[
                        block["line_start"] : block["line_end"]
                    ]
                ),
                block["text_raw"],
            )
        turns = result["normalized-turns"]
        self.assertEqual([t["speaker_id"] for t in turns], ["kiryu", "haruka"])
        self.assertEqual(turns[0]["line_start"], 1)
        self.assertEqual(turns[0]["line_end"], 4)
        self.assertEqual(result["sft-candidates"][0]["target_response"], "저쪽이에요!")

    def test_only_prior_dialogue_enters_history_without_role_relabelling(self):
        result = prepare(
            [
                document(
                    "사에지마: 여기 있었군.\n마지마: 그래, 기다렸다.\n키류: 마지막 비밀이다.\n"
                )
            ]
        )
        majima = next(
            c for c in result["sft-candidates"] if c["character_id"] == "majima"
        )
        self.assertEqual(majima["history_turns"][0]["speaker_id"], "saejima")
        self.assertNotIn("마지막 비밀", json.dumps(majima, ensure_ascii=False))
        self.assertNotIn("role", majima["history_turns"][0])
        self.assertEqual(majima["recipient_ids"], [])
        self.assertFalse(majima["training_eligible"])

    def test_parentheticals_images_and_choices_break_context(self):
        text = "키류: 기다려라.\n하루카: (마음속으로 생각한다.)\n마지마: 여기다.\n[IMAGE:0]\n키류: 괜찮나?\n하루카: ① 가자\n마지마: 알았다.\n"
        result = prepare([document(text)])
        self.assertEqual(result["sft-candidates"], [])
        reasons = result["report"]["held_reasons"]
        for reason in [
            "parenthetical_or_direction",
            "image_pending",
            "choice_or_numbered_text",
        ]:
            self.assertIn(reason, reasons)

    def test_unlabelled_continuation_is_not_lost_or_treated_as_complete_response(self):
        result = prepare(
            [
                document(
                    "키류: 어디 있나?\n하루카: 여기에 있어요.\n그리고 전할 말이 있어요.\n마지마: 잠깐 기다려라.\n"
                )
            ]
        )
        haruka = next(
            t for t in result["normalized-turns"] if t["speaker_id"] == "haruka"
        )
        self.assertIn("possible_unlabelled_continuation", haruka["quality_flags"])
        self.assertEqual(result["sft-candidates"], [])
        self.assertTrue(
            any("그리고 전할" in b["text_raw"] for b in result["normalized-blocks"])
        )

    def test_annotation_is_held_and_punctuation_is_not_rewritten(self):
        text = "키류: 왜 그러나?\n마지마: 하앙??!!!!!\n하루카: 네. (역주: 설명)\n"
        result = prepare([document(text)])
        self.assertEqual(result["sft-candidates"][0]["target_response"], "하앙??!!!!!")
        self.assertIn(
            "inline_annotation_or_quote_requires_review",
            result["report"]["held_reasons"],
        )

    def test_namesake_and_fake_speaker_never_become_target(self):
        text = "키류: 누구지?\n하루카: 다른 사람이에요.\n가짜 키류: 나다.\n마지마: 뭐라고?\n"
        result = prepare(
            [document(text, speaker_overrides={"하루카": "sasahara_haruka"})]
        )
        self.assertNotIn("haruka", result["report"]["target_speech_turns"])
        self.assertEqual(result["sft-candidates"], [])
        self.assertIn("unresolved_speaker", result["report"]["held_reasons"])

    def test_null_override_prevents_generic_alias_use(self):
        result = prepare(
            [
                document(
                    "키류: 기다려.\n하루카: 응.\n", speaker_overrides={"하루카": None}
                )
            ]
        )
        self.assertEqual(result["sft-candidates"], [])

    def test_non_dialogue_source_and_english_never_enter_style_candidates(self):
        text = "키류: 누구냐?\n마지마: 나다.\n"
        result = prepare(
            [
                document(text, "fanwork", source_kind="fan_work"),
                document(text, "english", language="en"),
            ]
        )
        self.assertEqual(result["sft-candidates"], [])
        self.assertEqual(result["normalized-turns"], [])
        self.assertIn("source_kind_not_admitted", result["report"]["held_reasons"])
        self.assertIn("not_korean_style_data", result["report"]["held_reasons"])
        self.assertEqual(len(result["rag-candidates"]), 1)
        self.assertEqual(result["rag-candidates"][0]["known_by"], [])
        self.assertFalse(result["rag-candidates"][0]["scenario_adopted"])

    def test_same_event_different_translation_has_one_split(self):
        a = document("키류: 언제 가나?\n하루카: 내일 가요.\n", "a", "shared-event")
        b = document("키류: 언제 가지?\n하루카: 내일 갈 거예요.\n", "b", "shared-event")
        result = prepare([a, b])
        self.assertEqual(len(result["split-groups"]), 1)
        self.assertEqual(len({c["split"] for c in result["sft-candidates"]}), 1)

    def test_exact_body_and_long_sequence_join_different_event_labels(self):
        sequence = "키류: 약속한 장소에 조금 늦게 도착할 것 같으니 잠시만 기다려라.\n하루카: 알겠어요. 여기서 기다릴 테니까 도착하면 연락해 주세요.\n마지마: 그럼 나는 옆 가게에서 잠시 기다리고 있을 테니 모두 도착하면 이야기해라.\n"
        a = document(sequence, "a")
        b = document("제2장\n" + sequence, "b")
        c = document(sequence, "c")
        result = prepare([a, b, c])
        self.assertEqual(len(result["split-groups"]), 1)
        self.assertEqual(result["split-groups"][0]["source_ids"], ["a", "b", "c"])
        self.assertIn(
            "long_three_turn_sequence",
            [g["reason"] for g in result["duplicate-groups"]],
        )
        self.assertIn("exact_body", [g["reason"] for g in result["duplicate-groups"]])

    def test_short_repeated_answers_in_unrelated_scenes_are_preserved(self):
        a = document("키류: 가겠나?\n하루카: 네.\n", "a")
        b = document("키류: 먹겠나?\n하루카: 네.\n", "b")
        result = prepare([a, b])
        self.assertEqual(len(result["sft-candidates"]), 2)
        self.assertEqual(len(result["split-groups"]), 2)

    def test_unknown_label_and_source_annotation_not_speakers(self):
        result = prepare(
            [
                document(
                    "출처: 다른 곳\nhttps: example.org\n카무로쵸: 밤\n키류: 어디지?\n하루카: 여기에요.\n"
                )
            ]
        )
        self.assertEqual(len(result["normalized-turns"]), 2)
        self.assertEqual(len(result["sft-candidates"]), 1)

    def test_sections_and_unknown_prose_do_not_join_dialogue(self):
        result = prepare(
            [
                document(
                    "키류: 시작하자.\n제2장\n하루카: 네.\n작성자의 감상\n마지마: 기다려라.\n"
                )
            ]
        )
        self.assertEqual(result["sft-candidates"], [])
        self.assertGreater(len(result["scene-candidates"]), 1)

    def test_input_hash_mismatch_duplicate_ids_and_empty_input_rejected(self):
        row = document("키류: 안녕.\n")
        with self.assertRaisesRegex(ValueError, "SHA256"):
            prepare([{**row, "text": "changed"}])
        with self.assertRaisesRegex(ValueError, "duplicate source_id"):
            prepare([row, copy.deepcopy(row)])
        with self.assertRaisesRegex(ValueError, "empty"):
            prepare([])

    def test_output_is_reproducible_and_never_overwrites_existing_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "docs.jsonl"
            source.write_text(
                json.dumps(
                    document("키류: 어디로 가나?\n하루카: 집에 가요.\n"),
                    ensure_ascii=False,
                )
                + "\n"
            )
            export(source, root / "one")
            export(source, root / "two")
            first = {p.name: p.read_bytes() for p in (root / "one").iterdir()}
            second = {p.name: p.read_bytes() for p in (root / "two").iterdir()}
            self.assertEqual(first, second)
            with self.assertRaisesRegex(ValueError, "empty"):
                export(source, root / "one")


if __name__ == "__main__":
    unittest.main()
