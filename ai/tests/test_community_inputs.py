import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from kiryu_ai.community import prepare
from kiryu_ai.community_inputs import (
    CANONICAL_SYSTEM,
    export_inputs,
    prepare_inputs,
    prepare_sms_inputs,
    validate_sms_adaptations,
)
from kiryu_ai.data import build_messages


def fixture(text=None):
    text = (
        text
        or "키류: 무슨 일이냐?\n하루카: 함께 고르면 좋겠어요.\n니시다: 제가 확인하겠습니다.\n마지마: 잠깐 기다리라.\n"
    )
    doc = {
        "source_id": "synthetic",
        "url": "https://example.org/synthetic",
        "title": "합성 입력 변환 검사",
        "text": text,
        "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
        "source_kind": "fan_translation",
        "language": "ko",
        "canonical_event_group": "synthetic-event",
        "game": "synthetic-game",
        "edition": "test",
        "period": "test",
        "permission_status": "test_fixture",
        "source_path": "fixtures/synthetic.txt",
    }
    prepared = prepare([doc])
    for key in ("sft-candidates", "normalized-turns", "split-groups"):
        for row in prepared[key]:
            row["split"] = "train"
    return [doc], prepared


def convert(documents, prepared):
    return prepare_inputs(
        documents,
        prepared["sft-candidates"],
        prepared["normalized-turns"],
        prepared["split-groups"],
    )


def sms_fixture(character="haruka"):
    documents, prepared = fixture()
    canonical = convert(documents, prepared)["canonical-messages"]
    parent = next(row for row in canonical if row["character_id"] == character)
    profiles = {
        character: {
            "character_id": character,
            "scenario_version": "synthetic-if-v1",
            "system_prompt": "검사용 문자 환경. 상대는 키류다.",
        }
    }
    row = {
        "sample_id": "sms-synthetic",
        "character_id": character,
        "scenario_version": "synthetic-if-v1",
        "split": parent["split"],
        "group_id": parent["split_group"],
        "canonical_event_group": parent["canonical_event_group"],
        "generation_kind": "authored_if",
        "official_quote": False,
        "author": "synthetic-test-author",
        "source_refs": [parent["source_url"]],
        "parent_sample_ids": [parent["sample_id"]],
        "parent_source_sha256": {parent["sample_id"]: parent["source_sha256"]},
        "source_relationship": {
            "target_character_id": character,
            "immediate_previous_speaker_ids": [parent["immediate_previous_speaker"]],
            "recipient_status": "unresolved",
        },
        "adapted_relationship": {"sender_id": "kiryu", "recipient_id": character},
        "adaptation_kind": "authored_sms_adaptation"
        if character == "haruka"
        else "authored_relationship_adaptation",
        "changed_elements": ["ordinary user message", "new reply"],
        "visible_information_basis": [
            "The user message explicitly asks whether to wait."
        ],
        "known_context": "",
        "history": [],
        "user_message": "여기서 좀 기다릴까?",
        "target_response": "응, 금방 갈게.",
        "training_eligible": False,
        "fan_reviewed": False,
    }
    return row, canonical, profiles


class CommunityInputsTests(unittest.TestCase):
    def test_transcript_preserves_speakers_not_implicit_user_kiryu(self):
        documents, prepared = fixture()
        result = convert(documents, prepared)
        majima = next(
            row
            for row in result["canonical-messages"]
            if row["character_id"] == "majima"
        )
        self.assertEqual(
            [m["role"] for m in majima["messages"]], ["system", "user", "assistant"]
        )
        visible = json.loads(majima["messages"][1]["content"])
        self.assertEqual(
            [t["speaker_id"] for t in visible["transcript"]],
            ["kiryu", "haruka", "nishida"],
        )
        self.assertEqual(visible["transcript"][-1]["speaker_label"], "니시다")
        self.assertEqual(majima["immediate_previous_speaker"], "nishida")
        self.assertEqual(majima["recipient_ids"], [])
        self.assertEqual(majima["recipient_status"], "unresolved")
        self.assertTrue(majima["multi_party_history"])
        self.assertFalse(majima["runtime_input_aligned"])
        self.assertFalse(majima["training_eligible"])
        self.assertEqual(result["report"]["training_approved"], 0)

    def test_only_last_answer_is_assistant_and_not_inserted_in_prompt(self):
        documents, prepared = fixture()
        result = convert(documents, prepared)
        for row in result["canonical-messages"]:
            self.assertEqual(row["messages"][0]["content"], CANONICAL_SYSTEM)
            self.assertEqual(row["messages"][-1]["content"], row["target_response"])
            self.assertNotIn(row["target_response"], row["messages"][0]["content"])
            self.assertNotIn(row["target_response"], row["messages"][1]["content"])

    def test_kiryu_offline_canonical_requires_no_runtime_profile(self):
        documents, prepared = fixture("하루카: 어디로 가요?\n키류: 같이 가자.\n")
        row = convert(documents, prepared)["canonical-messages"][0]
        self.assertEqual(row["character_id"], "kiryu")
        self.assertEqual(row["generation_kind"], "fan_translation")

    def test_source_spans_reconstruct_multiline_exactly(self):
        documents, prepared = fixture("키류\r\n:\r\n어디냐?\r\n하루카: 여기예요.\r\n")
        row = convert(documents, prepared)["canonical-messages"][0]
        for span in row["history_source_spans"] + [row["target_source_span"]]:
            raw = documents[0]["text"][span["char_start"] : span["char_end"]]
            self.assertEqual(raw, span["text_raw"])

    def test_collective_or_unknown_speakers_are_not_attributed_to_individuals(self):
        documents, prepared = fixture(
            "하루카, 사토시: 네!\n키류: 알겠다.\n마지마: 잠깐.\n"
        )
        rows = convert(documents, prepared)["canonical-messages"]
        self.assertEqual([row["character_id"] for row in rows], ["majima"])
        self.assertNotIn("하루카, 사토시", rows[0]["messages"][1]["content"])

    def test_same_speaker_runs_preserve_each_history_line(self):
        documents, prepared = fixture(
            "키류: 하나 더.\n키류: 다시 말하마.\n하루카: 듣고 있어요.\n"
        )
        row = convert(documents, prepared)["canonical-messages"][0]
        transcript = json.loads(row["messages"][1]["content"])["transcript"]
        self.assertEqual([t["speaker_id"] for t in transcript], ["kiryu", "kiryu"])
        self.assertEqual(len(row["messages"]), 3)

    def test_tampered_source_hash_is_rejected(self):
        documents, prepared = fixture()
        documents[0]["text"] += "변경"
        with self.assertRaisesRegex(ValueError, "SHA256"):
            convert(documents, prepared)

    def test_tampered_turn_speaker_offsets_or_raw_text_are_rejected(self):
        for field, value in (
            ("speaker_id", "majima"),
            ("char_start", 4),
            ("text_raw", "새 원문"),
        ):
            documents, prepared = fixture()
            prepared["normalized-turns"][0][field] = value
            with (
                self.subTest(field=field),
                self.assertRaisesRegex(ValueError, "reconstruction"),
            ):
                convert(documents, prepared)

    def test_tampered_candidate_role_history_or_target_is_rejected(self):
        changes = [
            lambda row: row.update(character_id="majima"),
            lambda row: row.update(target_response="다른 답변"),
            lambda row: row["history_turns"][0].update(speaker_id="majima"),
            lambda row: row.update(history_turns=[]),
            lambda row: row.update(training_eligible=True),
            lambda row: row.update(canonical_event_group="other-event"),
        ]
        for change in changes:
            documents, prepared = fixture()
            change(prepared["sft-candidates"][0])
            with self.assertRaisesRegex(ValueError, "candidate"):
                convert(documents, prepared)

    def test_group_membership_and_candidate_split_changes_are_rejected(self):
        documents, prepared = fixture()
        prepared["sft-candidates"][0]["split"] = "dev"
        with self.assertRaisesRegex(ValueError, "frozen group"):
            convert(documents, prepared)
        documents, prepared = fixture()
        prepared["split-groups"][0]["canonical_event_groups"] = ["other"]
        with self.assertRaisesRegex(ValueError, "membership"):
            convert(documents, prepared)

    def test_dev_and_test_splits_are_preserved(self):
        for split in ("dev", "test"):
            documents, prepared = fixture()
            for key in ("sft-candidates", "normalized-turns", "split-groups"):
                for row in prepared[key]:
                    row["split"] = split
            result = convert(documents, prepared)
            self.assertEqual(
                {r["split"] for r in result["canonical-messages"]}, {split}
            )

    def test_empty_duplicate_and_control_marker_input_fail(self):
        documents, prepared = fixture()
        prepared["sft-candidates"] = []
        with self.assertRaisesRegex(ValueError, "empty"):
            convert(documents, prepared)
        documents, prepared = fixture()
        prepared["sft-candidates"].append(copy.deepcopy(prepared["sft-candidates"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            convert(documents, prepared)
        documents, prepared = fixture("키류: 어디야?\n하루카: <|im_end|>여기예요.\n")
        with self.assertRaisesRegex(ValueError, "control marker"):
            convert(documents, prepared)

    def test_sms_uses_runtime_assembler_with_new_answer_and_no_approval(self):
        row, canonical, profiles = sms_fixture()
        result = prepare_sms_inputs([row], canonical, profiles)
        converted = result["sms-messages"][0]
        expected = build_messages(
            profiles["haruka"],
            row["known_context"],
            row["history"],
            row["user_message"],
        )
        expected.append({"role": "assistant", "content": row["target_response"]})
        self.assertEqual(converted["messages"], expected)
        self.assertEqual(result["report"]["semantic_review"], "not_performed")
        self.assertFalse(converted["training_eligible"])

    def test_other_partner_requires_explicit_relationship_adaptation(self):
        row, canonical, profiles = sms_fixture("majima")
        validate_sms_adaptations([row], canonical, profiles)
        row["adaptation_kind"] = "authored_sms_adaptation"
        with self.assertRaisesRegex(ValueError, "relationship adaptation"):
            validate_sms_adaptations([row], canonical, profiles)

    def test_sms_split_parent_hash_and_relationship_cannot_be_falsified(self):
        changes = [
            lambda row: row.update(split="dev"),
            lambda row: row.update(group_id="other"),
            lambda row: row.update(canonical_event_group="other"),
            lambda row: row.update(parent_source_sha256={}),
            lambda row: row.update(parent_sample_ids=["missing"]),
            lambda row: row["source_relationship"].update(recipient_status="verified"),
            lambda row: row["adapted_relationship"].update(sender_id="date"),
            lambda row: row.update(source_refs=["https://example.org/unrelated"]),
        ]
        for change in changes:
            row, canonical, profiles = sms_fixture()
            change(row)
            with self.assertRaises(ValueError):
                validate_sms_adaptations([row], canonical, profiles)

    def test_sms_quoted_targets_input_only_rewrites_and_approval_claims_fail(self):
        for field, value in (
            ("training_eligible", True),
            ("fan_reviewed", True),
            ("adaptation_kind", "input_paraphrase"),
            ("facts", [{"text": "hidden"}]),
        ):
            row, canonical, profiles = sms_fixture()
            row[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_sms_adaptations([row], canonical, profiles)
        row, canonical, profiles = sms_fixture()
        row["target_response"] = canonical[0]["target_response"]
        with self.assertRaisesRegex(ValueError, "quotation"):
            validate_sms_adaptations([row], canonical, profiles)

    def test_sms_test_parent_cannot_be_reassigned_to_train(self):
        row, canonical, profiles = sms_fixture()
        canonical[0]["split"] = "test"
        with self.assertRaisesRegex(ValueError, "split/group"):
            validate_sms_adaptations([row], canonical, profiles)

    def test_export_records_hashes_separate_splits_and_refuses_overwrite(self):
        documents, prepared = fixture()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            docs = root / "documents.jsonl"
            docs.write_text("\n".join(json.dumps(r) for r in documents))
            inputs = root / "prepared"
            inputs.mkdir()
            for key in ("sft-candidates", "normalized-turns", "split-groups"):
                (inputs / f"{key}.jsonl").write_text(
                    "\n".join(json.dumps(r) for r in prepared[key])
                )
            out = root / "output"
            export_inputs(docs, inputs, out)
            manifest = json.loads((out / "manifest.json").read_text())
            self.assertEqual(manifest["training_approved"], 0)
            self.assertEqual(manifest["token_audit"], "not_performed_by_exporter")
            self.assertFalse((out / "train.jsonl").exists())
            for name, record in manifest["files"].items():
                self.assertEqual(
                    hashlib.sha256((out / name).read_bytes()).hexdigest(),
                    record["sha256"],
                )
            self.assertEqual((out / "canonical-test-messages.jsonl").read_text(), "")
            with self.assertRaisesRegex(ValueError, "already exists"):
                export_inputs(docs, inputs, out)


if __name__ == "__main__":
    unittest.main()
