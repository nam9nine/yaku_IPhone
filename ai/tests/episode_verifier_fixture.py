"""Explicit bounded-verifier test double; no model or user-text classification."""

import copy
import json

from kiryu_ai.episode_entailment import EpisodeEntailment


class VerifierEngine:
    thinking = True
    reasoning_tokens = 1024
    context_tokens = 6144
    timeout = 120

    def __init__(self, verdict="supported", *, result=None, count=100):
        self.manifest = {"model_file": "unit-test-only"}
        self.verdict = verdict
        self.result = result
        self.count = count
        self.calls = []
        self.counted = []
        self.classifier_outputs = []

    def count_tokens(self, messages):
        self.counted.append(copy.deepcopy(messages))
        return self.count

    def reply(self, messages, **kwargs):
        self.calls.append((copy.deepcopy(messages), kwargs))
        if "target" in kwargs["response_schema"]["properties"]:
            properties = kwargs["response_schema"]["properties"]
            value = (
                self.classifier_outputs.pop(0)
                if self.classifier_outputs
                else {
                    "episode_id": properties["episode_id"]["enum"][0],
                    "version": properties["version"]["enum"][0],
                    "target": "current_user_episode",
                    "response": "none",
                    "evidence_message_id": properties["evidence_message_id"]["enum"][0],
                }
            )
            if isinstance(value, Exception):
                raise value
            return {"reply": json.dumps(value), "finish_reason": "stop"}
        if isinstance(self.result, Exception):
            raise self.result
        if self.result is not None:
            return self.result
        return {
            "reply": json.dumps(
                {
                    "verdict": self.verdict,
                    "evidence_quote": messages[-1]["content"][:100],
                }
            ),
            "finish_reason": "stop",
        }


def verifier_fixture(**kwargs):
    return EpisodeEntailment(VerifierEngine(**kwargs))
