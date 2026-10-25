import copy
import json
import tempfile
import unittest
from pathlib import Path

from kiryu_ai.chat_prompt import (
    DEFAULT_DATA,
    ChatPromptBuilder,
    InputBudgetError,
    reconstruct_input,
)
from kiryu_ai.chat_retrieval import HybridRetriever, load_registry, normalize


def history(pairs):
    return [
        {"id": f"m{i}-{role}", "role": role, "content": text, "time": str(i)}
        for i, pair in enumerate(pairs)
        for role, text in zip(("user", "assistant"), pair, strict=True)
    ]


class RecordingEncoder:
    def __init__(self):
        self.seen = []

    def encode(self, texts, *, query=False):
        if not query:
            self.seen.extend(texts)
        return [[1.0, 0.0] for _ in texts]


class TopicEncoder:
    """Controlled embeddings make a long unrelated recent topic dominate."""

    def encode(self, texts, *, query=False):
        return [
            [0.0, 1.0]
            if "야구" in text
            else [1.0, 0.0]
            if "자전거" in text
            else [0.0, 0.0]
            for text in texts
        ]


class PromptTests(unittest.TestCase):
    def setUp(self):
        self.builder = ChatPromptBuilder()

    def build(self, current="안녕", past=None, **kwargs):
        return self.builder.build(
            "visitor-a",
            "haruka",
            "daily-if-v1",
            current,
            past or [],
            count_tokens=kwargs.pop("count_tokens", lambda messages: 100),
            **kwargs,
        )

    def test_native_roles_and_current_message_are_not_original_scene(self):
        past = history([("우동으로 바꾸자", "그럼 우동으로 해요.")])
        result = self.build("고기는 예산 때문에 빼자", past)
        self.assertEqual(
            [m["role"] for m in result["messages"]],
            ["system", "user", "assistant", "user"],
        )
        self.assertEqual(result["messages"][1]["content"], "우동으로 바꾸자")
        self.assertIn('"고기는 예산 때문에 빼자"', result["messages"][-1]["content"])
        self.assertIn(
            "reference_scenes_not_our_history", result["messages"][-1]["content"]
        )
        self.assertIn(
            "현재 메뉴나 재고로 매번 확정하지", result["messages"][0]["content"]
        )
        self.assertEqual(
            result["metadata"]["input_message_ids"], [m["id"] for m in past]
        )

    def test_corrections_beyond_top_k_follow_old_promise(self):
        past = history(
            [
                ("카레 재료를 사서 저녁을 만들자", "좋아요. 제가 카레를 만들게요."),
                ("카레 말고 우동으로 바꾸자", "네, 우동 재료로 바꿔요."),
                *[(f"노래 {i}를 들었어", "그 노래 좋죠.") for i in range(12)],
            ]
        )
        result = self.build("전에 사기로 한 카레 재료가 뭐였지?", past)
        payload = result["messages"][-1]["content"]
        self.assertIn("카레 말고 우동으로 바꾸자", payload)
        memory = [x for x in result["retrieval_hits"] if x["kind"] == "memory"]
        self.assertTrue(memory)
        self.assertTrue(any(x["correction_links"] for x in memory))
        self.assertTrue(
            all(x["scope"] == ["visitor-a", "haruka", "daily-if-v1"] for x in memory)
        )

    def test_ambiguous_cancellation_keeps_adjacent_raw_context(self):
        past = history(
            [
                ("수요일에 카레 재료 사러 가자", "알겠어요."),
                ("그거 취소하자", "네, 취소할게요."),
                *[(f"다른 이야기 {i}", "응.") for i in range(8)],
            ]
        )
        result = self.build("수요일에 카레 사기로 했었지?", past)
        self.assertIn("그거 취소하자", result["messages"][-1]["content"])
        self.assertIn(
            "candidate-not-confirmed-state", result["messages"][-1]["content"]
        )

    def test_assistant_originated_proposal_keeps_later_user_correction(self):
        # Independent review reproduction: only the assistant names the old
        # menu. The later correction is outside both recent history and the
        # retrieved proposal's immediate neighbors.
        past = history(
            [
                ("뭐 먹을까", "카레 재료 준비는 내게 맡겨요."),
                ("믿고 맡길게", "카레 재료 준비 도와줄게요."),
                *[(f"ZXQ{i}", f"WVP{i}") for i in range(5)],
                ("카레 말고 우동으로 바꾸자", "네, 우동으로 바꿀게요."),
                *[(f"BFR{i}", f"NZX{i}") for i in range(9)],
            ]
        )
        original = copy.deepcopy(past)
        result = self.build("카레 재료 준비", past)
        memories = [hit for hit in result["retrieval_hits"] if hit["kind"] == "memory"]
        self.assertEqual(
            {hit["id"] for hit in memories}, {"memory:m0-user", "memory:m1-user"}
        )
        for memory in memories:
            self.assertIn("m7-user", memory["message_ids"])
            self.assertIn("m7-assistant", memory["message_ids"])
            self.assertIn(
                {
                    "message_id": "m7-user",
                    "resolution": "lexical-link",
                    "certainty": "candidate-not-confirmed-state",
                },
                memory["correction_links"],
            )
        envelope = result["messages"][-1]["content"]
        self.assertIn("카레 말고 우동으로 바꾸자", envelope)
        self.assertIn("카레 재료 준비는 내게 맡겨요.", envelope)
        self.assertIn("past-utterances-not-current-facts", envelope)
        self.assertNotIn("구매 완료", envelope)
        self.assertEqual(past, original)

    def test_pronoun_correction_reads_previous_assistant_topic(self):
        past = history(
            [
                ("카레 재료 준비", "좋아요."),
                *[(f"ZXQ{i}", f"WVP{i}") for i in range(5)],
                ("다시 말해줘", "카레 재료를 준비할게요."),
                ("그거 취소하자", "네."),
                *[(f"BFR{i}", f"NZX{i}") for i in range(9)],
            ]
        )
        result = self.build("카레 재료 준비", past)
        memory = next(
            hit for hit in result["retrieval_hits"] if hit["id"] == "memory:m0-user"
        )
        correction = next(
            link
            for link in memory["correction_links"]
            if link["message_id"] == "m7-user"
        )
        self.assertEqual(correction["resolution"], "nearby-reference")
        self.assertIn("m6-assistant", memory["message_ids"])

    def test_assistant_named_replacement_keeps_following_correction(self):
        past = history(
            [
                ("카레 재료 준비", "좋아요."),
                ("카레 말고 다른 메뉴로 바꾸자", "그럼 우동을 만들게요."),
                *[(f"ZXQ{i}", f"WVP{i}") for i in range(5)],
                ("우동 취소하고 소바로 바꾸자", "소바로 바꿀게요."),
                *[(f"BFR{i}", f"NZX{i}") for i in range(9)],
            ]
        )
        result = self.build("카레 재료 준비", past)
        memory = next(
            hit for hit in result["retrieval_hits"] if hit["id"] == "memory:m0-user"
        )
        self.assertTrue(
            {"m1-user", "m7-user"}
            <= {link["message_id"] for link in memory["correction_links"]}
        )
        self.assertIn("우동 취소하고 소바로 바꾸자", result["messages"][-1]["content"])

    def test_current_named_topic_survives_unrelated_recent_exchange_dominance(self):
        self.builder = ChatPromptBuilder(
            retriever=HybridRetriever(DEFAULT_DATA / "registry.json", TopicEncoder())
        )
        past = history(
            [
                ("이번 주말에 뭘 할까", "토요일에는 자전거 수리를 맡길게요."),
                ("토요일 말고 일요일에 자전거 수리 맡기자", "알겠어요."),
                *[
                    (
                        f"야구 선수 타자 투수 경기 중계 이야기 {i}",
                        "타자가 안타를 쳤고 투수가 공을 던졌어. 오늘 야구 경기는 흥미롭네.",
                    )
                    for i in range(22)
                ],
            ]
        )
        result = self.build("자전거 수리 요일은?", past)
        memory = [hit for hit in result["retrieval_hits"] if hit["kind"] == "memory"]
        self.assertTrue(memory)
        self.assertLessEqual(len(memory), 2)
        self.assertEqual(len({hit["id"] for hit in memory}), len(memory))
        self.assertTrue({"m0-assistant", "m1-user"} <= set(memory[0]["message_ids"]))
        self.assertIn("일요일에 자전거 수리 맡기자", result["messages"][-1]["content"])

    def test_pronoun_query_still_uses_recent_topic_for_memory(self):
        self.builder = ChatPromptBuilder(
            retriever=HybridRetriever(DEFAULT_DATA / "registry.json", TopicEncoder())
        )
        past = history(
            [("자전거 수리는 일요일이야", "일요일에 맡길게요.")]
            + [(f"야구 이야기 {i}", "경기가 재미있었어요.") for i in range(12)]
            + [
                ("자전거 이야기로 돌아가자", "자전거 수리 말씀이죠?"),
                ("응", "먼저 정해 둔 일정이 있었죠."),
            ]
        )
        result = self.build("그거 언제였지?", past)
        self.assertTrue(
            any(hit["id"] == "memory:m0-user" for hit in result["retrieval_hits"])
        )
        self.assertIn("자전거 수리는 일요일이야", result["messages"][-1]["content"])

    def test_unrelated_corrections_do_not_evict_relevant_old_memory(self):
        pairs = [("카레 재료를 사자", "좋아요."), ("카레 말고 우동으로 바꾸자", "네.")]
        pairs += [
            (f"커피 {i} 말고 홍차로 바꾸자. " + "산책 이야기 " * 30, "알겠어.")
            for i in range(25)
        ]
        pairs += [("음악 들었어", "응") for _ in range(6)]
        result = self.build(
            "전에 정한 카레 재료였지?",
            history(pairs),
            count_tokens=lambda messages: sum(len(m["content"]) for m in messages) // 2,
        )
        memories = [h for h in result["retrieval_hits"] if h["kind"] == "memory"]
        self.assertTrue(memories)
        self.assertTrue(any("m1-user" in h["message_ids"] for h in memories))
        self.assertTrue(all(len(h["message_ids"]) <= 10 for h in memories))
        self.assertNotIn("m20-user", result["messages"][-1]["content"])

    def test_replacement_chain_keeps_later_new_subject_correction(self):
        past = history(
            [
                ("카레를 사자", "응"),
                ("카레 말고 우동으로 바꾸자", "응"),
                ("우동도 취소하고 소바로 바꾸자", "응"),
                *[("노래", "응") for _ in range(8)],
            ]
        )
        result = self.build("전에 카레 이야기 했지?", past)
        self.assertIn(
            "우동도 취소하고 소바로 바꾸자", result["messages"][-1]["content"]
        )

    def test_explicit_iso_date_filters_memory_anchors_in_seoul_time(self):
        past = history(
            [("카레를 사자", "응"), ("카레를 많이 사자", "응")]
            + [("산책", "응") for _ in range(6)]
        )
        for m in past[:2]:
            m["time"] = "2026-10-20T16:00:00Z"
        for m in past[2:]:
            m["time"] = "2026-10-22T01:00:00+09:00"
        result = self.build("2026-10-21에 말했던 카레 기억나?", past)
        memories = [h for h in result["retrieval_hits"] if h["kind"] == "memory"]
        self.assertEqual([h["id"] for h in memories], ["memory:m0-user"])
        self.assertEqual(memories[0]["date_filter"], ["2026-10-21"])
        self.assertIn("2026-10-20T16:00:00Z", result["messages"][-1]["content"])

    def test_never_infers_action_completion_or_changes_originals(self):
        past = history([("우유 좀 사다 줘", "사올게요.")])
        before = copy.deepcopy(past)
        result = self.build("샀어?", past)
        self.assertEqual(past, before)
        self.assertEqual(result["messages"][2]["content"], "사올게요.")
        self.assertNotIn("구매 완료", result["messages"][-1]["content"])

    def test_audit_reconstruction_checks_original_message_hash(self):
        past = history([("우동으로 바꾸자", "네, 우동으로 해요.")])
        result = self.build("그거 언제 먹을까?", past)
        self.assertEqual(
            reconstruct_input(result["metadata"], past), result["messages"]
        )
        tampered = copy.deepcopy(past)
        tampered[0]["content"] = "카레로 바꾸자"
        with self.assertRaises(ValueError):
            reconstruct_input(result["metadata"], tampered)

    def test_scope_and_unsuccessful_history_fail_closed(self):
        for field, value in [
            ("visitor_id", "visitor-b"),
            ("character_id", "majima"),
            ("scenario_version", "other"),
            ("status", "error"),
        ]:
            past = history([("문자", "답장")])
            past[0][field] = value
            with self.assertRaises(ValueError):
                self.build(past=past)
        with self.assertRaises(ValueError):
            self.build(past=[{"id": "x", "role": "user", "content": "접수만 됨"}])

    def test_counter_budget_keeps_current_user_and_system_intact(self):
        past = history([(f"old{i}", f"reply{i}") for i in range(10)])
        calls = []

        def counter(messages):
            calls.append(copy.deepcopy(messages))
            return 4000 if len(messages) > 2 else 100

        result = self.build("current-secret", past, count_tokens=counter)
        self.assertEqual(len(result["messages"]), 2)
        self.assertIn('"current-secret"', result["messages"][-1]["content"])
        self.assertTrue(result["metadata"]["dropped_ids"])
        self.assertTrue(all(c[0] == calls[0][0] for c in calls))

    def test_budget_drops_whole_corrected_memory_not_just_correction(self):
        past = history(
            [("카레 사러 가자", "좋아요."), ("카레 취소", "네.")]
            + [("노래", "응") for _ in range(10)]
        )

        def counter(messages):
            return 4000 if '"correction_links":[' in messages[-1]["content"] else 100

        result = self.build("카레 재료", past, count_tokens=counter)
        self.assertFalse(any(x["kind"] == "memory" for x in result["retrieval_hits"]))
        self.assertNotIn("카레 사러 가자", result["messages"][-1]["content"])

    def test_oversized_current_message_rejected_not_silently_truncated(self):
        with self.assertRaises(InputBudgetError):
            self.build(count_tokens=lambda messages: 5000)

    def test_cards_separate_speech_judgment_and_authored_policy(self):
        cards = self.builder.cards
        self.assertEqual(len(cards["quality_axes"]), 6)
        self.assertIn("부상", cards["characters"]["majima"]["prompt"])
        self.assertIn("자기 의견", cards["characters"]["haruka"]["prompt"])
        self.assertTrue(
            all(c["fan_review"] == "pending" for c in cards["characters"].values())
        )


class RetrievalTests(unittest.TestCase):
    def test_filter_runs_before_semantic_encoder_or_fts(self):
        registry = load_registry(DEFAULT_DATA / "registry.json")
        record = copy.deepcopy(registry["records"][0])
        record.update(
            id="forbidden", text="private foreign source", known_by=["unknown"]
        )
        registry["records"].append(record)
        encoder = RecordingEncoder()
        retriever = HybridRetriever(registry, encoder)
        hits = retriever.evidence("haruka", "daily-if-v1", "private foreign source")
        self.assertNotIn("private foreign source", encoder.seen)
        self.assertNotIn(
            "forbidden", {x["id"] for group in hits.values() for x in group}
        )
        self.assertFalse(
            any(retriever.evidence("haruka", "unapproved-if", "나팔꽃").values())
        )

    def test_missing_evidence_and_heldout_split_are_rejected(self):
        original = load_registry(DEFAULT_DATA / "registry.json")
        for change in ("test", "hash"):
            value = copy.deepcopy(original)
            if change == "test":
                value["records"][0]["split"] = "test"
            else:
                value["records"][0]["source"]["excerpt"] = "tampered"
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "registry.json"
                path.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    load_registry(path)

    def test_korean_particles_expand_proper_names(self):
        value = normalize("마지마는 나팔꽃에서 키류랑")
        self.assertIn("majima", value)
        self.assertIn("morning glory", value)
        self.assertIn("kiryu", value)

    def test_scene_speaker_and_recipient_are_preserved(self):
        registry = load_registry(DEFAULT_DATA / "registry.json")
        scene = next(
            r for r in registry["records"] if r["id"] == "scene-majima-challenge"
        )
        self.assertEqual(scene["split"], "train")
        self.assertEqual(scene["scene"]["transcript"][-1]["speaker_id"], "nishida")
        self.assertEqual(scene["scene"]["recipient_status"], "unresolved")
        self.assertFalse(scene["scene"]["is_current_history"])

    def test_no_match_is_empty_not_padded(self):
        retriever = HybridRetriever(DEFAULT_DATA / "registry.json")
        self.assertEqual(
            retriever.evidence("haruka", "daily-if-v1", "ZXQ9876"),
            {"facts": [], "scenes": []},
        )


if __name__ == "__main__":
    unittest.main()
