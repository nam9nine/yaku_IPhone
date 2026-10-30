import copy
import json
import unittest

from kiryu_ai.chat_reader import EvidenceReader, validate_notes
from kiryu_ai.chat_retrieval import HybridRetriever
from kiryu_ai.gemma_engine import GemmaFailure


def fact(identifier, text, **extra):
    return {
        "id": identifier,
        "text": text,
        "kind": "fact",
        "fact_type": "historical_event",
        "scope_note": "과거 원작",
        "source": {"excerpt": text},
        "known_by": ["majima"],
        "scenarios": ["daily-if-v1"],
        "runtime_eligible": True,
        "approval": "agent-reviewed-experiment",
        **extra,
    }


class ReaderEngine:
    def __init__(self, value):
        self.value = value
        self.calls = []

    def count_tokens(self, messages):
        return len(json.dumps(messages, ensure_ascii=False)) // 3

    def reply(self, messages, **kwargs):
        self.calls.append((messages, kwargs))
        return {
            "reply": json.dumps(self.value, ensure_ascii=False),
            "finish_reason": "stop",
        }


class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.records = [
            fact("source-a", "가상의 인물은 친구의 제안을 받아 함께 출발했다.")
        ]
        self.notes = {
            "mode": "grounded",
            "notes": [{"id": "source-a", "field": "text"}],
            "answer": "친구의 제안을 받아 출발했습니다.",
            "unknowns": [],
        }

    def test_ids_and_fields_cannot_be_fabricated_or_authorized_by_the_model(self):
        self.assertEqual(
            validate_notes(self.notes, self.records)["notes"],
            [{"id": "source-a", "quote": self.records[0]["text"]}],
        )
        for field, value in (
            ("id", "other-visitor-secret"),
            ("id", ["source-a"]),
            ("field", "prompt"),
            ("field", ["text"]),
            ("field", None),
            ("field", "source_excerpt"),  # Missing from this raw fixture.
        ):
            with self.subTest(field=field, value=value):
                changed = copy.deepcopy(self.notes)
                changed["notes"][0][field] = value
                with self.assertRaises(ValueError):
                    validate_notes(changed, self.records)
        for note in ({"id": "source-a"}, {"id": "source-a", "quote": "창작"}):
            with self.assertRaises(ValueError):
                validate_notes({**self.notes, "notes": [note]}, self.records)
        for source in (None, "", "   ", 42):
            with self.assertRaises(ValueError):
                validate_notes(self.notes, [{"id": "source-a", "text": source}])
        with self.assertRaises(ValueError):
            validate_notes(
                {**self.notes, "notes": self.notes["notes"] * 2}, self.records
            )

    def test_code_supplies_exact_source_without_model_string_copy(self):
        source = "  ‘그때’\n도와줬다.  "
        notes = {**self.notes, "notes": [{"id": "source-a", "field": "source_excerpt"}]}
        before = copy.deepcopy(notes)
        resolved = validate_notes(notes, [{"id": "source-a", "source_excerpt": source}])
        self.assertEqual(resolved["notes"][0]["quote"], source)
        self.assertEqual(notes, before)

    def test_selected_conversation_quote_keeps_original_role_and_time(self):
        source = {
            "id": "conversation:past",
            "text": "그 계획은 취소",
            "role": "user",
            "time": "2026-10-02T11:00:00Z",
        }
        notes = {**self.notes, "notes": [{"id": source["id"], "field": "text"}]}
        resolved = validate_notes(notes, [source])["notes"][0]
        self.assertEqual(
            resolved,
            {
                "id": source["id"],
                "quote": source["text"],
                "role": source["role"],
                "time": source["time"],
            },
        )

    def test_new_arbitrary_source_requires_no_question_specific_code(self):
        engine = ReaderEngine(self.notes)
        notes, audit = EvidenceReader(engine).read(
            character="majima",
            question="함께 출발하게 된 계기는?",
            candidates=self.records,
            relationships=[],
            recent=[],
            memories=[],
            initial_state=None,
        )
        self.assertEqual(notes, validate_notes(self.notes, self.records))
        self.assertEqual(audit["selected_ids"], ["source-a"])
        self.assertFalse(audit["independent_fact_check"])
        self.assertEqual(engine.calls[0][1]["temperature"], 0)
        schema = engine.calls[0][1]["response_schema"]
        self.assertEqual(
            schema["properties"]["notes"]["items"]["enum"],
            [
                {"id": "source-a", "field": "text"},
                {"id": "source-a", "field": "source_excerpt"},
            ],
        )

    def test_invalid_note_does_not_fall_back_to_an_unverified_success(self):
        invalid = copy.deepcopy(self.notes)
        invalid["notes"][0]["id"] = "missing-source"
        with self.assertRaises(GemmaFailure) as caught:
            EvidenceReader(ReaderEngine(invalid)).read(
                character="majima",
                question="왜?",
                candidates=self.records,
                relationships=[],
                recent=[],
                memories=[],
                initial_state=None,
            )
        self.assertEqual(caught.exception.code, "grounding_invalid")
        self.assertEqual(caught.exception.result["grounding"]["stage"], "reader_failed")

    def test_budget_removes_whole_values_and_never_validates_a_dropped_source(self):
        records = self.records + [
            fact("long-" + str(i), "무관한 전체 원문 " * 400) for i in range(16)
        ]
        engine = ReaderEngine(self.notes)
        _, audit = EvidenceReader(engine).read(
            character="majima",
            question="출발 계기",
            candidates=records,
            relationships=[],
            recent=[],
            memories=[],
            initial_state=None,
        )
        self.assertLessEqual(audit["input_tokens"], 4096)
        self.assertGreater(len(audit["dropped_ids"]), 0)
        self.assertIn("source-a", audit["provided_ids"])

    def test_twelve_long_turns_do_not_evict_top_ranked_current_evidence(self):
        history = [
            {
                "id": f"turn-{i}",
                "role": "user" if i % 2 == 0 else "assistant",
                "content": "지난 잡담 " * 250,
            }
            for i in range(12)
        ]
        records = [fact("source-a", "실제 질문의 정답 근거. " * 100)]
        _, audit = EvidenceReader(ReaderEngine(self.notes)).read(
            character="majima",
            question="지금 질문의 정답은?",
            candidates=records,
            relationships=[],
            recent=history,
            memories=[],
            initial_state=None,
        )
        self.assertLessEqual(audit["input_tokens"], 4096)
        self.assertEqual(audit["provided_ids"], ["source-a"])
        self.assertIn("turn-0", audit["dropped_ids"])
        self.assertEqual(
            audit["recent_message_ids"][-4:], [f"turn-{i}" for i in range(8, 12)]
        )
        self.assertNotIn("source-a", audit["dropped_ids"])

    def test_memory_dates_and_correction_links_reach_the_reader_unchanged(self):
        memory = {
            "id": "memory:promise",
            "messages": [
                {
                    "id": "promise",
                    "role": "user",
                    "content": "카레 먹자",
                    "time": "2026-10-01T10:00:00Z",
                },
                {
                    "id": "cancel",
                    "role": "user",
                    "content": "그거 취소",
                    "time": "2026-10-02T11:00:00Z",
                },
            ],
            "date_filter": ["2026-10-01"],
            "correction_links": [
                {"message_id": "cancel", "certainty": "candidate-not-confirmed-state"}
            ],
            "memory_status": "past-utterances-not-current-facts",
        }
        recent = [
            {
                "id": "latest",
                "role": "user",
                "content": "오늘은?",
                "time": "2026-10-28T11:00:00Z",
            }
        ]
        original = copy.deepcopy(memory)
        _, audit = EvidenceReader(ReaderEngine(self.notes)).read(
            character="majima",
            question="10월 1일 약속은?",
            candidates=self.records,
            relationships=[],
            recent=recent,
            memories=[memory],
            initial_state=None,
        )
        payload = json.loads(audit["input_messages"][-1]["content"])
        window = payload["old_conversation_windows"][0]
        self.assertEqual(window["date_filter"], memory["date_filter"])
        self.assertEqual(window["correction_links"], memory["correction_links"])
        self.assertEqual(window["messages"][1]["time"], memory["messages"][1]["time"])
        self.assertEqual(payload["recent"][0]["time"], recent[0]["time"])
        self.assertEqual(memory, original)

    def test_engine_failure_has_prestarted_audit_and_private_partial(self):
        stages = []
        engine = ReaderEngine(self.notes)

        def fail(messages, **kwargs):
            self.assertEqual(stages[-1]["stage"], "reader_generating")
            raise GemmaFailure("response_truncated", {"reply": "PRIVATE_FRAGMENT"})

        engine.reply = fail
        with self.assertRaises(GemmaFailure) as caught:
            EvidenceReader(engine).read(
                character="majima",
                question="왜?",
                candidates=self.records,
                relationships=[],
                recent=[],
                memories=[],
                initial_state=None,
                on_stage=stages.append,
            )
        failure = caught.exception
        self.assertEqual(failure.result["reply"], "PRIVATE_FRAGMENT")
        self.assertEqual(failure.result["grounding"]["candidate_ids"], ["source-a"])
        self.assertEqual(
            [stage["stage"] for stage in stages],
            ["reader_preparing", "reader_generating", "reader_failed"],
        )
        self.assertNotIn("reader_result", stages[1])

    def test_counting_and_budget_failures_also_keep_the_audit(self):
        for fail_counting in (False, True):
            engine = ReaderEngine(self.notes)

            def count(messages, fail_counting=fail_counting):
                if fail_counting:
                    raise GemmaFailure("model_offline")
                return 5000

            engine.count_tokens = count
            stages = []
            with self.assertRaises(GemmaFailure) as caught:
                EvidenceReader(engine).read(
                    character="majima",
                    question="왜?",
                    candidates=self.records,
                    relationships=[],
                    recent=[],
                    memories=[],
                    initial_state=None,
                    on_stage=stages.append,
                )
            self.assertEqual(
                caught.exception.result["grounding"]["stage"], "reader_failed"
            )
            self.assertEqual(stages[0]["stage"], "reader_preparing")
            self.assertFalse(engine.calls)

    def test_candidate_event_edges_never_cross_character_authorization(self):
        records = [
            fact(
                "anchor",
                "친구와 배를 타고 여행했다.",
                event_id="trip",
                related_ids=["private"],
            ),
            fact(
                "private",
                "다른 인물의 비공개 여행",
                event_id="trip",
                known_by=["haruka"],
            ),
            fact("goal", "도시로 여행하라.", event_id="trip", runtime_eligible=False),
        ]
        got = HybridRetriever({"records": records}).candidates(
            "majima", "daily-if-v1", "배 여행", "배 여행"
        )
        self.assertEqual([r["id"] for r in got], ["anchor"])

    def test_context_is_a_search_key_but_original_value_stays_intact(self):
        row = fact(
            "x", "그곳에서 지배인으로 일했다.", context="소텐보리 그랜드의 과거 경력"
        )
        got = HybridRetriever({"records": [row]}).candidates(
            "majima", "daily-if-v1", "그랜드", "그랜드"
        )
        self.assertEqual(got[0]["text"], row["text"])
        self.assertIn("소텐보리", got[0]["search_text"])


if __name__ == "__main__":
    unittest.main()
