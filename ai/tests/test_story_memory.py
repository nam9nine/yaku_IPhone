import copy
import unittest

from kiryu_ai.chat_prompt import DEFAULT_DATA, ChatPromptBuilder, reconstruct_input
from kiryu_ai.chat_retrieval import HybridRetriever, load_registry


class StoryMemoryTests(unittest.TestCase):
    def setUp(self):
        self.registry = load_registry(DEFAULT_DATA / "registry.json")
        self.retriever = HybridRetriever(self.registry)
        self.builder = ChatPromptBuilder(retriever=self.retriever)

    def build(self, question, character="majima", history=None, **options):
        return self.builder.build(
            "visitor",
            character,
            "daily-if-v1",
            question,
            history or [],
            options.pop("count_tokens", lambda _: 100),
            **options,
        )

    def test_new_approved_fact_is_used_without_a_story_specific_prompt_branch(self):
        record = copy.deepcopy(self.registry["records"][0])
        record.update(
            id="synthetic-new-record",
            text="라무칸 창고의 담당자는 보라다.",
            known_by=["majima"],
            fact_type="relationship",
            scope_note="합성 검사 자료의 관계",
        )
        self.builder.registry["records"].append(record)
        self.retriever.registry = self.builder.registry
        result = self.build("라무칸 창고 담당자를 알려줘.")
        self.assertIn(
            "synthetic-new-record", [r["id"] for r in result["retrieval_hits"]]
        )
        self.assertIn(record["text"], result["messages"][-1]["content"])
        self.assertNotIn(record["text"], result["messages"][0]["content"])

    def test_ui_launch_backstory_is_not_injected_as_visitor_memory(self):
        for character in ("haruka", "majima"):
            self.builder.cards["characters"][character]["initial_event"] = (
                "UI_ONLY_SENTINEL_4937"
            )
            result = self.build("오늘 영화 뭐 볼까?", character)
            self.assertNotIn("UI_ONLY_SENTINEL_4937", str(result["messages"]))
            self.assertNotIn(
                "haruka-orphanage", result["metadata"]["relationship_record_ids"]
            )

    def test_named_relationships_and_events_reach_final_input(self):
        cases = [
            ("majima", "니시다가 형님의 윗사람입니까?", "majima-nishida-subordinate"),
            (
                "majima",
                "니시다하고 같이 폭탄을 해체했습니까?",
                "story-majima-nishida-bombs",
            ),
            ("majima", "시마노와 어떤 관계였습니까?", "majima-shimano-superior"),
            (
                "majima",
                "마키무라 마코토를 보호한 적이 있습니까?",
                "majima-makoto-protection",
            ),
            (
                "majima",
                "사에지마를 구하려 명령에 거역했습니까?",
                "story-majima-saejima-defiance",
            ),
            ("haruka", "나팔꽃 아이들 이름을 알려줘.", "haruka-asagao-children"),
            ("haruka", "타이치가 꿈꾸는 직업이 뭐였지?", "haruka-taichi-dream"),
            (
                "haruka",
                "사에지마를 해변에서 구한 적 있니?",
                "story-haruka-saejima-rescue",
            ),
        ]
        for character, question, expected in cases:
            with self.subTest(question=question):
                result = self.build(question, character)
                self.assertIn(expected, [h["id"] for h in result["retrieval_hits"]])
                self.assertIn(expected, result["messages"][-1]["content"])
                self.assertEqual(
                    reconstruct_input(result["metadata"], []), result["messages"]
                )

    def test_new_private_backstory_stays_in_approved_character_and_scenario(self):
        for char, scenario in [("haruka", "daily-if-v1"), ("majima", "unapproved")]:
            hits = self.retriever.evidence(
                char, scenario, "마코토 니시다 폭탄 시마노 명령 사에지마"
            )
            ids = {r["id"] for rows in hits.values() for r in rows}
            self.assertFalse(
                ids
                & {
                    "majima-nishida-subordinate",
                    "story-majima-nishida-bombs",
                    "majima-shimano-superior",
                    "majima-makoto-protection",
                    "story-majima-saejima-defiance",
                }
            )

    def test_new_question_survives_unrelated_recent_topic(self):
        query = "타이치의 장래 희망은?\n유미 엄마 친어머니 가족 다테 아키야마"
        result = self.retriever.evidence(
            "haruka", "daily-if-v1", query, current_query="타이치의 장래 희망은?"
        )
        self.assertEqual(result["facts"][0]["id"], "haruka-taichi-dream")
        self.assertEqual(result["facts"][0]["query_scope"], "current")

    def test_followup_pronoun_keeps_contextual_story_candidates(self):
        for question, previous, expected in [
            (
                "그 친구랑 같이 했던 일이 뭐였습니까?",
                "니시다는 제 아래서 일하던 녀석이지.",
                "story-majima-nishida-bombs",
            ),
            (
                "그 사람을 위해 뭘 한 적 있습니까?",
                "사에지마는 내 의형제다.",
                "story-majima-saejima-defiance",
            ),
        ]:
            with self.subTest(question=question):
                result = self.retriever.evidence(
                    "majima",
                    "daily-if-v1",
                    question + "\n" + previous,
                    current_query=question,
                    exclude_ids=self.builder.cards["characters"]["majima"][
                        "relationship_refs"
                    ],
                )
                self.assertIn(expected, [r["id"] for r in result["facts"]])

    def test_reference_scene_keeps_original_speaker_context(self):
        result = self.retriever.evidence(
            "majima",
            "daily-if-v1",
            "그때 누구에게 말한 겁니까?\n시마노한테 그래는 못 하겠습니더라고 말했다.",
            current_query="그때 누구에게 말한 겁니까?",
        )
        self.assertEqual(result["scenes"][0]["id"], "scene-majima-defiance")

    def test_direct_query_does_not_mislabel_secondary_facts_as_context_only(self):
        question = "니시다와 폭탄 해체를 했습니까?"
        result = self.retriever.evidence(
            "majima", "daily-if-v1", question, current_query=question
        )
        self.assertTrue(result["facts"])
        self.assertTrue(all(r["query_scope"] == "current" for r in result["facts"]))

    def test_small_budget_evicts_old_chat_before_current_story(self):
        history = []
        for i in range(6):
            history += [
                {
                    "id": f"u{i}",
                    "role": "user",
                    "content": "오늘 하늘이 맑아.",
                    "time": None,
                },
                {
                    "id": f"a{i}",
                    "role": "assistant",
                    "content": "그렇구마.",
                    "time": None,
                },
            ]

        def native_standin(messages):
            # Deliberately constrained budget: only the latest two exchanges fit.
            return 100 if len(messages) <= 6 else 1000

        result = self.build(
            "니시다와 카무로쵸 폭탄을 해체한 적 있습니까?",
            history=history,
            count_tokens=native_standin,
            context_limit=700,
            max_tokens=100,
        )
        self.assertIn(
            "story-majima-nishida-bombs", [h["id"] for h in result["retrieval_hits"]]
        )
        self.assertIn("u0", result["metadata"]["dropped_ids"])
        self.assertNotIn("u5", result["metadata"]["dropped_ids"])
        self.assertEqual(
            reconstruct_input(result["metadata"], history), result["messages"]
        )

    def test_ambiguous_makoto_does_not_alias_date_to_makimura(self):
        result = self.build("다테 마코토 형사 얘깁니다.", "haruka")
        self.assertNotIn(
            "majima-makoto-protection", [h["id"] for h in result["retrieval_hits"]]
        )
        self.assertIn(
            "haruka-date-acquaintance", [h["id"] for h in result["retrieval_hits"]]
        )

    def test_new_sources_have_explicit_time_and_knowledge_scope(self):
        new = [r for r in self.registry["records"] if r.get("canon_period")]
        self.assertEqual(len(new), 9)
        for r in new:
            self.assertTrue(r["knowledge_scope"])
            self.assertEqual(r["fan_review"], "pending")
            self.assertIn("현재", r["review_basis"])
            self.assertIn(r["source"]["language"], ("ko", "ja"))


if __name__ == "__main__":
    unittest.main()
