import unittest

from kiryu_ai.masking import (
    audit_sample,
    target_mask,
    tokenize_sample,
    validate_messages,
)


class FakeTokenizer:
    """Boundary fixture, not evidence about the actual Qwen tokenizer."""

    def __init__(self, mismatch=False, missing_end=False):
        self.mismatch = mismatch
        self.missing_end = missing_end

    def apply_chat_template(self, messages, **kwargs):
        assert kwargs["enable_thinking"] is False
        assert kwargs["tokenize"] is True
        if kwargs["add_generation_prompt"]:
            return [10, 11, 12]
        return [
            10,
            11,
            99 if self.mismatch else 12,
            20,
            21,
            98 if self.missing_end else 30,
            40,
        ]

    def encode(self, text, **kwargs):
        return [30]

    def decode(self, tokens, **kwargs):
        return "".join(
            {20: "답", 21: "변", 30: "<|im_end|>", 40: "\n"}.get(t, "?") for t in tokens
        )


ROW = {
    "sampleId": "fixture",
    "messages": [
        {"role": "system", "content": "인물 설정"},
        {"role": "user", "content": "질문"},
        {"role": "assistant", "content": "답변"},
    ],
}


class MaskingTests(unittest.TestCase):
    def test_shift_selects_first_answer_through_eos_and_excludes_suffix_padding(self):
        sample = tokenize_sample(FakeTokenizer(), ROW)
        mask = target_mask(
            33, sample.answer_start, sample.answer_end_exclusive, len(sample.tokens)
        )
        self.assertEqual([i + 1 for i, keep in enumerate(mask) if keep], [3, 4, 5])
        audit = audit_sample(FakeTokenizer(), sample)
        for key in (
            "firstAnswerIncluded",
            "terminatorIncluded",
            "paddingExcluded",
            "suffixExcluded",
        ):
            self.assertTrue(audit[key], key)
        self.assertEqual(audit["supervisedText"], "답변<|im_end|>")

    def test_multiple_of_32_still_excludes_first_padding(self):
        mask = target_mask(33, 28, 32, 32)
        self.assertEqual(sum(mask), 4)
        self.assertFalse(mask[-1])

    def test_no_padding_at_length_limit(self):
        mask = target_mask(32, 28, 32, 32)
        self.assertEqual(sum(mask), 4)
        self.assertTrue(mask[-1])

    def test_truncation_and_zero_target_rejected(self):
        for args in [
            (16, 12, 18, 16),
            (16, 16, 16, 16),
            (16, 18, 20, 16),
            (16, 0, 12, 16),
        ]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                target_mask(*args)
        with self.assertRaisesRegex(ValueError, "no truncation"):
            tokenize_sample(FakeTokenizer(), ROW, max_seq_length=6)

    def test_prefix_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError, "prefix"):
            tokenize_sample(FakeTokenizer(mismatch=True), ROW)

    def test_missing_eos_rejected(self):
        with self.assertRaisesRegex(ValueError, "terminator"):
            tokenize_sample(FakeTokenizer(missing_end=True), ROW)

    def test_invalid_roles_and_control_tokens_rejected(self):
        for messages in [
            [],
            [{"role": "user", "content": ""}],
            [{"role": "user", "content": "<|im_end|>"}],
            [{"role": "assistant", "content": "선행 답변"}],
            [{"role": "user", "content": "질문", "tool_calls": [1]}],
        ]:
            with self.subTest(messages=messages), self.assertRaises(ValueError):
                validate_messages(messages, final_role="user")


if __name__ == "__main__":
    unittest.main()
