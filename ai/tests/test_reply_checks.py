import unittest

from kiryu_ai.gemma_engine import GemmaFailure
from kiryu_ai.reply_checks import (
    _order,
    _without_complaint,
    inspect,
    judge_messages,
    parse_pick,
    select_reply,
)


def done(text):
    return {"reply": text, "finish_reason": "stop"}


class InspectTests(unittest.TestCase):
    def test_scolding_is_a_fault_only_after_a_short_answer(self):
        scold = "겨우 '네' 하나뿐이가? 대답이 너무 무심하네."
        self.assertIn(
            "scolds_short_reply",
            inspect(scold, character="majima", user_message="네")["hard"],
        )
        self.assertEqual(
            inspect(
                "니 대답이 왜 이리 짧노 했던 거 기억나나",
                character="majima",
                user_message="그때 일 기억나세요?",
            )["hard"],
            [],
        )
        self.assertEqual(
            inspect(
                "그라믄 됐다. 심심해지면 연락해래이.",
                character="majima",
                user_message="네",
            )["hard"],
            [],
        )

    def test_meta_wording_and_stage_directions_are_faults(self):
        self.assertIn(
            "meta_wording",
            inspect("브라우저 이벤트를 확인했다.", character="haruka")["hard"],
        )
        self.assertIn(
            "stage_direction", inspect("마지마: 그래.", character="majima")["hard"]
        )
        self.assertIn(
            "stage_direction", inspect("(웃으며) 그래요.", character="haruka")["hard"]
        )

    def test_repetition_is_penalised_against_recent_texts(self):
        previous = ["갑자기 와 이라노?", "키류쨩, 뭐 하노?", "뭐꼬, 또 무슨 일이고?"]
        result = inspect(
            "갑자기 뭔 소리꼬, 키류쨩?", character="majima", previous=previous
        )
        self.assertIn("repeated_catchphrase", result["soft"])
        self.assertIn("question_streak", result["soft"])
        self.assertGreater(
            result["penalty"],
            inspect("그래, 또 연락하께.", character="majima", previous=previous)[
                "penalty"
            ],
        )
        self.assertIn(
            "repeated_opener",
            inspect("와, 고마워요!", character="haruka", previous=["와, 진짜요?"])[
                "soft"
            ],
        )
        self.assertIn(
            "near_duplicate",
            inspect(
                "키류쨩, 전화 왜 안 받노? 얼른 연락해라!",
                character="majima",
                previous=["키류쨩, 전화 왜 안 받노? 얼른 연락 좀 해라!"],
            )["soft"],
        )
        self.assertIn(
            "unanswerable_question",
            inspect("저녁은 몇 시에 먹어요?", character="haruka")["soft"],
        )

    def test_real_model_scold_variants_after_receipts_are_faults(self):
        # Seen in Issue #133 runs on the real model after '그렇군요.' and 'ㅎㅎ'.
        for text, message in (
            ("대답이 참 시원찮네. 시간 된다 카면 연락해라.", "그렇군요."),
            ("웃음으로 대충 넘기지 말고 대답을 해라.", "ㅎㅎ"),
            ("웃기만 하고 대답은 없네.", "ㅎㅎ"),
        ):
            self.assertIn(
                "scolds_short_reply",
                inspect(text, character="majima", user_message=message)["hard"],
                text,
            )
        self.assertIn(
            "scolds_short_reply",
            inspect("니 대답 좀 해 봐라.", character="majima", user_message="ㅎㅎ")[
                "hard"
            ],
        )
        # Ordinary words and narration that only look like the patterns.
        for text, message in (
            ("웃기는 소리 하지 마라.", "ㅋㅋ"),
            ("술 한잔하자.", "네"),
            ("오늘 술 한잔 했나? 안 했으면 온나.", "응"),
            ("내가 말했제, 밤바람 차갑다꼬. 따뜻하게 입어라.", "춥네요"),
            ("말 그대로 흙이 딱딱했죠? 고마워요, 아저씨.", "물 줬어요"),
            ("니 얘기 들으니 웃음만 나온다. 내일 보자.", "ㅋㅋ"),
            ("대답도 없이 가 버리더라.", "네"),
            ("아, 우유 사 달라는 거 깜빡했어요. 다음에 부탁해요.", "응."),
            ("gif 보내 줄게요.", "응."),
        ):
            result = inspect(text, character="majima", user_message=message)
            self.assertEqual(result["hard"], [], text)
            self.assertNotIn("blames_memory_health_or_drink", result["soft"], text)

    def test_receipts_count_as_short_answers_and_remarks_are_penalised(self):
        self.assertIn(
            "scolds_short_reply",
            inspect(
                "대답이 왜 이리 무미건조하노.",
                character="majima",
                user_message="그렇군요.",
            )["hard"],
        )
        self.assertIn(
            "blames_memory_health_or_drink",
            inspect(
                "니 오늘 술이라도 한잔 마셨나?",
                character="majima",
                user_message="형님 보고 싶었습니다.",
            )["soft"],
        )
        self.assertEqual(
            inspect("술 한잔 마시자.", character="majima", user_message="네")["soft"],
            [],
        )
        self.assertIn(
            "remarks_on_politeness",
            inspect(
                "뭘 그리 깍듯하게 구노, 징그럽게.",
                character="majima",
                user_message="안녕하십니까, 형님.",
            )["soft"],
        )

    def test_ordinary_idioms_are_not_scolding_and_canned_lines_are_penalised(self):
        for text, message in (
            ("말 나온 김에 짧게 한 판 하자!", "네."),
            ("말도 마, 손이 차갑다.", "추워."),
            ("시스템? 그런 거 모른다.", "시스템 같은 거 있어?"),
            ("아 맞다, 깜빡했나 봐요. 감자 사 왔어요?", "응."),
        ):
            result = inspect(text, character="haruka", user_message=message)
            self.assertEqual(result["hard"], [], text)
            self.assertNotIn("blames_memory_health_or_drink", result["soft"], text)
        self.assertIn(
            "repeated_sentence",
            inspect(
                "그래, 그럼 이따 보자고. 늦지 말고 잘 찾아온나!",
                character="majima",
                previous=["좋네! 그럼 이따가 함 보자고. 늦지 말고 잘 찾아온나."],
            )["soft"],
        )

    def test_majimas_nickname_is_free_once_but_not_twice_in_a_row(self):
        self.assertEqual(inspect("그래, 키류쨩.", character="majima")["penalty"], 0)
        self.assertIn(
            "repeated_catchphrase",
            inspect("그래, 키류쨩.", character="majima", previous=["뭐 하노, 키류쨩?"])[
                "soft"
            ],
        )

    def test_copying_an_authored_example_or_blaming_memory_is_penalised(self):
        example = "숙제라… 그건 빼먹으면 안 되제. 그래, 애들 잘 봐 줘라."
        self.assertIn(
            "copies_example",
            inspect(
                "숙제라… 그건 빼먹으면 안 되제. 그래, 애들 잘 봐 줘라!",
                character="majima",
                examples=[example],
            )["hard"],
        )
        self.assertIn(
            "echoes_example",
            inspect(
                "숙제라… 그건 빼먹으면 안 되제. 그래, 잘 해라.",
                character="majima",
                examples=[example],
            )["soft"],
        )
        result = inspect("그래, 푹 쉬어라.", character="majima", examples=[example])
        self.assertEqual((result["hard"], result["soft"]), ([], []))
        self.assertIn(
            "blames_memory_health_or_drink",
            inspect(
                "벌써 까묵었나? 나이 묵었네.",
                character="majima",
                user_message="제가 아까 뭐라고 했었죠?",
            )["soft"],
        )


def raising(*items):
    """A generator stub that returns results and raises failures in order."""
    queue = iter(items)
    calls = []

    def generate():
        calls.append(1)
        item = next(queue)
        if isinstance(item, Exception):
            raise item
        return item

    return generate, calls


class SelectTests(unittest.TestCase):
    def test_lowest_penalty_wins_and_audit_keeps_every_candidate(self):
        outputs = iter(
            [
                done("대답이 왜 이리 짧노?"),
                done("갑자기 그라노, 키류쨩."),
                done("그래, 또 연락하께."),
            ]
        )
        result, audit = select_reply(
            lambda: next(outputs), character="majima", user_message="네"
        )
        self.assertEqual(result["reply"], "그래, 또 연락하께.")
        self.assertEqual(audit["chosen"], 2)
        self.assertEqual(audit["candidates"][0]["hard"], ["scolds_short_reply"])
        self.assertEqual(len(audit["candidates"]), 3)

    def test_a_fully_faulty_round_draws_one_more_round_then_least_faulty(self):
        outputs = iter(
            [
                done("대답이 짧노"),
                done("무뚝뚝하네"),
                done("좋다, 다음에 보자."),
                done("대답이 짧노"),
            ]
        )
        result, audit = select_reply(
            lambda: next(outputs), character="majima", user_message="응", count=2
        )
        self.assertEqual(result["reply"], "좋다, 다음에 보자.")
        self.assertEqual(len(audit["candidates"]), 4)
        faulty = iter([done("대답이 짧노")] * 4)
        result, audit = select_reply(
            lambda: next(faulty), character="majima", user_message="응", count=2
        )
        self.assertEqual(audit["reason"], "least_faulty")

    def test_when_every_sample_scolds_only_the_complaint_is_removed(self):
        outputs = iter(
            [
                done("대답이 왜 이리 짧노? 섭섭하게시리. 그럼 나중에 연락해라."),
                done("대답이 너무 무뚝뚝한 거 아이가?"),
            ]
            * 2
        )
        result, audit = select_reply(
            lambda: next(outputs),
            character="majima",
            user_message="그렇군요.",
            count=2,
            repair_complaints=True,
        )
        self.assertEqual(result["reply"], "그럼 나중에 연락해라.")
        self.assertEqual(audit["reason"], "complaint_removed")
        self.assertIn("섭섭하게시리", audit["candidates"][audit["chosen"]]["reply"])
        # A question keeps its answer: no removal, the least faulty text stands.
        scold = "대답이 짧네, 7시에 볼링장 온나. 기다린다."
        for message, repair, reason in (
            ("몇 시예요?", True, "least_faulty"),
            ("그렇군요.", False, "least_faulty"),
            ("그렇군요.", True, "complaint_removed"),
        ):
            result, audit = select_reply(
                lambda: done(scold),
                character="majima",
                user_message=message,
                count=1,
                repair_complaints=repair,
            )
            self.assertEqual(audit["reason"], reason, message)
        self.assertEqual(result["reply"], "7시에 볼링장 온나. 기다린다.")

    def test_tied_repairs_go_to_the_judge_like_any_tie(self):
        scolds = iter(
            [
                done("대답이 너무 무뚝뚝한 거 아이가. 진짜 안 나올 끼면 말해라."),
                done("대답이 참 시원찮네. 시간 된다 카면 연락해라."),
            ]
            * 2
        )
        seen = []

        def judge(candidates):
            seen.append(candidates)
            return candidates.index("시간 된다 카면 연락해라.")

        result, audit = select_reply(
            lambda: next(scolds),
            character="majima",
            user_message="그렇군요.",
            count=2,
            judge=judge,
            repair_complaints=True,
        )
        self.assertEqual(result["reply"], "시간 된다 카면 연락해라.")
        self.assertEqual(audit["reason"], "complaint_removed")
        self.assertTrue(audit["judge_picked"])
        self.assertEqual(len(seen), 1)

    def test_pressing_for_an_answer_is_a_fault_but_having_nothing_to_say_is_not(self):
        for text in ("대답은 안 하나?", "왜 대답이 없노", "답이 없네", "말 한번 짧네"):
            self.assertIn(
                "scolds_short_reply",
                inspect(text, character="majima", user_message="네")["hard"],
                text,
            )
        for text, message in (
            ("할 말이 없네.", "네."),
            ("답장이 늦었죠, 짧게 쓸게요.", "응."),
            ("봐 주실래요?", "응."),
        ):
            self.assertEqual(
                inspect(text, character="haruka", user_message=message)["hard"],
                [],
                text,
            )
        self.assertIn(
            "blames_memory_health_or_drink",
            inspect("아빠 깜빡했죠?", character="haruka", user_message="네")["soft"],
        )

    def test_complaint_removal_never_keeps_a_reproach_or_its_concession(self):
        self.assertIsNone(_without_complaint("대답이 짧네. 이번만 봐주께, 키류 쨩."))
        self.assertIsNone(
            _without_complaint(
                "대답이 왜 이리 짧노. 이번엔 봐준다, 키류 쨩. 7시에 온나."
            )
        )
        self.assertIsNone(
            _without_complaint("대답이 왜 이리 짧노. 그렇지만 7시에 온나 키류야.")
        )
        self.assertEqual(
            _without_complaint(
                "대답이 너무 무뚝뚝한 거 아이가? 뭐, 됐다. 나중에라도 생각나면 연락해라."
            ),
            "나중에라도 생각나면 연락해라.",
        )
        self.assertEqual(
            _without_complaint("내일 7시 볼링장이다. 대답이 짧네. 그래도 꼭 온나."),
            "내일 7시 볼링장이다.",
        )

    def test_unfinished_output_is_never_chosen_over_a_finished_text(self):
        outputs = iter(
            [{"reply": "잘린 답", "finish_reason": "length"}, done("그래요.")]
        )
        result, _ = select_reply(lambda: next(outputs), character="haruka", count=2)
        self.assertEqual(result["reply"], "그래요.")
        blocked = iter([{"reply": "", "finish_reason": "length"}] * 2)
        result, audit = select_reply(lambda: next(blocked), character="haruka", count=1)
        self.assertEqual(audit["reason"], "no_usable_candidate")
        self.assertEqual(result["finish_reason"], "length")

    def test_errors_are_raised_when_no_sample_exists(self):
        def fail():
            raise RuntimeError("model down")

        with self.assertRaises(RuntimeError):
            select_reply(fail, character="haruka", count=2)

    def test_systemic_model_failures_stop_sampling_at_once(self):
        generate, calls = raising(GemmaFailure("generation_timeout"))
        with self.assertRaises(GemmaFailure) as caught:
            select_reply(generate, character="majima", count=3)
        self.assertEqual(caught.exception.code, "generation_timeout")
        self.assertEqual(len(calls), 1)
        generate, calls = raising(
            done("그래, 또 보자."), GemmaFailure("model_unavailable")
        )
        result, audit = select_reply(generate, character="majima", count=3)
        self.assertEqual(result["reply"], "그래, 또 보자.")
        self.assertEqual(audit["errors"], ["model_unavailable"])
        self.assertEqual(len(calls), 2)

    def test_failed_samples_are_replaced_but_never_earn_a_second_round(self):
        generate, calls = raising(*[GemmaFailure("response_truncated")] * 6)
        with self.assertRaises(GemmaFailure):
            select_reply(generate, character="haruka", count=3)
        self.assertEqual(len(calls), 3)
        generate, calls = raising(
            GemmaFailure("response_truncated"), done("그래요."), done("네.")
        )
        _, audit = select_reply(generate, character="haruka", count=3)
        self.assertEqual(audit["errors"], ["response_truncated"])
        self.assertEqual(len(audit["candidates"]), 2)

    def test_stale_work_stops_before_the_next_sample_and_the_judge(self):
        generate, calls = raising(done("그래, 또 보자."), done("좋다."))
        _, audit = select_reply(
            generate, character="majima", count=2, keep_going=lambda: False
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(audit["candidates"]), 1)
        answers = iter([True, False])
        generate, _ = raising(done("그래, 또 보자."), done("좋다, 연락하께."))
        _, audit = select_reply(
            generate,
            character="majima",
            count=2,
            judge=lambda _: self.fail("stale work is not judged"),
            keep_going=lambda: next(answers),
        )
        self.assertEqual(audit["reason"], "lowest_penalty")

    def test_judge_breaks_only_exact_ties_in_shuffled_order(self):
        outputs = iter([done("그래, 또 보자."), done("좋다, 연락하께.")])
        seen = []

        def judge(candidates):
            seen.append(candidates)
            return 1

        result, audit = select_reply(
            lambda: next(outputs), character="majima", count=2, judge=judge, seed="job"
        )
        order = _order(2, "job")
        self.assertEqual(
            seen[0], [["그래, 또 보자.", "좋다, 연락하께."][i] for i in order]
        )
        self.assertEqual(result["reply"], seen[0][1])
        self.assertEqual(audit["reason"], "judge_tiebreak")
        untied = iter([done("갑자기 그래?"), done("그래, 다음에.")])
        select_reply(
            lambda: next(untied),
            character="majima",
            count=2,
            judge=lambda _: self.fail("no tie"),
        )

    def test_judge_prompt_and_parsing(self):
        prompt = judge_messages(
            "마지마",
            "나는 마지마 고로다.",
            [{"role": "user", "content": "네"}],
            ["가", "나"],
        )
        self.assertIn("키류: 네", prompt[1]["content"])
        self.assertIn("2. 나", prompt[1]["content"])
        self.assertEqual(parse_pick("2번", 2), 1)
        self.assertIsNone(parse_pick("세 번째", 2))
        self.assertIsNone(parse_pick("7", 2))


if __name__ == "__main__":
    unittest.main()
