import unittest
from urllib.parse import parse_qs, urlsplit

from kiryu_ai.share import invite_url, tunnel_endpoint


class ShareTests(unittest.TestCase):
    def test_invite_keeps_secret_out_of_server_query_and_path(self):
        link = invite_url("https://example.trycloudflare.com", "private+/=&key")
        parsed = urlsplit(link)
        self.assertEqual(parsed.netloc, "nam9nine.github.io")
        self.assertEqual(parsed.query, "")
        self.assertNotIn("private", parsed.path)
        self.assertEqual(parse_qs(parsed.fragment)["aiInvite"], ["private+/=&key"])

    def test_rejects_non_https_or_ambiguous_origins(self):
        for endpoint in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com/path",
            "https://example.com?key=1",
            "https://example.com#key",
            "https://example.com:8765",
        ]:
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                invite_url(endpoint, "key")

    def test_tunnel_log_parser_uses_only_https_quick_tunnel_hosts(self):
        self.assertIsNone(tunnel_endpoint("https://example.com"))
        self.assertEqual(
            tunnel_endpoint(
                "https://docs.example.org\n| https://valid-name.trycloudflare.com |"
            ),
            "https://valid-name.trycloudflare.com",
        )


if __name__ == "__main__":
    unittest.main()
