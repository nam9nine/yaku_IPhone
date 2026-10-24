"""Native Qwen chat serialization and explicit, post-shift answer spans.

This module intentionally has no MLX dependency so its invariants run in CI.
The upstream chat template is retained; its trailing newline is not a target.
"""

from dataclasses import dataclass
from typing import Any

END_TOKEN = "<|im_end|>"
RESERVED_MARKERS = ("<|im_start|>", END_TOKEN, "<think>", "</think>")


@dataclass(frozen=True)
class EncodedSample:
    tokens: tuple[int, ...]
    answer_start: int
    answer_end_exclusive: int
    sample_id: str

    @property
    def supervised_tokens(self) -> tuple[int, ...]:
        return self.tokens[self.answer_start : self.answer_end_exclusive]


def validate_messages(messages: list[dict[str, Any]], *, final_role: str) -> None:
    if not isinstance(messages, list) or not messages:
        raise ValueError("messages must be a nonempty list")
    expected = "user"
    for i, message in enumerate(messages):
        if not isinstance(message, dict):
            raise TypeError("each message must be an object")
        role, content = message.get("role"), message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("empty or non-text messages are not supported")
        if any(marker in content for marker in RESERVED_MARKERS):
            raise ValueError("message contains a reserved chat control marker")
        if message.get("tool_calls") or message.get("reasoning_content"):
            raise ValueError("tool calls and reasoning are outside the SMS contract")
        if i == 0 and role == "system":
            continue
        if role != expected:
            raise ValueError(f"expected {expected} at message {i}, got {role}")
        expected = "assistant" if expected == "user" else "user"
    if messages[-1]["role"] != final_role:
        raise ValueError(f"last message must be {final_role}")


def _template(tokenizer: Any, messages: list[dict], *, generation: bool) -> list[int]:
    tokens = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=generation,
        enable_thinking=False,
        return_dict=False,
    )
    if not isinstance(tokens, list) or not all(isinstance(t, int) for t in tokens):
        raise ValueError("chat template must return one list of token IDs")
    return tokens


def render_prompt(tokenizer: Any, messages: list[dict]) -> list[int]:
    """Exactly the prefix used by both training and local SMS inference."""
    validate_messages(messages, final_role="user")
    return _template(tokenizer, messages, generation=True)


def target_mask(
    batch_width: int, answer_start: int, answer_end_exclusive: int, valid_length: int
) -> list[bool]:
    """Mask for targets=tokens[1:], using original token positions 1..width-1."""
    if not 1 <= answer_start < answer_end_exclusive <= valid_length <= batch_width:
        raise ValueError("invalid answer span, truncation, or batch width")
    return [
        answer_start <= position < answer_end_exclusive and position < valid_length
        for position in range(1, batch_width)
    ]


def tokenize_sample(
    tokenizer: Any, row: dict, max_seq_length: int = 2048
) -> EncodedSample:
    messages = row.get("messages")
    validate_messages(messages, final_role="assistant")
    prefix = render_prompt(tokenizer, messages[:-1])
    tokens = _template(tokenizer, messages, generation=False)
    if tokens[: len(prefix)] != prefix:
        raise ValueError("inference prefix does not match full training tokens")
    if len(tokens) > max_seq_length:
        raise ValueError(
            f"sample has {len(tokens)} tokens, limit is {max_seq_length}; no truncation"
        )
    end_ids = tokenizer.encode(END_TOKEN, add_special_tokens=False)
    if len(end_ids) != 1:
        raise ValueError("Qwen message terminator must be exactly one token")
    end_positions = [
        i for i in range(len(prefix), len(tokens)) if tokens[i] == end_ids[0]
    ]
    if len(end_positions) != 1:
        raise ValueError("final assistant must have exactly one message terminator")
    end = end_positions[0] + 1
    if end - len(prefix) < 2:
        raise ValueError("empty final answer before its terminator")
    suffix = tokenizer.decode(tokens[end:], skip_special_tokens=False)
    if suffix.strip():
        raise ValueError("unexpected non-whitespace after final assistant terminator")
    sample = EncodedSample(
        tuple(tokens),
        len(prefix),
        end,
        str(row.get("sampleId", row.get("sample_id", row.get("id", "unlabelled")))),
    )
    mask = target_mask(len(tokens), sample.answer_start, end, len(tokens))
    selected = tuple(token for token, keep in zip(tokens[1:], mask) if keep)
    if selected != sample.supervised_tokens or selected[-1] != end_ids[0]:
        raise ValueError("shifted target mask does not select the exact answer and EOS")
    return sample


def audit_sample(
    tokenizer: Any, sample: EncodedSample, batch_width: int | None = None
) -> dict:
    width = batch_width or (1 + 32 * ((len(sample.tokens) + 31) // 32))
    mask = target_mask(
        width, sample.answer_start, sample.answer_end_exclusive, len(sample.tokens)
    )
    return {
        "sampleId": sample.sample_id,
        "validLength": len(sample.tokens),
        "batchWidth": width,
        "answerStart": sample.answer_start,
        "answerEndExclusive": sample.answer_end_exclusive,
        "supervisedTokenCount": sum(mask),
        "firstAnswerIncluded": mask[sample.answer_start - 1],
        "terminatorIncluded": mask[sample.answer_end_exclusive - 2],
        "paddingExcluded": not any(mask[max(0, len(sample.tokens) - 1) :]),
        "suffixExcluded": not any(mask[sample.answer_end_exclusive - 1 :]),
        "supervisedText": tokenizer.decode(
            list(sample.supervised_tokens), skip_special_tokens=False
        ),
    }
