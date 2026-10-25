"""Synthetic evidence-boundary tests; no collected dialogue is bundled."""

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from kiryu_ai.curation import (
    export_canonical,
    ocr_dispositions,
    release_canonical,
    release_sms,
    validate_review_sources,
)
from kiryu_ai.data import digest
from test_community_inputs import convert, fixture, sms_fixture


def corpus():
    documents, prepared = fixture(
        "키류: 2007년이야.\n하루카: 확인했어요.\n니시다: 기다리겠습니다.\n마지마: 가상의 마지막 발화다.\n하루카: 합성 추가 발화예요.\n"
    )
    rows = convert(documents, prepared)["canonical-messages"]
    return documents, prepared, rows


def approval(row, verdict="approve"):
    return {
        "sample_id": row["sample_id"],
        "canonical_row_sha256": digest(row),
        "source_text_sha256": row["source_sha256"],
        "reviewer": "synthetic-independent-reviewer",
        "reviewer_is_author": False,
        "basis": "Synthetic source spans and actual speaker sequence were checked.",
        "source_refs": copy.deepcopy(
            row["history_source_spans"] + [row["target_source_span"]]
        ),
        "fan_reviewed": False,
        "official_localization_verified": False,
        "verdict": verdict,
        "approved_task": "canonical_dialogue_continuation",
        "review_type": "agent_source_semantic",
        "recipient_status": "unresolved",
        "game_scope": {"game": row["game"], "edition": row["edition"]},
        "period_scope": {"status": "unresolved", "value": None},
    }


def write_jsonl(path, rows):
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))


def export_paths(root, documents, prepared, candidates, reviews):
    inputs = root / "prepared"
    inputs.mkdir()
    for name in ("sft-candidates", "normalized-turns", "split-groups"):
        write_jsonl(inputs / f"{name}.jsonl", prepared[name])
    docs = root / "documents.jsonl"
    write_jsonl(docs, documents)
    rows = root / "candidates.jsonl"
    write_jsonl(rows, candidates)
    ledger = root / "reviews.jsonl"
    write_jsonl(ledger, reviews)
    return rows, ledger, root / "release", docs, inputs


class CanonicalCurationTests(unittest.TestCase):
    def test_source_citations_cannot_use_unknown_hash_or_out_of_bounds_spans(self):
        documents, prepared, rows = corpus()
        for field, value in (
            ("source_id", "unknown"),
            ("source_sha256", "wrong"),
            ("line_start", -1),
            ("line_end", 99999),
            ("line_start", True),
            ("char_start", 1),
            ("text_raw", "fabricated citation"),
        ):
            reviews = [approval(row) for row in rows]
            reviews[0]["source_refs"][0][field] = value
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                args = export_paths(Path(directory), documents, prepared, rows, reviews)
                with self.assertRaises(ValueError):
                    export_canonical(*args)
                self.assertFalse(args[2].exists())

    def test_period_evidence_requires_a_resolvable_source_span(self):
        documents, _, rows = corpus()
        review = approval(rows[0])
        review["period_scope"] = {
            "status": "source_stated",
            "value": "2007",
            "evidence_refs": [{"source_id": "missing"}],
        }
        with self.assertRaisesRegex(ValueError, "unknown source"):
            validate_review_sources([review], documents)

    def test_missing_hold_and_reject_reviews_never_export_training_rows(self):
        _, _, rows = corpus()
        result = release_canonical(
            rows, [approval(rows[1], "hold"), approval(rows[2], "reject")]
        )
        self.assertEqual(
            [r["state"] for r in result["dispositions"]],
            ["unreviewed", "reviewed_hold", "rejected"],
        )
        self.assertTrue(all(not values for values in result["splits"].values()))
        self.assertEqual(result["provenance"], [])
        self.assertFalse(result["report"]["all_semantically_reviewed"])

    def test_approval_preserves_other_speakers_and_original_answer(self):
        _, _, rows = corpus()
        target = next(row for row in rows if row["character_id"] == "majima")
        before = copy.deepcopy(target)
        result = release_canonical([target], [approval(target)])
        messages = result["splits"]["train"][0]["messages"]
        visible = json.loads(messages[-2]["content"])
        self.assertEqual(
            [t["speaker_id"] for t in visible["transcript"]],
            ["kiryu", "haruka", "nishida"],
        )
        self.assertEqual(messages[-1]["content"], target["target_response"])
        self.assertEqual(target, before)
        self.assertNotIn(target["target_response"], messages[-2]["content"])
        provenance = result["provenance"][0]
        self.assertEqual(provenance["exported_messages_sha256"], digest(messages))
        self.assertFalse(provenance["runtime_sms_aligned"])
        self.assertEqual(provenance["recipient_status"], "unresolved")
        self.assertEqual(
            provenance["quote_origin"], "source_verified_korean_fan_translation"
        )

    def test_stale_candidate_or_source_hash_and_unknown_ids_fail_closed(self):
        _, _, rows = corpus()
        for field in ("canonical_row_sha256", "source_text_sha256", "sample_id"):
            review = approval(rows[0])
            review[field] = "different-source-or-row"
            with self.subTest(field=field), self.assertRaises(ValueError):
                release_canonical(rows, [review])
        with self.assertRaises(ValueError):
            release_canonical(rows + [copy.deepcopy(rows[0])], [])
        with self.assertRaises(ValueError):
            release_canonical(rows, [approval(rows[0]), approval(rows[0])])

    def test_approval_cannot_impersonate_fan_official_or_author_review(self):
        _, _, rows = corpus()
        mutations = [
            ("fan_reviewed", True),
            ("official_localization_verified", True),
            ("reviewer_is_author", True),
            ("review_type", "self_check"),
            ("reviewer", ""),
            ("basis", ""),
            ("source_refs", []),
        ]
        for field, value in mutations:
            review = approval(rows[0])
            review[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                release_canonical(rows, [review])
        authored = copy.deepcopy(rows[0])
        authored["author"] = "synthetic-independent-reviewer"
        with self.assertRaises(ValueError):
            release_canonical([authored], [approval(authored)])

    def test_wrong_task_origin_recipient_or_unreconstructed_row_is_rejected(self):
        _, _, rows = corpus()
        mutations = [
            ("task_kind", "phone_sms"),
            ("generation_kind", "authored_if"),
            ("official_korean_quote_verified", True),
            ("source_reconstruction_verified", False),
            ("recipient_ids", ["kiryu"]),
            ("recipient_status", "verified"),
        ]
        for field, value in mutations:
            row = copy.deepcopy(rows[0])
            row[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                release_canonical([row], [approval(row)])
        review = approval(rows[0])
        review["approved_task"] = "phone_sms"
        with self.assertRaises(ValueError):
            release_canonical(rows, [review])

    def test_review_cannot_reassign_game_or_translation_edition(self):
        _, _, rows = corpus()
        for field in ("game", "edition"):
            review = approval(rows[0])
            review["game_scope"][field] = "different-edition"
            with self.subTest(field=field), self.assertRaises(ValueError):
                release_canonical(rows, [review])

    def test_same_event_cannot_cross_split_and_held_out_test_stays_separate(self):
        _, _, rows = corpus()
        leaked = copy.deepcopy(rows)
        leaked[1]["split"] = "test"
        with self.assertRaises(ValueError):
            release_canonical(leaked, [approval(row) for row in leaked])
        held_out = copy.deepcopy(rows)
        for row in held_out:
            row["split"] = "test"
        result = release_canonical(held_out, [approval(row) for row in held_out])
        self.assertEqual(result["splits"]["train"], [])
        self.assertEqual(result["splits"]["dev"], [])
        self.assertEqual(len(result["splits"]["test"]), len(held_out))
        self.assertFalse(result["report"]["test_is_training"])

    def test_later_period_evidence_and_review_prose_never_enter_model_input(self):
        _, _, rows = corpus()
        target = rows[0]
        start = target["target_source_span"]["line_start"]
        evidence = {
            "source_id": target["source_id"],
            "source_text_sha256": target["source_sha256"],
            "line_start": start + 1,
            "line_end": start + 2,
        }
        review = approval(target)
        review["basis"] = (
            "FUTURE_REVIEW_ONLY_SENTINEL: later outcome does not belong in prior context."
        )
        review["period_scope"] = {
            "status": "source_stated",
            "value": "2099-FUTURE",
            "evidence_refs": [evidence],
        }
        result = release_canonical([target], [review])
        prompt = result["splits"]["train"][0]["messages"][-2]["content"]
        self.assertNotIn("FUTURE_REVIEW_ONLY_SENTINEL", prompt)
        self.assertNotIn("2099-FUTURE", prompt)
        self.assertEqual(
            json.loads(prompt)["source_context"]["period"],
            {"value": None, "status": "unresolved"},
        )
        self.assertEqual(
            result["provenance"][0]["period_scope"], review["period_scope"]
        )

    def test_prior_period_requires_same_source_hash_and_pre_target_span(self):
        _, _, rows = corpus()
        target = rows[0]
        ref = {
            "source_id": target["source_id"],
            "source_text_sha256": target["source_sha256"],
            "line_start": 0,
            "line_end": 1,
        }
        variants = [
            ({}, True),
            ({"source_id": "other"}, False),
            ({"source_text_sha256": "wrong"}, False),
            ({"line_start": -1}, False),
            ({"line_end": target["target_source_span"]["line_end"]}, False),
        ]
        for changes, accepted in variants:
            review = approval(target)
            review["period_scope"] = {
                "status": "source_stated",
                "value": "2007년",
                "evidence_refs": [{**ref, **changes}],
            }
            result = release_canonical([target], [review])
            context = json.loads(
                result["splits"]["train"][0]["messages"][-2]["content"]
            )["source_context"]
            with self.subTest(changes=changes):
                self.assertEqual(
                    context["period"]["value"], "2007년" if accepted else None
                )

    def test_export_reconstructs_source_instead_of_trusting_rehashed_approval(self):
        changes = [
            lambda docs, prepared, rows: docs[0].update(text=docs[0]["text"] + "변조"),
            lambda docs, prepared, rows: rows[0].update(target_response="임의 새 답변"),
            lambda docs, prepared, rows: prepared["normalized-turns"][0].update(
                text_raw="잘못된 원문"
            ),
            lambda docs, prepared, rows: rows[0]["messages"][1].update(
                content=rows[0]["messages"][1]["content"].replace(
                    "canonical_dialogue_continuation", "phone_sms"
                )
            ),
        ]
        for change in changes:
            documents, prepared, rows = corpus()
            change(documents, prepared, rows)
            with tempfile.TemporaryDirectory() as directory:
                args = export_paths(
                    Path(directory),
                    documents,
                    prepared,
                    rows,
                    [approval(row) for row in rows],
                )
                with self.assertRaises(ValueError):
                    export_canonical(*args)
                self.assertFalse(args[2].exists())

    def test_export_hashes_outputs_keeps_test_out_of_training_and_refuses_overwrite(
        self,
    ):
        documents, prepared, rows = corpus()
        for name in ("sft-candidates", "normalized-turns", "split-groups"):
            for row in prepared[name]:
                row["split"] = "test"
        rows = convert(documents, prepared)["canonical-messages"]
        with tempfile.TemporaryDirectory() as directory:
            args = export_paths(
                Path(directory),
                documents,
                prepared,
                rows,
                [approval(row) for row in rows],
            )
            report = export_canonical(*args)
            output = args[2]
            self.assertEqual((output / "canonical/train.jsonl").read_text(), "")
            self.assertEqual((output / "canonical/valid.jsonl").read_text(), "")
            self.assertEqual(
                len(
                    (output / "evaluation/canonical-test.jsonl")
                    .read_text()
                    .splitlines()
                ),
                len(rows),
            )
            for name, expected in report["files"].items():
                self.assertEqual(
                    hashlib.sha256((output / name).read_bytes()).hexdigest(), expected
                )
            self.assertFalse(report["fan_approved"])
            with self.assertRaises(FileExistsError):
                export_canonical(*args)


class OCRDispositionTests(unittest.TestCase):
    def setUp(self):
        self.image = {
            "image_sha256": "synthetic-image",
            "raw_ocr_text": "합성 이름표와 대사",
            "sources": [{"source_id": "synthetic-source"}],
        }
        self.review = {
            "image_sha256": self.image["image_sha256"],
            "image_record_sha256": digest(self.image),
            "reviewer": "synthetic-visual-agent",
            "basis": "Synthetic explicit nameplate and text inspected.",
            "human_reviewed": False,
            "state": "verified_quote",
            "source_language": "ko",
            "speaker_evidence_kind": "explicit_nameplate",
            "speaker_id": "haruka",
            "corrected_text": "합성 검사용 발화.",
            "evidence_refs": ["synthetic-image-region"],
        }

    def test_verified_quote_is_never_automatically_sft_and_missing_review_is_unreviewed(
        self,
    ):
        second = {**self.image, "image_sha256": "second-unreviewed"}
        result = ocr_dispositions([self.image, second], [self.review])
        self.assertEqual([r["state"] for r in result], ["verified_quote", "unreviewed"])
        self.assertTrue(all(r["training_eligible"] is False for r in result))

    def test_stale_image_review_unknown_ids_and_duplicate_reviews_fail(self):
        changed = copy.deepcopy(self.image)
        changed["raw_ocr_text"] += "수정"
        with self.assertRaises(ValueError):
            ocr_dispositions([changed], [self.review])
        unknown = {**self.review, "image_sha256": "missing"}
        with self.assertRaises(ValueError):
            ocr_dispositions([self.image], [unknown])
        with self.assertRaises(ValueError):
            ocr_dispositions([self.image], [self.review, self.review])

    def test_quote_requires_korean_visible_label_and_never_accepts_human_or_sft_claim(
        self,
    ):
        for field, value in [
            ("source_language", "ja"),
            ("speaker_evidence_kind", "visible_face"),
            ("speaker_evidence_kind", "explicit_sender"),
            ("speaker_id", ""),
            ("corrected_text", ""),
            ("evidence_refs", []),
            ("human_reviewed", True),
            ("state", "training_approved"),
        ]:
            row = {**self.review, field: value}
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                ocr_dispositions([self.image], [row])

    def test_mail_and_unresolved_scenes_can_be_references_without_becoming_quotes(self):
        mail = {
            **self.review,
            "state": "reference_only",
            "speaker_evidence_kind": "explicit_sender",
        }
        held = {
            **self.review,
            "state": "reviewed_hold",
            "speaker_evidence_kind": "unresolved",
            "speaker_id": None,
        }
        for review in (mail, held):
            result = ocr_dispositions([self.image], [review])[0]
            self.assertEqual(result["state"], review["state"])
            self.assertFalse(result["training_eligible"])


class AuthoredSMSReleaseTests(unittest.TestCase):
    def setUp(self):
        self.row, self.canonical, self.profiles = sms_fixture()
        self.file_hash = "synthetic-profiles-file-sha256"
        self.approved_parents = release_canonical(
            self.canonical, [approval(row) for row in self.canonical]
        )["provenance"]
        parents = {row["sample_id"]: row for row in self.canonical}
        self.review = {
            "sample_id": self.row["sample_id"],
            "sha256": digest(self.row),
            "profiles_file_sha256": self.file_hash,
            "character_profile_sha256": digest(self.profiles[self.row["character_id"]]),
            "reviewer": "synthetic-sms-independent-reviewer",
            "independent_of_sms_author": True,
            "fan_reviewed": False,
            "verdict": "agent_review_pass",
            "basis": "Synthetic authored reply and source relationship checked separately.",
            "parent_candidate_sha256": {
                pid: parents[pid]["candidate_sha256"]
                for pid in self.row["parent_sample_ids"]
            },
        }

    def release(self, **changes):
        values = {
            "rows": [self.row],
            "reviews": [self.review],
            "canonical": self.canonical,
            "canonical_approvals": self.approved_parents,
            "profiles": self.profiles,
            "profiles_hash": self.file_hash,
        }
        values.update(changes)
        return release_sms(**values)

    def test_authored_sms_is_separate_from_quotes_and_not_a_quality_benchmark(self):
        before = copy.deepcopy(self.row)
        result = self.release()
        messages = result["splits"]["train"][0]["messages"]
        self.assertEqual(messages[-2]["content"], self.row["user_message"])
        self.assertEqual(messages[-1]["content"], self.row["target_response"])
        self.assertEqual(self.row, before)
        provenance = result["provenance"][0]
        self.assertEqual(provenance["task_kind"], "authored_if_sms")
        self.assertEqual(provenance["quote_origin"], "newly_authored_if_not_game_quote")
        self.assertEqual(provenance["approval_scope"], "offline_sms_experiment")
        self.assertFalse(provenance["fan_reviewed"])
        self.assertFalse(result["standalone_quality_evaluation_ready"])
        self.assertEqual(result["independent_event_groups"], 1)

    def test_stale_sms_answer_profile_file_or_profile_content_invalidates_review(self):
        changed = copy.deepcopy(self.row)
        changed["target_response"] = "변경된 합성 답변."
        changed_profile = copy.deepcopy(self.profiles)
        changed_profile[self.row["character_id"]]["system_prompt"] += " 변경됨."
        for changes in (
            {"rows": [changed]},
            {"profiles_hash": "new-file-hash"},
            {"profiles": changed_profile},
        ):
            with self.subTest(changes=tuple(changes)), self.assertRaises(ValueError):
                self.release(**changes)

    def test_sms_requires_independent_agent_review_and_exact_review_membership(self):
        for field, value in [
            ("reviewer", self.row["author"]),
            ("independent_of_sms_author", False),
            ("fan_reviewed", True),
            ("verdict", "fan_approved"),
            ("basis", ""),
            ("sample_id", "unknown-sms"),
        ]:
            review = {**self.review, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.release(reviews=[review])
        for reviews in ([], [self.review, self.review]):
            with self.assertRaises(ValueError):
                self.release(reviews=reviews)

    def test_unapproved_parent_and_approval_scope_or_task_impersonation_fail(self):
        with self.assertRaises(ValueError):
            self.release(canonical_approvals=[])
        forged = [
            {"sample_id": self.row["parent_sample_ids"][0], "state": "reviewed_hold"}
        ]
        with self.assertRaises(ValueError):
            self.release(canonical_approvals=forged)
        for field, value in [
            ("approval_scope", "offline_sms_experiment"),
            ("task_kind", "authored_if_sms"),
            ("candidate_sha256", "stale-canonical-row"),
        ]:
            parents = copy.deepcopy(self.approved_parents)
            parents[0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.release(canonical_approvals=parents)

    def test_parent_row_change_is_rejected_even_if_old_candidate_hash_is_retained(self):
        parents = copy.deepcopy(self.canonical)
        parents[0]["messages"][0]["content"] += " modified canonical context"
        self.assertEqual(
            parents[0]["candidate_sha256"], self.canonical[0]["candidate_sha256"]
        )
        with self.assertRaises(ValueError):
            self.release(canonical=parents)
        stale_review = copy.deepcopy(self.review)
        stale_review["parent_candidate_sha256"] = {}
        with self.assertRaises(ValueError):
            self.release(reviews=[stale_review])


if __name__ == "__main__":
    unittest.main()
