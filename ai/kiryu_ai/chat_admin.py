"""Mac-only conversation review, isolated from the public chat API.

Start with ``python -m kiryu_ai.chat_admin --database /private/path/chat.sqlite3``.
The printed one-time URL establishes an owner cookie. Never publish this port or
add its routes to the public Worker/Tunnel allowlist.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo

from starlette.applications import Starlette
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route

from .chat_db import AXES, CAUSES, RATINGS, ChatDB, digest, json_text

COOKIE = "kiryu_owner"
SESSION_SECONDS = 8 * 60 * 60
BODY_LIMIT = 64 * 1024
TAGS = (
    "말투 불일치",
    "성격 판단 오류",
    "관계 오류",
    "사실 창작",
    "정정 무시",
    "옛 약속 부활",
    "반복",
    "문자 형식 오류",
)
SECRET_FIELDS = frozenset(
    {
        "token",
        "token_hash",
        "invite_key",
        "authorization",
        "cookie",
        "secret",
        "secret_key",
        "admin_key",
        "owner_key",
        "bootstrap_token",
        "csrf",
        "csrf_token",
        "password",
        "api_key",
        "access_token",
    }
)


class AdminFailure(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def failure(status, code, message):
    return JSONResponse(
        {"error": {"code": code, "message": message}}, status_code=status
    )


def redact(value):
    """Exclude accidental infrastructure secrets in metadata and exports."""
    if isinstance(value, dict):
        return {
            key: redact(item)
            for key, item in value.items()
            if key.lower().replace("-", "_") not in SECRET_FIELDS
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


def owner_secret(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    if path.is_symlink():
        raise ValueError("Owner secret cannot be a symbolic link")
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        path.chmod(0o600)
        secret = path.read_bytes()
    else:
        secret = secrets.token_bytes(32)
        with os.fdopen(descriptor, "wb") as output:
            output.write(secret)
            output.flush()
            os.fsync(output.fileno())
    if len(secret) != 32:
        raise ValueError("Invalid owner secret")
    return secret


class OwnerSession:
    def __init__(self, secret, *, bootstrap_token=None):
        self.secret = secret
        self.bootstrap_token = bootstrap_token or secrets.token_urlsafe(32)
        self.bootstrap_digest = digest(self.bootstrap_token)
        self.instance = secrets.token_hex(16)
        self.revoked = set()

    def issue(self, token):
        if (
            not self.bootstrap_digest
            or not isinstance(token, str)
            or not hmac.compare_digest(digest(token), self.bootstrap_digest)
        ):
            raise AdminFailure(
                401,
                "invalid_bootstrap",
                "일회용 검토 링크가 유효하지 않습니다. Mac 터미널에서 새로 실행해 주세요.",
            )
        self.bootstrap_digest = None
        self.bootstrap_token = None
        claims = {
            "id": secrets.token_hex(16),
            "expires": int(time.time()) + SESSION_SECONDS,
            "instance": self.instance,
        }
        payload = (
            base64.urlsafe_b64encode(json_text(claims).encode()).decode().rstrip("=")
        )
        signature = hmac.new(self.secret, payload.encode(), hashlib.sha256).hexdigest()
        return payload + "." + signature

    def authenticate(self, request, *, mutate=False):
        cookie = request.cookies.get(COOKIE, "")
        try:
            if len(cookie) > 1024:
                raise ValueError
            payload, signature = cookie.split(".")
            expected = hmac.new(
                self.secret, payload.encode(), hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(signature, expected):
                raise ValueError
            claims = json.loads(
                base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
            )
            if (
                claims["instance"] != self.instance
                or claims["expires"] <= time.time()
                or claims["id"] in self.revoked
            ):
                raise ValueError
        except (ValueError, KeyError, TypeError, UnicodeError) as error:
            raise AdminFailure(
                401, "owner_required", "Mac의 일회용 검토 링크로 열어 주세요."
            ) from error
        csrf = hmac.new(
            self.secret, ("csrf:" + cookie).encode(), hashlib.sha256
        ).hexdigest()
        if mutate and not hmac.compare_digest(
            request.headers.get("x-csrf-token", ""), csrf
        ):
            raise AdminFailure(
                403, "csrf_denied", "검토 세션을 새로고침한 뒤 다시 시도해 주세요."
            )
        return claims, csrf


class LocalOnlyMiddleware:
    def __init__(self, app, origin):
        self.app, self.origin = app, origin
        self.host = origin.removeprefix("http://")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = scope["headers"]
        hosts = [
            value.decode("latin-1")
            for name, value in headers
            if name.lower() == b"host"
        ]
        origins = [
            value.decode("latin-1")
            for name, value in headers
            if name.lower() == b"origin"
        ]
        started = False

        async def secure_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                message["headers"] = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower()
                    not in (b"cache-control", b"access-control-allow-origin")
                ] + [
                    (b"cache-control", b"no-store"),
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                    (
                        b"content-security-policy",
                        b"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
                    ),
                ]
            await send(message)

        unsafe = scope["method"] not in ("GET", "HEAD")
        if (
            hosts != [self.host]
            or (origins and origins != [self.origin])
            or (unsafe and origins != [self.origin])
        ):
            await failure(
                403,
                "local_origin_required",
                "관리자 화면은 지정된 Mac 로컬 주소에서만 사용할 수 있습니다.",
            )(scope, receive, secure_send)
            return
        try:
            await self.app(scope, receive, secure_send)
        except AdminFailure as error:
            if not started:
                await failure(error.status, error.code, error.message)(
                    scope, receive, secure_send
                )
        except Exception:  # noqa: BLE001 -- exceptions can contain private dialogues
            if not started:
                await failure(500, "review_error", "검토 자료를 처리하지 못했습니다.")(
                    scope, receive, secure_send
                )


async def read_body(request):
    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip()
        != "application/json"
    ):
        raise AdminFailure(415, "json_required", "JSON 요청이 필요합니다.")
    raw = bytearray()
    try:
        async with asyncio.timeout(10):
            async for block in request.stream():
                raw.extend(block)
                if len(raw) > BODY_LIMIT:
                    raise AdminFailure(413, "body_limit", "검토 내용이 너무 깁니다.")
    except TimeoutError as error:
        raise AdminFailure(408, "body_timeout", "요청을 다시 보내 주세요.") from error
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise TypeError
    except (ValueError, TypeError) as error:
        raise AdminFailure(400, "invalid_json", "요청 형식을 확인해 주세요.") from error
    return data


def filters(request):
    params = request.query_params
    result = {}
    for name in ("character", "visitor", "query", "model", "prompt"):
        value = params.get(name, "").strip()
        if len(value) > 512:
            raise AdminFailure(400, "invalid_filter", "필터 값이 너무 깁니다.")
        if value:
            result[name] = value
    if result.get("character") not in (None, "haruka", "majima"):
        raise AdminFailure(400, "invalid_filter", "인물 필터를 확인해 주세요.")
    for name in ("after", "before"):
        value = params.get(name, "")
        if value:
            try:
                datetime.fromisoformat(value)
            except ValueError as error:
                raise AdminFailure(
                    400, "invalid_filter", "날짜 필터를 확인해 주세요."
                ) from error
            result[name] = value
    for name in ("unreviewed", "errors_only", "random_sample"):
        if params.get(name, "") in ("true", "1"):
            result[name] = True
    try:
        result["offset"] = int(params.get("offset", "0"))
        result["limit"] = int(params.get("limit", "50"))
        if result["offset"] < 0 or not 1 <= result["limit"] <= 100:
            raise ValueError
    except ValueError as error:
        raise AdminFailure(
            400, "invalid_filter", "페이지 범위를 확인해 주세요."
        ) from error
    return result


def stats(db, options):
    conditions = ["r.status IN ('complete','error','interrupted')"]
    values = []
    for column, option, operator in (
        ("r.character_id", "character", "="),
        ("r.visitor_id", "visitor", "="),
        ("r.accepted_at", "after", ">="),
        ("r.accepted_at", "before", "<"),
    ):
        if option in options:
            conditions.append(
                "julianday(" + column + ")" + operator + "julianday(?)"
                if option in ("after", "before")
                else column + operator + "?"
            )
            values.append(options[option])
    if options.get("query"):
        conditions.append(
            "EXISTS(SELECT 1 FROM messages m WHERE m.job_id=r.job_id AND instr(lower(m.content),lower(?))>0)"
        )
        values.append(options["query"])
    if options.get("unreviewed"):
        conditions.append("v.review_id IS NULL")
    if options.get("errors_only"):
        conditions.append("r.status IN ('error','interrupted')")
    for name, path in (("model", "$.model"), ("prompt", "$.prompt_version")):
        if options.get(name):
            conditions.append("json_extract(g.metadata_json,?)=?")
            values.extend([path, options[name]])
    groups = defaultdict(
        lambda: {
            "total": 0,
            "reviewed": 0,
            "failed": 0,
            "slow": 0,
            "axes": {
                axis: {"rated": 0, "problem": 0, "partial": 0, "appropriate": 0}
                for axis in AXES
            },
        }
    )
    with db.connection() as connection:
        rows = connection.execute(
            "SELECT r.accepted_at,r.status,g.metadata_json,g.metrics_json,v.axes_json FROM requests r "
            "LEFT JOIN generation_runs g ON g.job_id=r.job_id "
            "LEFT JOIN reviews v ON v.review_id=(SELECT review_id FROM reviews WHERE job_id=r.job_id ORDER BY created_at DESC,review_id DESC LIMIT 1) WHERE "
            + " AND ".join(conditions),
            values,
        )
        for row in rows:
            metadata = json.loads(row["metadata_json"] or "{}")
            metrics = json.loads(row["metrics_json"] or "{}")
            try:
                day = (
                    datetime.fromisoformat(row["accepted_at"])
                    .astimezone(ZoneInfo("Asia/Seoul"))
                    .strftime("%Y-%m-%d")
                )
            except ValueError:
                day = "시각 미상"
            key = (
                day,
                str(metadata.get("model", "미상")),
                str(metadata.get("prompt_version", "미상")),
            )
            group = groups[key]
            group["total"] += 1
            group["failed"] += row["status"] != "complete"
            group["slow"] += (metrics.get("total_seconds") or 0) > 20
            if row["axes_json"]:
                group["reviewed"] += 1
                for axis, rating in json.loads(row["axes_json"]).items():
                    if axis in AXES and rating in ("problem", "partial", "appropriate"):
                        group["axes"][axis]["rated"] += 1
                        group["axes"][axis][rating] += 1
    return [
        {"day": key[0], "model": key[1], "prompt": key[2], **value}
        for key, value in sorted(groups.items(), reverse=True)
    ]


def create_admin_app(database, *, port=8767, bootstrap_token=None, signing_secret=None):
    if not 1024 <= port <= 65535:
        raise ValueError("Review port must be 1024–65535")
    db = database if isinstance(database, ChatDB) else ChatDB(database)
    owner = OwnerSession(
        signing_secret or owner_secret(db.path.parent / "admin-signing.key"),
        bootstrap_token=bootstrap_token,
    )
    origin = f"http://127.0.0.1:{port}"
    assets = Path(__file__).resolve().parent.parent / "admin"

    async def index(_request):
        return FileResponse(assets / "index.html", media_type="text/html")

    async def asset(request):
        name = request.path_params["name"]
        media = {"review.js": "text/javascript", "review.css": "text/css"}
        if name not in media:
            return failure(404, "not_found", "파일이 없습니다.")
        return FileResponse(assets / name, media_type=media[name])

    async def login(request):
        data = await read_body(request)
        if set(data) != {"token"}:
            raise AdminFailure(400, "invalid_session", "일회용 링크를 확인해 주세요.")
        cookie = owner.issue(data["token"])
        response = JSONResponse({"connected": True})
        response.set_cookie(
            COOKIE,
            cookie,
            max_age=SESSION_SECONDS,
            httponly=True,
            samesite="strict",
            path="/",
        )
        return response

    async def session(request):
        _, csrf = owner.authenticate(request)
        return JSONResponse(
            {
                "owner": True,
                "csrf": csrf,
                "axes": list(AXES),
                "ratings": list(RATINGS),
                "causes": list(CAUSES),
                "tags": list(TAGS),
            }
        )

    async def logout(request):
        claims, _ = owner.authenticate(request, mutate=True)
        owner.revoked.add(claims["id"])
        response = JSONResponse({"connected": False})
        response.delete_cookie(COOKIE, path="/", httponly=True, samesite="strict")
        return response

    async def queue(request):
        owner.authenticate(request)
        options = filters(request)
        rows = db.review_queue(**options)
        return JSONResponse(
            redact(
                {
                    "cases": rows,
                    "offset": options["offset"],
                    "limit": options["limit"],
                    "next_offset": options["offset"] + len(rows)
                    if len(rows) == options["limit"]
                    and not options.get("random_sample")
                    else None,
                }
            )
        )

    async def detail(request):
        owner.authenticate(request)
        try:
            identifier = str(UUID(request.path_params["job_id"]))
        except ValueError as error:
            raise AdminFailure(
                400, "invalid_job", "요청 ID를 확인해 주세요."
            ) from error
        case = db.request_detail(identifier)
        if case is None:
            raise AdminFailure(404, "not_found", "해당 대화를 찾지 못했습니다.")
        return JSONResponse(redact(case))

    async def review(request):
        owner.authenticate(request, mutate=True)
        data = await read_body(request)
        if set(data) - {"axes", "tags", "cause", "note", "improved_answer"}:
            raise AdminFailure(400, "invalid_review", "허용되지 않은 검토 필드입니다.")
        try:
            identifier = str(UUID(request.path_params["job_id"]))
            if db.get_request(identifier) is None:
                raise AdminFailure(404, "not_found", "해당 대화를 찾지 못했습니다.")
            if not isinstance(data.get("axes"), dict) or not isinstance(
                data.get("tags", []), list
            ):
                raise TypeError
            if any(tag not in TAGS for tag in data.get("tags", [])):
                raise ValueError
            if any(
                not isinstance(data.get(field, ""), str)
                or len(data.get(field, "")) > 10000
                for field in ("note", "improved_answer")
            ):
                raise ValueError
            review_id = db.save_review(identifier, reviewer="owner", **data)
        except (ValueError, TypeError, KeyError) as error:
            raise AdminFailure(
                400, "invalid_review", "여섯 평가 항목과 검토 내용을 확인해 주세요."
            ) from error
        return JSONResponse(
            {"review_id": review_id, "training_eligible": False}, status_code=201
        )

    async def summary(request):
        owner.authenticate(request)
        return JSONResponse(
            {
                "groups": stats(db, filters(request)),
                "denominator": "각 항목은 미평가를 제외한 최신 검토의 표본 수를 기준으로 합니다. 전체 대화 수와 검토한 대화 수를 함께 표시합니다.",
            }
        )

    async def export(request):
        owner.authenticate(request, mutate=True)
        data = await read_body(request)
        identifiers = data.get("job_ids")
        try:
            if (
                set(data) != {"job_ids"}
                or not isinstance(identifiers, list)
                or not 1 <= len(identifiers) <= 100
            ):
                raise ValueError
            identifiers = [str(UUID(value)) for value in identifiers]
        except (ValueError, TypeError, AttributeError) as error:
            raise AdminFailure(
                400, "invalid_export", "내보낼 대화를 1~100개 선택해 주세요."
            ) from error
        rows = redact(db.export_cases(identifiers))
        body = "".join(json_text(row) + "\n" for row in rows)
        return Response(
            body,
            media_type="application/x-ndjson",
            headers={
                "Content-Disposition": 'attachment; filename="kiryu-review.jsonl"'
            },
        )

    app = Starlette(
        routes=[
            Route("/", index),
            Route("/assets/{name}", asset),
            Route("/v1/admin/session", login, methods=["POST"]),
            Route("/v1/admin/session", session, methods=["GET"]),
            Route("/v1/admin/logout", logout, methods=["POST"]),
            Route("/v1/admin/queue", queue),
            Route("/v1/admin/cases/{job_id}", detail),
            Route("/v1/admin/cases/{job_id}/reviews", review, methods=["POST"]),
            Route("/v1/admin/stats", summary),
            Route("/v1/admin/export", export, methods=["POST"]),
        ]
    )
    app.add_middleware(LocalOnlyMiddleware, origin=origin)
    app.state.owner = owner
    app.state.db = db
    app.state.origin = origin
    return app


def main():
    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    app = create_admin_app(args.database, port=args.port)
    print("Mac 전용 대화 검토 · 일회용 링크 (공유하지 마세요):", flush=True)
    print(app.state.origin + "/#owner=" + app.state.owner.bootstrap_token, flush=True)
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        proxy_headers=False,
        access_log=False,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
