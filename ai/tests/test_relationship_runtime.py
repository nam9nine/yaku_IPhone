import copy
import json
import unittest

from kiryu_ai.chat_prompt import DEFAULT_DATA, ChatPromptBuilder
from kiryu_ai.chat_retrieval import HybridRetriever, load_registry


class RelationshipRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.registry = load_registry(DEFAULT_DATA / "registry.json")
        self.retriever = HybridRetriever(self.registry)
        self.builder = ChatPromptBuilder(retriever=self.retriever)

    def build(self, question, character="majima", history=None):
        return self.builder.build(
            "test-visitor",
            character,
            "daily-if-v1",
            question,
            history or [],
            lambda messages: 100,
        )

    def test_relationship_stays_fixed_but_story_is_actually_retrieved(self):
        result = self.build("제가 마지마 건설을 도우려 했던 이유가 뭐였습니까?")
        fixed = [
            h["id"]
            for h in result["retrieval_hits"]
            if h.get("retrieval_mode") == "character-card"
        ]
        dynamic = [
            h["id"]
            for h in result["retrieval_hits"]
            if h.get("retrieval_mode") != "character-card"
        ]
        self.assertIn("kiryu-majima-address", fixed)
        self.assertIn("majima-kiryu-familiar-rivalry", fixed)
        self.assertNotIn("story-kiryu-majima-construction-help", fixed)
        self.assertIn("story-kiryu-majima-construction-help", dynamic)
        self.assertIn(
            "story-kiryu-majima-construction-help", result["messages"][-1]["content"]
        )

    def test_quoted_original_line_can_retrieve_its_own_speaker_context(self):
        result = self.build("그래는 못 하겠습니더, 그때 왜 그렇게 대답한 겁니까?")
        self.assertIn(
            "scene-majima-defiance", [h["id"] for h in result["retrieval_hits"]]
        )
        payload = result["messages"][-1]["content"].split("\n", 1)[1]
        context, _ = json.JSONDecoder().raw_decode(payload)
        scene = context["reference_scenes_not_our_history"][0]["scene"]
        self.assertEqual(scene["transcript"][-1]["speaker_id"], "shimano")
        self.assertEqual(scene["target_speaker"]["speaker_id"], "majima")
        self.assertFalse(scene["is_current_history"])
        self.assertEqual([m["role"] for m in result["messages"]], ["system", "user"])

    def test_story_does_not_leak_to_other_character_or_continuity(self):
        original = copy.deepcopy(self.registry)
        for character, scenario in [
            ("haruka", "daily-if-v1"),
            ("majima", "unapproved-if"),
        ]:
            result = self.retriever.evidence(
                character, scenario, "마지마 건설 동성회 복귀 형님"
            )
            ids = {r["id"] for rows in result.values() for r in rows}
            self.assertFalse(
                ids
                & {
                    "kiryu-majima-address",
                    "majima-kiryu-familiar-rivalry",
                    "story-majima-tojo-return",
                    "story-kiryu-majima-construction-help",
                }
            )
        self.assertEqual(original, self.registry)

    def test_familiar_address_alone_does_not_search_unrelated_story(self):
        class AlwaysSimilarEncoder:
            def encode(self, texts, *, query=False):
                return [[1.0, 0.0] for _ in texts]

        retriever = HybridRetriever(self.registry, AlwaysSimilarEncoder())
        for address in ["형님", "마지마 형님", "마지마형님 저 키류입니다"]:
            with self.subTest(address=address):
                result = retriever.evidence("majima", "daily-if-v1", address)
                self.assertEqual(result, {"facts": [], "scenes": []})
        # Honorific removal must preserve the actual question's topic.
        result = self.build("형님, 제가 마지마 건설을 도우려 했던 이유가 뭐였습니까?")
        self.assertIn(
            "story-kiryu-majima-construction-help",
            [h["id"] for h in result["retrieval_hits"]],
        )

    def test_prior_wrong_reply_remains_history_not_a_new_relationship(self):
        history = [
            {"id": "a", "role": "user", "content": "형님", "time": None},
            {
                "id": "b",
                "role": "assistant",
                "content": "갑자기 형님이라니?",
                "time": None,
            },
        ]
        original = copy.deepcopy(history)
        result = self.build("늘 그렇게 불렀잖습니까.", history=history)
        self.assertIn(
            "키류는 마지마를 마지마 형님 또는 형님이라고 부른다",
            result["messages"][0]["content"],
        )
        self.assertEqual(result["messages"][2]["content"], history[1]["content"])
        self.assertEqual(history, original)


if __name__ == "__main__":
    unittest.main()
