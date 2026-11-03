import json
import unittest
from unittest.mock import patch

from kiryu_ai.chat_prompt import ChatPromptBuilder, reconstruct_input
from kiryu_ai.persona_prompt import is_minimal_reply, persona_section, turn_note
from kiryu_ai.story_context import (
    OPENINGS_PATH,
    event_messages,
    native_turns,
    opening_messages,
    visible_timeline,
)


def turn(identifier, role, content, sequence, events=None):
    row = {"id": identifier, "role": role, "content": content, "sequence": sequence}
    if events is not None:
        row["phone_events"] = events
    return row


class VisibleThreadTests(unittest.TestCase):
    def test_opening_matches_the_catalog_the_app_renders(self):
        catalog = json.loads(OPENINGS_PATH.read_text(encoding="utf-8"))
        for character in ("haruka", "majima"):
            rows = opening_messages(character)
            self.assertEqual(
                [r["content"] for r in rows],
                [m["text"] for m in catalog["threads"][character]],
            )
            self.assertEqual(
                [r["role"] for r in rows],
                [
                    "user" if m["speaker"] == "kiryu" else "assistant"
                    for m in catalog["threads"][character]
                ],
            )
        self.assertEqual(
            opening_messages("haruka")[1]["content"], "좋다. 장은 내가 봐 오겠다."
        )

    def test_a_local_line_appears_once_where_it_was_first_reported(self):
        history = [
            turn(
                "u1",
                "user",
                "목록 다시 봤다. 빠진 건 없다.",
                1,
                ["haruka-shopping-checked"],
            ),
            turn("a1", "assistant", "고마워요.", 2),
            turn(
                "u2",
                "user",
                "마메 물그릇도 새로 채워 뒀다.",
                3,
                ["haruka-shopping-checked", "haruka-mame-checked"],
            ),
            turn("a2", "assistant", "벌써요?", 4),
        ]
        rows = visible_timeline(
            "haruka",
            history,
            current_events=[
                "haruka-shopping-checked",
                "haruka-mame-checked",
                "haruka-uniform-checked",
            ],
        )
        self.assertEqual(
            [r["id"] for r in rows],
            [
                "event:haruka-shopping-checked",
                "u1",
                "a1",
                "event:haruka-mame-checked",
                "u2",
                "a2",
                "event:haruka-uniform-checked",
            ],
        )
        self.assertEqual(
            rows[0]["content"],
            "목록 다 확인했어요? 빠진 게 없는지 한 번만 더 봐주세요.",
        )

    def test_notices_sort_by_sequence_and_unknown_or_foreign_ids_are_skipped(self):
        history = [turn("u1", "user", "네", 3, ["majima-call-missed", "retired-id"])]
        notices = [turn("n1", "assistant", "전화 왜 안 받노", 2)]
        rows = visible_timeline(
            "majima", [*history, turn("a1", "assistant", "그래", 4)], notices
        )
        self.assertEqual([r["id"] for r in rows], ["n1", "u1", "a1"])
        self.assertEqual(event_messages("majima", ["haruka-mame-checked", "nope"]), [])

    def test_bursts_merge_into_one_turn_per_speaker(self):
        rows = [
            {"id": "1", "role": "assistant", "content": "가"},
            {"id": "2", "role": "assistant", "content": "나"},
            {"id": "3", "role": "user", "content": "다"},
        ]
        self.assertEqual(
            native_turns(rows),
            [
                {"role": "assistant", "content": "가\n나"},
                {"role": "user", "content": "다"},
            ],
        )

    def test_model_sees_the_visible_thread_and_audit_rebuilds_it(self):
        builder = ChatPromptBuilder()
        history = [
            turn(
                "u1",
                "user",
                "목록 다시 봤다. 빠진 건 없다.",
                1,
                ["haruka-shopping-checked"],
            ),
            turn("a1", "assistant", "다행이에요.", 2),
        ]
        result = builder.build(
            "visitor-a",
            "haruka",
            "daily-if-v1",
            "마메 물그릇도 새로 채워 뒀다.",
            history,
            count_tokens=lambda _: 100,
            phone_events=["haruka-shopping-checked", "haruka-mame-checked"],
        )
        messages = result["messages"]
        joined = json.dumps(messages, ensure_ascii=False)
        # Haruka's own opening and both followups the visitor saw are her turns.
        self.assertIn("오늘 저녁은 카레 어때요?", messages[1]["content"])
        self.assertIn("목록 다 확인했어요?", messages[3]["content"])
        self.assertTrue(
            messages[-2]["content"].endswith(
                "마메 밥 챙겨주셨네요. 물그릇도 제가 확인할게요."
            )
        )
        self.assertEqual(
            messages[-1], {"role": "user", "content": "마메 물그릇도 새로 채워 뒀다."}
        )
        self.assertEqual(joined.count("마메 밥 챙겨주셨네요"), 1)
        self.assertEqual(result["metadata"]["input_message_ids"], ["u1", "a1"])
        self.assertEqual(reconstruct_input(result["metadata"], history), messages)
        self.assertEqual(result["recent_replies"], ["다행이에요."])
        # Audits keep the authored lines as rendered, so a later catalog edit
        # cannot break reconstruction of this run.
        edited = [{**row, "content": "고친 문구"} for row in opening_messages("haruka")]
        with (
            patch("kiryu_ai.story_context.opening_messages", return_value=edited),
            patch("kiryu_ai.chat_prompt.opening_messages", return_value=edited),
            patch("kiryu_ai.story_context.event_messages", return_value=[]),
        ):
            self.assertEqual(reconstruct_input(result["metadata"], history), messages)

    def test_trimming_keeps_what_the_first_kept_turn_answers(self):
        builder = ChatPromptBuilder()
        history = [
            turn(
                "u1",
                "user",
                "목록 다시 봤다. 빠진 건 없다.",
                1,
                ["haruka-shopping-checked"],
            ),
            turn("a1", "assistant", "다행이에요.", 2),
        ]
        for k in range(2, 6):
            history += [
                turn(
                    f"u{k}",
                    "user",
                    f"알았다 {k}.",
                    2 * k - 1,
                    ["haruka-shopping-checked"],
                ),
                turn(f"a{k}", "assistant", f"네 {k}번째예요.", 2 * k),
            ]
        result = builder.build(
            "visitor-a",
            "haruka",
            "daily-if-v1",
            "이제 뭐 하면 되냐.",
            history,
            count_tokens=lambda m: 5000 if "목록 다시 봤다" in str(m) else 10,
            phone_events=["haruka-shopping-checked"],
        )
        joined = json.dumps(result["messages"], ensure_ascii=False)
        # The trimmed line falls back to its state text.
        self.assertNotIn("목록 다 확인했어요", joined)
        self.assertIn("최근 폰에서 있었던 일", joined)
        call = {
            "id": "n1",
            "role": "assistant",
            "content": "전화 왜 안 받노, 키류쨩!",
            "sequence": 3,
            "time": None,
            "request_kind": "call_followup",
            "call_trigger": {
                "call_id": "00000000-0000-4000-8000-000000000000",
                "reason": "missed",
                "direction": "incoming",
            },
        }
        history = [turn("u1", "user", "형님, 뭐 하십니까?", 1)]
        history += [turn("a1", "assistant", "심심하다.", 2)]
        for k in range(2, 6):
            history += [
                turn(f"u{k}", "user", f"알겠습니다 {k}.", 2 * k + 1),
                turn(f"a{k}", "assistant", f"그래 {k}.", 2 * k + 2),
            ]
        result = builder.build(
            "visitor-a",
            "majima",
            "daily-if-v1",
            "네.",
            history,
            count_tokens=lambda m: 5000 if "형님, 뭐 하십니까" in str(m) else 10,
            notices=[call],
        )
        # The call followup right before the first kept turn stays, and the
        # audit lists only what the model saw. A followup after the last stored
        # turn (the one Kiryu is answering) is never trimmed.
        self.assertIn(
            "전화 왜 안 받노", json.dumps(result["messages"], ensure_ascii=False)
        )
        self.assertEqual(result["metadata"]["notice_message_ids"], ["n1"])
        self.assertIn("u1", result["metadata"]["dropped_ids"])
        late = {**call, "id": "n-late", "sequence": 40, "content": "전화 좀 받아라."}
        result = builder.build(
            "visitor-a",
            "majima",
            "daily-if-v1",
            "네.",
            history,
            count_tokens=lambda m: 5000 if "알겠습니다 5" in str(m) else 10,
            notices=[call, late],
        )
        self.assertEqual(
            result["messages"][-2]["content"].split("\n")[-1], "전화 좀 받아라."
        )
        self.assertIn("n-late", result["metadata"]["notice_message_ids"])


class PersonaPromptTests(unittest.TestCase):
    def test_short_answers_are_recognised_without_catching_real_sentences(self):
        for text in ("네", "응", "ㅇㅇ", "그래", "알겠습니다.", "ㅋㅋㅋ", "좋아요!"):
            self.assertTrue(is_minimal_reply(text), text)
        for text in (
            "네가 직접 해라",
            "응원할게",
            "그래서 언제 만나요?",
            "좋아하는 거 있어?",
        ):
            self.assertFalse(is_minimal_reply(text), text)

    def test_short_questions_and_hums_are_not_read_as_agreement(self):
        for text in ("네?", "응?", "그래?"):
            self.assertIn("되물었다", turn_note("majima", text, []), text)
        for text in ("음...", "흠", "ㅋㅋ", "ㅎㅎ", "그렇군요.", "아하"):
            note = turn_note("majima", text, [])
            self.assertIn("하고 받았다", note, text)
            # Quoted, never described as short (that drew remarks on length).
            self.assertNotIn("짧", note, text)
        self.assertIn("그렇다는 대답", turn_note("majima", "네", []))
        episode = turn_note("majima", "네", [], episode=True)
        self.assertIn("과제", episode)
        self.assertNotIn("그렇다는", episode)

    def test_turn_note_carries_the_turn_specific_move(self):
        self.assertIn("'네' 하고 답했다", turn_note("majima", "네", []))
        self.assertIn("물은 것부터", turn_note("majima", "어디 계십니까?", []))
        self.assertIn(
            "질문 없이",
            turn_note("majima", "뭐 하나", ["뭐 하노?", "니는 별일 없나?"]),
        )
        self.assertIn("구체적으로 반응", turn_note("haruka", "다녀왔다.", []))

    def test_persona_comes_first_with_examples_scene_and_memo(self):
        builder = ChatPromptBuilder()
        card = builder.cards["characters"]["haruka"]
        text = persona_section(card, "haruka")
        self.assertTrue(text.startswith(card["prompt"]))
        self.assertIn("하루카: 오셨어요?", text)
        self.assertIn(card["scene"], text)
        self.assertIn("감자·양파·고기·카레", text)
        self.assertLess(text.index("말투 예시"), text.index("지금 상황"))


if __name__ == "__main__":
    unittest.main()
