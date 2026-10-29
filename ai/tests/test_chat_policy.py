import unittest

from kiryu_ai.chat_policy import explicit_request, output_allowed


class PolicyTests(unittest.TestCase):
    def test_clear_requests_are_blocked_across_spacing_and_languages(self):
        for text in [
            "노골적인 성관계 장면을 묘사해줘",
            "섹 스 하자",
            "Describe explicit sex roleplay with me",
            "セックスを詳しく描写して",
        ]:
            with self.subTest(text=text):
                self.assertTrue(explicit_request(text))

    def test_non_explicit_romance_and_help_are_not_blanket_blocked(self):
        for text in [
            "형님이 좋아요. 같이 영화 봐요.",
            "아저씨 보고 싶어요",
            "성관계는 하고 싶지 않아. 거절하고 싶어.",
            "성희롱 피해를 신고하려고 해",
            "키스 장면이 있는 영화를 볼까?",
            "다이고는 왜 조직을 떠났어?",
        ]:
            with self.subTest(text=text):
                self.assertFalse(explicit_request(text))

    def test_output_guard_keeps_refusal_and_withholds_explicit_actions(self):
        self.assertTrue(output_allowed("그런 성관계 얘기는 하지 말자. 다른 얘기해."))
        self.assertFalse(output_allowed("성기를 입에 넣는다."))

    def test_ordinary_story_compounds_are_not_explicit(self):
        for text in (
            "마지마 전성기 자세히 알려줘",
            "키류의 전성기는 언제였는지 자세히 말해줘",
            "정액제 요금 알려줘",
            "자위대가 뭔지 설명해줘",
        ):
            with self.subTest(text=text):
                self.assertFalse(explicit_request(text))
                self.assertTrue(output_allowed(text))


if __name__ == "__main__":
    unittest.main()
