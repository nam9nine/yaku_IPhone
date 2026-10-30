"""Retired microphone upload endpoint; existing private clips remain untouched."""

from .web_server import ApiFailure


async def save_recording(request, service):
    # Older browser builds may still attempt uploads. Authenticate before returning
    # a terminal response, without consuming audio or touching existing files.
    service.authenticate(request)
    raise ApiFailure(410, "recording_disabled", "음성 파일 저장이 중단되었습니다.")
