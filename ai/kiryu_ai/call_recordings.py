"""Private raw microphone clips. Never indexed as messages or RAG input."""

import asyncio
import hashlib
import os
from uuid import UUID

from starlette.responses import JSONResponse

from .web_server import ApiFailure

MAX_BYTES = 2 * 1024 * 1024


async def save_recording(request, service):
    record = service.authenticate(request)
    character = request.path_params["character"]
    try:
        identifier = str(UUID(request.path_params["recording_id"]))
    except ValueError:
        raise ApiFailure(400, "invalid_recording", "음성 저장 실패") from None
    if character not in {"haruka", "majima"}:
        raise ApiFailure(400, "invalid_character", "음성 저장 실패")
    mime = request.headers.get("content-type", "").split(";")[0].strip()
    extension = {"audio/mp4": "m4a", "audio/webm": "webm"}.get(mime)
    if not extension:
        raise ApiFailure(415, "invalid_audio", "음성 형식 미지원")
    visitor = record["visitor_id"]
    if not service.limiter.allow("recording:" + visitor, 30, 3600):
        raise ApiFailure(429, "rate_limited", "음성 저장 한도 초과")
    data = bytearray()
    try:
        async with asyncio.timeout(30):
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_BYTES:
                    raise ApiFailure(413, "body_too_large", "음성 용량 초과")
                data.extend(chunk)
    except TimeoutError:
        raise ApiFailure(408, "request_timeout", "음성 전송 시간 초과") from None
    valid = (mime == "audio/webm" and data[:4] == b"\x1aE\xdf\xa3") or (
        mime == "audio/mp4" and data[4:8] == b"ftyp"
    )
    if not valid:
        raise ApiFailure(400, "invalid_audio", "음성 형식 오류")
    # Authenticated identity only; no user paths or filenames. Private local files,
    # no public download route, no raw session tokens in filenames or metadata.
    folder = (
        service.root
        / "recordings"
        / hashlib.sha256(visitor.encode()).hexdigest()
        / character
    )
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = folder / (identifier + "." + extension)
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if target.read_bytes() != data:
            raise ApiFailure(409, "recording_conflict", "음성 충돌") from None
    else:
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(data)
        except BaseException:
            target.unlink(missing_ok=True)
            raise
    return JSONResponse({"id": identifier}, status_code=201)
