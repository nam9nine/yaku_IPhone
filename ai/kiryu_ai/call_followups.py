"""Bounded UI call outcomes, never synthetic user dialogue."""

import re

FOLLOWUP_TOKENS = 96


def validate_trigger(value):
    if not isinstance(value, dict) or set(value) != {"call_id", "reason", "direction"}:
        raise ValueError("Invalid call followup trigger")
    call_id, reason, direction = (value[k] for k in ("call_id", "reason", "direction"))
    if (
        not isinstance(call_id, str)
        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}", call_id) is None
        or reason not in ("missed", "declined", "idle")
        or direction not in ("incoming", "outgoing")
        or (reason in ("missed", "declined") and direction != "incoming")
    ):
        raise ValueError("Invalid call followup trigger")
    return {key: value[key] for key in ("call_id", "reason", "direction")}


def describe_trigger(value):
    trigger = validate_trigger(value)
    observed = {
        "missed": "내가 걸었던 전화에 응답이 없어 연결되지 않았다. 통화는 성립하지 않았다.",
        "declined": "내가 걸었던 수신 전화가 거절되어 연결되지 않았다. 이유는 알 수 없다.",
        "idle": "통화가 실제 연결된 뒤 키류의 응답이 한동안 없어 내가 통화를 종료했다. 전화를 받지 않은 부재중 상황이 아니다.",
    }[trigger["reason"]]
    return {"connected": trigger["reason"] == "idle", "observed": observed}
