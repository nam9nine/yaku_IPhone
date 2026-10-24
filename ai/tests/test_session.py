import tempfile
import unittest

from kiryu_ai.session import SessionStore, filter_knowledge, select_scoped_memory


class SessionTests(unittest.TestCase):
    def test_state_and_loaded_history_are_scoped(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(directory)
            store.append_exchange(
                "visitor-a",
                "haruka",
                "if-v1",
                "가상 암호는 파란유자739야",
                "기억해 둘게.",
            )
            self.assertEqual(store.history("visitor-b", "haruka", "if-v1"), [])
            self.assertEqual(store.history("visitor-a", "majima", "if-v1"), [])
            self.assertEqual(store.history("visitor-a", "haruka", "if-v2"), [])
            history = store.history("visitor-a", "haruka", "if-v1")
            history[0]["content"] = "변경"
            loaded = SessionStore(directory)
            self.assertIn(
                "파란유자739",
                loaded.history("visitor-a", "haruka", "if-v1")[0]["content"],
            )
            self.assertEqual(loaded.history("visitor-b", "haruka", "if-v1"), [])

    def test_memory_selection_checks_all_three_identifiers(self):
        records = [
            {
                "visitor_id": "a",
                "character_id": "haruka",
                "scenario_version": "v1",
                "text": "A만 아는 비밀",
            },
            {
                "visitor_id": "b",
                "character_id": "haruka",
                "scenario_version": "v1",
                "text": "B가 한 약속",
            },
            {
                "visitor_id": "b",
                "character_id": "majima",
                "scenario_version": "v1",
                "text": "다른 인물",
            },
        ]
        self.assertEqual(
            [m["text"] for m in select_scoped_memory(records, "b", "haruka", "v1")],
            ["B가 한 약속"],
        )

    def test_fact_requires_scope_and_explicit_adoption(self):
        facts = [
            {"id": "one", "known_by": ["haruka"]},
            {"id": "two", "known_by": ["majima"]},
        ]
        self.assertEqual(filter_knowledge(facts, "haruka", ["one", "two"]), [facts[0]])
        self.assertEqual(filter_knowledge(facts, "haruka", []), [])


if __name__ == "__main__":
    unittest.main()
