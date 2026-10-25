import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from kiryu_ai.chat_admin import COOKIE, create_admin_app
from kiryu_ai.chat_db import AXES, ChatDB
from starlette.testclient import TestClient

ORIGIN = "http://127.0.0.1:8767"
BOOTSTRAP = "CPU_UI_FIXTURE_ONLY_" + "x" * 32


def seed_fixture(db):
    """Synthetic owner-UI records, never claims about a model's actual output."""
    first = db.issue_session(now=1793000000)
    second = db.issue_session(now=1793000000)
    records = []
    fixtures = [
        (
            first,
            "majima",
            "오늘은 그냥 싸울 기분이 아니야.",
            "하앙? 갑자기 왜 빼는 긴데, 키류 쨩!",
            2.8,
            "v1",
        ),
        (
            first,
            "majima",
            "아까 다리를 다쳤어. 오늘은 싸울 수 없어.",
            "다쳤다고? 그럼 먼저 어디가 얼마나 다쳤는지 말해 봐라.",
            2.1,
            "v1",
        ),
        (
            second,
            "haruka",
            "카레 말고 우동으로 바꿀까?",
            "응, 그럼 우동으로 하자. 당근은 오늘 안 사도 돼, 아저씨.",
            3.2,
            "v2",
        ),
        (
            second,
            "haruka",
            "그럼 뭘 사가면 될까?",
            "아까 말한 카레 재료를 사 오면 돼.",
            24.5,
            "v2",
        ),
    ]
    for index, (session, character, user, reply, seconds, prompt) in enumerate(
        fixtures
    ):
        job, _ = db.accept(
            session["visitor_id"],
            character,
            "daily-if-v1",
            user,
            str(uuid4()),
            now=1793000001 + index * 120,
        )
        db.begin_run(
            job["job_id"],
            [{"role": "user", "content": user}],
            {
                "model": "CPU_UI_FIXTURE_ONLY",
                "prompt_version": prompt,
                "profile_version": "fixture-1",
                "input_message_ids": [],
                "secret": "NEVER_EXPORT_SECRET",
                "nested": {"api_key": "NEVER_EXPORT_KEY"},
                "system_snapshot": "UI 검증용 합성 자료. 실제 Gemma 추론 결과가 아닙니다.",
            },
            [
                {
                    "id": "fixture-memory-1",
                    "kind": "memory",
                    "text": "카레 계획을 우동으로 정정한 원문",
                    "visitor_id": session["visitor_id"],
                    "character_id": character,
                },
                {
                    "id": "fixture-fact-1",
                    "kind": "fact",
                    "text": "UI 검증용 원작 근거 자리표시자",
                    "source": "fixture://not-a-canon-source",
                },
            ],
            now=1793000002 + index * 120,
        )
        db.complete(
            job["job_id"],
            reply,
            {"total_seconds": seconds, "ttft_seconds": 0.8, "queue_seconds": 0},
            now=1793000006 + index * 120,
        )
        records.append(job)
    failed, _ = db.accept(
        first["visitor_id"],
        "majima",
        "daily-if-v1",
        "어디에서 만나면 돼?",
        str(uuid4()),
        now=1793000600,
    )
    db.begin_run(
        failed["job_id"], [], {"model": "CPU_UI_FIXTURE_ONLY", "prompt_version": "v2"}
    )
    db.fail(
        failed["job_id"],
        "response_truncated",
        "<script>window.fixtureXss = true</script> 미완성 답장",
        {"total_seconds": 61.0},
    )
    records.append(failed)
    db.save_review(
        records[0]["job_id"],
        reviewer="fixture-owner",
        axes=dict.fromkeys(AXES, "appropriate"),
        note="합성 자료의 검토 예시. 팬 판정 아님.",
    )
    return {"sessions": [first, second], "jobs": records}


class ChatAdminTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.db = ChatDB(self.root / "private/chat.sqlite3")
        self.fixture = seed_fixture(self.db)
        self.app = create_admin_app(
            self.db, bootstrap_token=BOOTSTRAP, signing_secret=b"x" * 32
        )
        self.client = TestClient(self.app, base_url=ORIGIN)
        self.client.__enter__()
        self.csrf = None

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temporary.cleanup()

    def login(self):
        response = self.client.post(
            "/v1/admin/session", json={"token": BOOTSTRAP}, headers={"Origin": ORIGIN}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.csrf = self.client.get("/v1/admin/session").json()["csrf"]
        return response

    def post(self, path, value):
        return self.client.post(
            path,
            json=value,
            headers={"Origin": ORIGIN, "X-CSRF-Token": self.csrf or ""},
        )

    def test_bootstrap_is_single_use_and_cookie_is_private(self):
        response = self.login()
        cookie = response.headers["set-cookie"].lower()
        self.assertIn("httponly", cookie)
        self.assertIn("samesite=strict", cookie)
        self.assertNotIn(BOOTSTRAP, cookie)
        self.assertIsNone(self.app.state.owner.bootstrap_token)
        replay = self.client.post(
            "/v1/admin/session", json={"token": BOOTSTRAP}, headers={"Origin": ORIGIN}
        )
        self.assertEqual(replay.status_code, 401)

    def test_anonymous_cannot_read_or_export_private_data(self):
        for path in (
            "/v1/admin/queue",
            "/v1/admin/stats",
            "/v1/admin/session",
            f"/v1/admin/cases/{self.fixture['jobs'][0]['job_id']}",
        ):
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(
            self.post(
                "/v1/admin/export", {"job_ids": [self.fixture["jobs"][0]["job_id"]]}
            ).status_code,
            401,
        )

    def test_origin_and_host_rebinding_are_rejected(self):
        self.login()
        for headers in (
            {"Origin": "https://evil.example"},
            {"Origin": "null"},
            {"Host": "evil.example:8767"},
            {"Host": "127.0.0.1:8765"},
            {"Host": "localhost:8767"},
        ):
            self.assertEqual(
                self.client.get("/v1/admin/queue", headers=headers).status_code, 403
            )
        self.assertEqual(
            self.client.post(
                "/v1/admin/logout", headers={"X-CSRF-Token": self.csrf}
            ).status_code,
            403,
        )

    def test_csrf_required_even_with_authenticated_cookie(self):
        self.login()
        value = {"axes": dict.fromkeys(AXES, "appropriate")}
        path = f"/v1/admin/cases/{self.fixture['jobs'][0]['job_id']}/reviews"
        self.assertEqual(
            self.client.post(path, json=value, headers={"Origin": ORIGIN}).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                path, json=value, headers={"Origin": ORIGIN, "X-CSRF-Token": "bad"}
            ).status_code,
            403,
        )
        self.assertEqual(self.post(path, value).status_code, 201)

    def test_cookie_tamper_expiry_and_logout_revocation(self):
        self.login()
        old = self.client.cookies.get(COOKIE)
        self.client.cookies.clear()
        self.client.cookies.set(COOKIE, old[:-1] + ("a" if old[-1] != "a" else "b"))
        self.assertEqual(self.client.get("/v1/admin/queue").status_code, 401)
        self.client.cookies.clear()
        self.client.cookies.set(COOKIE, old)
        with patch("kiryu_ai.chat_admin.time.time", return_value=9999999999):
            self.assertEqual(self.client.get("/v1/admin/queue").status_code, 401)
        self.assertEqual(self.post("/v1/admin/logout", {}).status_code, 200)
        self.client.cookies.set(COOKIE, old)
        self.assertEqual(self.client.get("/v1/admin/queue").status_code, 401)

    def test_queue_filters_and_priority(self):
        self.login()
        cases = self.client.get("/v1/admin/queue").json()["cases"]
        self.assertEqual(len(cases), 5)
        self.assertEqual(cases[0]["status"], "error")
        self.assertEqual(cases[1]["metrics"]["total_seconds"], 24.5)
        self.assertEqual(
            len(
                self.client.get(
                    "/v1/admin/queue?character=haruka&query=카레&model=CPU_UI_FIXTURE_ONLY&prompt=v2"
                ).json()["cases"]
            ),
            2,
        )
        self.assertEqual(
            len(self.client.get("/v1/admin/queue?unreviewed=true").json()["cases"]), 4
        )
        self.assertEqual(
            len(self.client.get("/v1/admin/queue?errors_only=true").json()["cases"]), 1
        )
        self.assertEqual(
            len(
                self.client.get("/v1/admin/queue?random_sample=true&limit=2").json()[
                    "cases"
                ]
            ),
            2,
        )
        foreign = self.fixture["sessions"][1]["visitor_id"]
        self.assertEqual(
            len(self.client.get(f"/v1/admin/queue?visitor={foreign}").json()["cases"]),
            2,
        )
        self.assertEqual(self.client.get("/v1/admin/queue?offset=-1").status_code, 400)
        self.assertEqual(
            self.client.get("/v1/admin/queue?after=not-a-date").status_code, 400
        )

    def test_detail_contains_context_evidence_and_redacts_infrastructure_secrets(self):
        self.login()
        job = self.fixture["jobs"][2]
        response = self.client.get(f"/v1/admin/cases/{job['job_id']}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["messages"]), 4)
        self.assertEqual(data["retrieval_hits"][0]["kind"], "memory")
        self.assertNotIn("NEVER_EXPORT", response.text)
        self.assertNotIn(self.fixture["sessions"][1]["token"], response.text)
        self.assertNotIn("token_hash", response.text)

    def test_saving_review_never_changes_original_or_approves_training(self):
        self.login()
        job = self.fixture["jobs"][3]
        original = self.db.history(
            job["visitor_id"], job["character"], job["scenario_version"]
        )
        axes = dict.fromkeys(AXES, "unrated")
        axes["context"] = "problem"
        response = self.post(
            f"/v1/admin/cases/{job['job_id']}/reviews",
            {
                "axes": axes,
                "tags": ["정정 무시", "옛 약속 부활"],
                "cause": "memory",
                "note": "카레를 우동으로 바꾼 정정을 놓쳤다.",
                "improved_answer": "우동 면을 사 오면 돼, 아저씨.",
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()["training_eligible"])
        self.assertEqual(
            self.db.history(
                job["visitor_id"], job["character"], job["scenario_version"]
            ),
            original,
        )
        rejected = self.post(
            f"/v1/admin/cases/{job['job_id']}/reviews",
            {"axes": axes, "training_eligible": True},
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(
            self.post(
                f"/v1/admin/cases/{job['job_id']}/reviews",
                {"axes": {"context": "problem"}},
            ).status_code,
            400,
        )

    def test_stats_denominators_use_latest_review_and_exclude_unrated(self):
        self.login()
        job = self.fixture["jobs"][0]
        axes = dict.fromkeys(AXES, "unrated")
        axes["judgment"] = "problem"
        self.post(f"/v1/admin/cases/{job['job_id']}/reviews", {"axes": axes})
        groups = self.client.get("/v1/admin/stats?prompt=v1").json()["groups"]
        self.assertEqual(sum(group["total"] for group in groups), 2)
        self.assertEqual(sum(group["reviewed"] for group in groups), 1)
        self.assertEqual(
            sum(group["axes"]["judgment"]["problem"] for group in groups), 1
        )
        self.assertEqual(sum(group["axes"]["speech"]["rated"] for group in groups), 0)

    def test_export_is_selected_jsonl_with_context_and_training_false(self):
        self.login()
        identifiers = [
            self.fixture["jobs"][0]["job_id"],
            self.fixture["jobs"][4]["job_id"],
        ]
        response = self.post("/v1/admin/export", {"job_ids": identifiers})
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response.headers["content-disposition"])
        rows = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual([row["job_id"] for row in rows], identifiers)
        self.assertTrue(all(row["training_eligible"] is False for row in rows))
        self.assertIn("미완성 답장", rows[1]["run"]["output_text"])
        for value in [
            BOOTSTRAP,
            self.csrf,
            self.client.cookies.get(COOKIE),
            "NEVER_EXPORT_SECRET",
            "NEVER_EXPORT_KEY",
            *[session["token"] for session in self.fixture["sessions"]],
        ]:
            self.assertNotIn(value, response.text)

    def test_static_security_headers_and_no_public_model_routes(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertIn(
            "frame-ancestors 'none'", response.headers["content-security-policy"]
        )
        self.assertNotIn("access-control-allow-origin", response.headers)
        for path in (
            "/v1/chat",
            "/v1/chat/completions",
            "/admin-signing.key",
            "/assets/unknown",
        ):
            self.assertEqual(self.client.get(path).status_code, 404)


if __name__ == "__main__":
    unittest.main()
