import unittest

from kiryu_ai.phone_events import resolve_phone_events, validate_phone_events


class PhoneEventsTests(unittest.TestCase):
    def test_strict_bounded_character_ids_only(self):
        for value in (
            None,
            (),
            {},
            "majima-call-short",
            ["unknown"],
            ["haruka-garden-checked"],
            ["majima-call-short"] * 2,
            ["majima-call-short"] * 5,
            [{"id": "majima-call-short", "text": "override"}],
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_phone_events("majima", value)
        ids = [
            "majima-call-missed",
            "majima-call-declined",
            "majima-call-short",
            "majima-call-completed",
        ]
        result = resolve_phone_events("majima", ids)
        self.assertEqual(result["metadata"]["ids"], ids)
        self.assertEqual([row["id"] for row in result["events"]], ids)
        self.assertNotEqual(
            result["metadata"]["sha256"],
            resolve_phone_events("majima", list(reversed(ids)))["metadata"]["sha256"],
        )
        ids.clear()
        self.assertEqual(len(result["metadata"]["ids"]), 4)
        haruka = resolve_phone_events(
            "haruka",
            [
                "haruka-shopping-checked",
                "haruka-garden-checked",
                "haruka-mame-checked",
                "haruka-uniform-checked",
            ],
        )
        self.assertTrue(
            all(
                row["character"] == "haruka" and "검증한 기록은 아니다" in row["text"]
                for row in haruka["events"]
            )
        )
        self.assertIn("거절되거나 취소", result["events"][1]["text"])


if __name__ == "__main__":
    unittest.main()
