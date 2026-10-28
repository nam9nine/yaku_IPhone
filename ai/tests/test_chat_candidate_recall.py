import unittest

from kiryu_ai.chat_retrieval import HybridRetriever


class CandidateRecallTests(unittest.TestCase):
    def test_reader_pool_keeps_low_absolute_score_paraphrase_after_authorization(self):
        class Encoder:
            def __init__(self):
                self.passages = []

            def encode(self, texts, *, query=False):
                if query:
                    return [[1.0, 0.0] for _ in texts]
                self.passages.extend(texts)
                return [[0.8, 0.6] if "rescue" in t else [0.7, 0.714] for t in texts]

        def record(identifier, text, character="haruka"):
            return {
                "id": identifier,
                "kind": "fact",
                "text": text,
                "known_by": [character],
                "scenarios": ["daily-if-v1"],
                "runtime_eligible": True,
                "approval": "agent-reviewed-experiment",
            }

        encoder = Encoder()
        retriever = HybridRetriever(
            {
                "records": [
                    record("gold", "rescue event"),
                    record("unrelated", "ordinary workplace"),
                    record("private", "rescue secret", "majima"),
                ]
            },
            encoder,
        )
        query = "lifesaver"
        # Existing direct/memory policies are not silently widened.
        self.assertEqual(
            retriever.evidence("haruka", "daily-if-v1", query)["facts"], []
        )
        pool = retriever.candidates("haruka", "daily-if-v1", query, query, limit=1)
        self.assertEqual([r["id"] for r in pool], ["gold"])
        self.assertEqual(pool[0]["semantic_score"], 0.8)
        self.assertTrue(all("secret" not in t for t in encoder.passages))


if __name__ == "__main__":
    unittest.main()
