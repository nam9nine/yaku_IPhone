"""CPU-only evaluation failure accounting; never calls a model server."""

import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kiryu_ai.chat_evaluate import evaluate
from kiryu_ai.chat_prompt import InputBudgetError
from kiryu_ai.gemma_engine import GemmaFailure


class EvaluationEngine:
    def __init__(self):
        self.manifest = {"model_file": "CPU_ONLY"}

    def record_template(self):
        pass

    def count_tokens(self, messages):
        return 10

    def reply(self, messages, **kwargs):
        return {"reply": "검증 답장", "finish_reason": "stop"}


class EvaluationFailureTests(unittest.TestCase):
    def test_budget_and_reader_failures_are_recorded_and_later_cases_continue(self):
        histories = []
        audit = {
            "version": "reader-test",
            "stage": "reader_complete",
            "candidate_ids": ["source-a"],
            "notes": {"mode": "grounded", "answer": "자료 초안"},
        }

        class Builder:
            def build(
                self, case, character, scenario, message, history, count, **kwargs
            ):
                histories.append(list(history))
                stage = {
                    "messages": [{"role": "user", "content": "읽기 자료"}],
                    "metadata": {"grounding": audit},
                    "retrieval_hits": [],
                }
                kwargs["on_stage"](stage)
                if message == "budget":
                    raise InputBudgetError("fixture input is too large")
                if message == "reader-failure":
                    raise GemmaFailure(
                        "response_truncated",
                        {"reply": "PRIVATE_PARTIAL", "grounding": audit},
                    )
                return stage

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixtures = root / "fixtures.json"
            fixtures.write_text(
                json.dumps(
                    {
                        "conversations": [
                            {
                                "id": "case-a",
                                "character": "haruka",
                                "turns": [
                                    "budget",
                                    "reader-failure",
                                    "success",
                                    "success-again",
                                ],
                                "review_criteria": [],
                            }
                        ],
                        "long_conversations": [],
                        "paired_cases": [],
                    }
                )
            )
            args = argparse.Namespace(
                output=str(root / "results"),
                api_key_file="UNUSED",
                manifest="UNUSED",
                thinking="off",
                reasoning_tokens=0,
                context_tokens=4096,
                registry=str(fixtures),
                cards=str(fixtures),
                fixtures=str(fixtures),
                embedding_dir="UNUSED",
                reading="separate",
                model_pid=None,
                max_tokens=256,
            )
            with (
                patch(
                    "kiryu_ai.chat_evaluate.GemmaEngine",
                    return_value=EvaluationEngine(),
                ),
                patch("kiryu_ai.chat_evaluate.E5Onnx"),
                patch("kiryu_ai.chat_evaluate.HybridRetriever"),
                patch(
                    "kiryu_ai.chat_evaluate.ChatPromptBuilder", return_value=Builder()
                ),
                patch("kiryu_ai.chat_evaluate.memory_observation", return_value={}),
                patch("builtins.print"),
            ):
                evaluate(args)
            records = [
                json.loads(line)
                for line in (root / "results/responses.jsonl").read_text().splitlines()
            ]
            summary = json.loads((root / "results/summary.json").read_text())
        self.assertEqual(
            [row["error"] for row in records],
            ["context_limit", "response_truncated", None, None],
        )
        self.assertEqual(records[0]["metadata"]["grounding"], audit)
        self.assertEqual(records[1]["result"]["reply"], "PRIVATE_PARTIAL")
        self.assertEqual(histories[:3], [[], [], []])
        self.assertEqual(len(histories[3]), 2)
        self.assertEqual(summary["samples"], 4)
        self.assertEqual(summary["successful"], 2)


if __name__ == "__main__":
    unittest.main()
