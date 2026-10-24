import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from kiryu_ai.conversations import RUBRICS, SCENARIOS, conversation_turns, execute
from kiryu_ai.data import digest, read_jsonl
from kiryu_ai.session import SessionStore


def profile(character="majima", version="if-v1"):
    return {
        "character_id": character,
        "scenario_version": version,
        "system_prompt": "당신은 " + character + ". 한국어로 답한다.",
    }


def scenario(visitor="visitor-a", character="majima", sid="example"):
    return {
        "scenario_id": sid,
        "character_id": character,
        "visitor_id": visitor,
        "user_turns": ["처음 이야기", "그 다음은?", "정정하겠다.", "이제 어떻게 됐지?"],
    }


class FakeModel:
    load_seconds = 0

    def __init__(self):
        self.inputs = []

    def reply(self, messages, **options):
        self.inputs.append((copy.deepcopy(messages), options))
        return {
            "reply": f"ACTUAL_REPLY_{len(self.inputs)}",
            "finish_reason": "stop",
            "generation_seed": options["seed"],
            "generation_tokens": 5,
        }


class ConversationTests(unittest.TestCase):
    def test_previous_actual_answers_are_next_inputs(self):
        model, store = FakeModel(), SessionStore()
        rows = list(
            conversation_turns(profile(), scenario(), model.reply, store=store, seed=10)
        )
        self.assertEqual([row["status"] for row in rows], ["ok"] * 4)
        self.assertEqual(
            model.inputs[1][0][2], {"role": "assistant", "content": "ACTUAL_REPLY_1"}
        )
        self.assertEqual(
            model.inputs[3][0][6], {"role": "assistant", "content": "ACTUAL_REPLY_3"}
        )
        self.assertEqual(
            [options["seed"] for _, options in model.inputs], [10, 11, 12, 13]
        )
        self.assertEqual(len(store.history("visitor-a", "majima", "if-v1")), 8)
        for row in rows:
            self.assertEqual(row["messages"][-1]["role"], "user")
            self.assertEqual(row["input_sha256"], digest(row["messages"]))
            self.assertEqual(row["scope"]["history_messages"], 2 * (row["turn"] - 1))
            self.assertEqual(row["fan_review"], "pending")

    def test_other_visitors_history_memory_and_prompt_inputs_are_isolated(self):
        model, store = FakeModel(), SessionStore()
        store.append_exchange(
            "visitor-a", "majima", "if-v1", "MY_PRIVATE_CANARY", "PRIVATE_REPLY"
        )
        memory = [
            {
                "visitor_id": "visitor-a",
                "character_id": "majima",
                "scenario_version": "if-v1",
                "text": "PRIVATE_MEMORY_CANARY",
            }
        ]
        rows = list(
            conversation_turns(
                profile(),
                scenario("visitor-b"),
                model.reply,
                store=store,
                memory=memory,
            )
        )
        encoded = json.dumps([messages for messages, _ in model.inputs])
        self.assertNotIn("MY_PRIVATE_CANARY", encoded)
        self.assertNotIn("PRIVATE_REPLY", encoded)
        self.assertNotIn("PRIVATE_MEMORY_CANARY", encoded)
        self.assertEqual(rows[0]["scope"]["history_messages"], 0)
        self.assertEqual(rows[0]["scope"]["memory_count"], 0)
        self.assertEqual(
            store.history("visitor-a", "majima", "if-v1")[0]["content"],
            "MY_PRIVATE_CANARY",
        )

    def test_character_and_scenario_version_are_isolated(self):
        model, store = FakeModel(), SessionStore()
        store.append_exchange("visitor-a", "haruka", "if-v1", "OTHER_CHARACTER", "old")
        store.append_exchange(
            "visitor-a", "majima", "older-if", "OTHER_SCENARIO", "old"
        )
        rows = list(conversation_turns(profile(), scenario(), model.reply, store=store))
        self.assertEqual(rows[0]["scope"]["history_messages"], 0)
        encoded = json.dumps([messages for messages, _ in model.inputs])
        self.assertNotIn("OTHER_CHARACTER", encoded)
        self.assertNotIn("OTHER_SCENARIO", encoded)

    def test_incomplete_generation_is_not_silently_added_or_replaced(self):
        store, calls = SessionStore(), []

        def truncated(messages, **kwargs):
            calls.append(copy.deepcopy(messages))
            return {"reply": "잘린 답", "finish_reason": "length"}

        rows = list(conversation_turns(profile(), scenario(), truncated, store=store))
        self.assertEqual(
            [row["status"] for row in rows],
            ["incomplete", "skipped", "skipped", "skipped"],
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(store.history("visitor-a", "majima", "if-v1"), [])
        self.assertFalse(rows[0]["stored_in_history"])

    def test_generator_failure_is_recorded_and_later_turns_skipped(self):
        def fail(messages, **kwargs):
            raise RuntimeError("injected CPU failure")

        rows = list(conversation_turns(profile(), scenario(), fail))
        self.assertEqual(rows[0]["status"], "error")
        self.assertIn("injected CPU failure", rows[0]["error"])
        self.assertEqual([row["status"] for row in rows[1:]], ["skipped"] * 3)

    def test_rubrics_are_not_passed_as_generator_inputs(self):
        model = FakeModel()
        for item in SCENARIOS:
            list(conversation_turns(profile(item["character_id"]), item, model.reply))
        sent = json.dumps(
            [messages for messages, _ in model.inputs], ensure_ascii=False
        )
        for behaviors in RUBRICS.values():
            for text in behaviors:
                self.assertNotIn(text, sent)
        self.assertNotIn("expected_behavior", sent)
        self.assertEqual(len(model.inputs), 24)
        self.assertEqual(sum(s["character_id"] == "majima" for s in SCENARIOS), 3)
        self.assertEqual(sum(s["character_id"] == "haruka" for s in SCENARIOS), 3)

    def test_invalid_character_target_turn_and_wrong_version_rejected(self):
        for change in (
            {"character_id": "nishiki"},
            {"user_turns": [{"role": "assistant", "content": "target"}] * 4},
            {"scenario_version": "wrong"},
        ):
            with self.assertRaises(ValueError):
                list(
                    conversation_turns(
                        profile(), {**scenario(), **change}, FakeModel().reply
                    )
                )

    def test_suite_loads_model_once_and_writes_rubric_separately(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root / "data").mkdir()
            (root / "sources").mkdir()
            (root / "data/profiles.json").write_text(
                json.dumps([profile(), profile("haruka")])
            )
            (root / "data/scenario-facts.json").write_text(
                json.dumps(
                    {
                        "scenario_version": "if-v1",
                        "active_characters": ["majima", "haruka"],
                        "adopted_facts": [],
                    }
                )
            )
            (root / "sources/knowledge.jsonl").write_text("")
            model, loads = FakeModel(), []

            def factory(model_path, adapter):
                loads.append((model_path, adapter))
                return model

            args = SimpleNamespace(
                data_root=str(root),
                output=str(root / "results"),
                model="cpu-fake",
                adapter=None,
                seed=42,
                max_tokens=128,
                temperature=0.7,
                top_p=0.8,
                top_k=20,
                no_facts=False,
            )
            summary = execute(args, model_factory=factory)
            self.assertEqual(loads, [("cpu-fake", None)])
            self.assertEqual(len(model.inputs), 24)
            self.assertTrue(summary["execution_complete"])
            self.assertIsNone(summary["automatic_quality_verdict"])
            self.assertEqual(summary["fan_review"], "pending")
            rows = read_jsonl(root / "results/turns.jsonl")
            self.assertEqual(len(rows), 24)
            self.assertTrue(all("expected_behavior" not in row for row in rows))
            for start in range(0, 24, 4):
                self.assertEqual(rows[start]["scope"]["history_messages"], 0)
            rubric = read_jsonl(root / "results/private-rubric.jsonl")
            self.assertEqual(
                {row["sample_id"] for row in rubric}, {row["sample_id"] for row in rows}
            )
            with self.assertRaises(FileExistsError):
                execute(args, model_factory=factory)
            self.assertEqual(len(loads), 1)


if __name__ == "__main__":
    unittest.main()
