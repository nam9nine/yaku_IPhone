import unittest

from kiryu_ai.runtime import assemble_input
from kiryu_ai.session import SessionStore


class InputIsolationTests(unittest.TestCase):
    def test_real_builder_excludes_other_visitors_state(self):
        profile = {
            "character_id": "haruka",
            "scenario_version": "daily-if-v1",
            "system_prompt": "한국어 문자로 답한다.",
        }
        store = SessionStore()
        store.append_exchange(
            "visitor-a",
            "haruka",
            "daily-if-v1",
            "가상의 비밀은 청록연필739다.",
            "기억할게요.",
        )
        memory = [
            {
                "visitor_id": "visitor-a",
                "character_id": "haruka",
                "scenario_version": "daily-if-v1",
                "text": "비밀기억노란상자482",
            }
        ]
        facts = [
            {
                "id": "public",
                "known_by": ["haruka"],
                "textKo": "하루카는 키류와 가깝다.",
            },
            {"id": "other", "known_by": ["majima"], "textKo": "남의캐릭터전용정보892"},
        ]
        messages, scope = assemble_input(
            profile,
            store,
            "visitor-b",
            "내 비밀을 기억해?",
            facts=facts,
            memory=memory,
            allowed_fact_ids=["public", "other"],
        )
        actual_input = str(messages)
        for marker in ["청록연필739", "노란상자482", "남의캐릭터전용정보892"]:
            self.assertNotIn(marker, actual_input)
        self.assertIn("하루카는 키류와 가깝다", actual_input)
        self.assertEqual(scope["fact_ids"], ["public"])
        self.assertEqual(scope["history_messages"], 0)
        self.assertEqual(scope["memory_count"], 0)
        a_messages, a_scope = assemble_input(
            profile, store, "visitor-a", "내 비밀을 기억해?", memory=memory
        )
        self.assertIn("청록연필739", str(a_messages))
        self.assertIn("노란상자482", str(a_messages))
        self.assertEqual(a_scope["history_messages"], 2)


if __name__ == "__main__":
    unittest.main()
