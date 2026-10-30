"""Bounded episode input and evidence-linked interpretation contracts.

This module validates data shapes, not the truth of a model's interpretation.
Only the server may commit a transition after checking the stored message/version.
"""

from __future__ import annotations

import json
from pathlib import Path

EPISODE_ID = "majima-bowling-v1"
DECISIONS = (
    "no_change",
    "accept",
    "defer",
    "decline",
    "cancel",
    "report_outcome",
    "change_topic",
)
PHASES = ("not_started", "awaiting_reply", "accepted", "deferred", "closed")
CALL_OUTCOMES = ("missed", "declined", "idle", "ended")
CATALOG_PATH = Path(__file__).resolve().parents[1] / "chat/episodes.json"

EPISODE_OMISSION_RULES = "과거 대화 원문이 입력 예산 때문에 통째로 생략되었다. ID와 사건 단계는 유지하지만 세부 내용은 제공되지 않았다. 원문 일부나 요약이 아니다. 시간·조건·이유·약속 내용을 추정하거나 이전 약속을 되살리지 않는다. 현재 문자와 제공된 상태만으로 답하고, 필요한 세부는 짧게 확인한다."

EPISODE_RULES = """현재 사건은 방문자의 IF 진행이다. 취소·거절은 해당 약속을 끝낸다. 불만은 표현해도 재약속 요구나 준비했다는 새 사실로 취소를 뒤집지 않는다. 보류 중에는 사용자가 사건을 다시 꺼내기 전 제안·권유·재촉을 하지 말고 현재 화제에만 답한다. message_id는 실제 원문 참조, native_turn은 system 다음 실제 대화의 1부터 센 순서다. call_outcome은 서버가 확인한 결과(missed=미연결, declined=수신 거절, idle=연결 후 무응답 종료, ended=통화 종료)이며 의도나 약속 수락이 아니다. 데이터 용어는 문자에 쓰지 않는다."""

EPISODE_READER_RULES = """current_episode는 이번 방문자의 IF 진행이며 canon과 별개다. recent_timeline에는 실제 선제 발신도 있으므로 '그거'의 대상을 최근 문맥에서 확인한다. 상태의 message_id는 같은 ID의 원문 참조다(conversation:은 검색용 접두사). call_outcome/통화 결과는 관찰 사실이며 상대의 의도·동의가 아니다.
episode_transition으로 현재 사용자 원문 하나에 근거한 진행 제안을 반환한다. decision은 no_change, accept, defer, decline, cancel, report_outcome, change_topic 중 하나다.
accept는 미결 활동 제안에 대한 명확한 수락, defer는 연기·부상·급한 사정 등 당장 진행하기 어려움, decline는 제안 거절, cancel은 기존 약속 취소, report_outcome은 해당 활동의 명시적 완료·결과 보고, change_topic은 진행 요청 없이 다른 화제로 옮긴 경우다. 장소 도착만으로 활동 완료나 승패를 보고한 것으로 분류하지 않는다. 사용자의 새 과거 주장과 원작 퀴즈를 현재 사건 완료로 해석하지 않는다.
no_change는 뜻이나 대상이 불명확하거나 사건에 새 결정이 없는 경우다. '좋다' 같은 단어만으로 판정하지 말고 무엇에 대한 답인지 읽는다. 다른 사람의 약속이나 인용된 문장은 사용자의 결정이 아니다. 실제 사용자 원문에 없는 시간·이동·승패·동기를 보충하지 않는다.
episode_id와 version은 current_episode 값 그대로, evidence_message_id는 상태를 바꿀 때 current_message_id 그대로 사용한다. no_change일 때 evidence_message_id는 null이다. 이 JSON은 검토 가능한 짧은 결론이며 사고 과정이나 설명은 쓰지 않는다."""


def _text(value, *, nullable=False, limit=500):
    if nullable and value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError("Invalid episode text")
    return value


def validate_episode_context(value, character):
    if value is None:
        return None
    if (
        not isinstance(value, dict)
        or character != "majima"
        or value.get("episode_id") != EPISODE_ID
    ):
        raise ValueError("Unauthorized episode context")
    version = value.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ValueError("Invalid episode version")
    if value.get("phase") not in PHASES:
        raise ValueError("Invalid episode phase")
    identifiers = value.get("evidence_message_ids", [])
    if not isinstance(identifiers, list) or len(identifiers) > 20:
        raise ValueError("Invalid episode evidence list")
    identifiers = [_text(v, limit=160) for v in identifiers]
    reports = value.get("user_reports", [])
    if not isinstance(reports, list) or len(reports) > 8:
        raise ValueError("Invalid episode report list")
    safe_reports = []
    for report in reports:
        if not isinstance(report, dict) or set(report) != {"message_id", "text"}:
            raise ValueError("Invalid episode user report")
        safe_reports.append(
            {
                "message_id": _text(report["message_id"], limit=160),
                "text": _text(report["text"], limit=1000),
            }
        )
    result = {
        "episode_id": EPISODE_ID,
        "version": version,
        "phase": value["phase"],
        "pending_proposal": _text(
            value.get("pending_proposal"), nullable=True, limit=1000
        ),
        "close_reason": _text(value.get("close_reason"), nullable=True, limit=100),
        "evidence_message_ids": identifiers,
        "user_reports": safe_reports,
        "contact_stage": _text(value.get("contact_stage", "invitation"), limit=80),
    }
    if "instance_id" in value:
        result["instance_id"] = _text(value["instance_id"], limit=160)
    outcome = value.get("call_outcome")
    if outcome is not None and outcome not in CALL_OUTCOMES:
        raise ValueError("Invalid episode call outcome")
    result["call_outcome"] = outcome
    return result


def episode_evidence_ids(context, messages):
    """Select authoritative current state evidence, not every historical state.

    A pending proposal and its newest correction remain together. Earlier state
    versions stay in the audit/DB; they are not all mandatory model input.
    """
    if context is None:
        return set()
    # The newest utterance can be an anaphoric correction ("that still applies")
    # rather than a self-contained reason. Keep its immediately prior evidence.
    identifiers = set(context["evidence_message_ids"][-2:])
    proposal = context["pending_proposal"]
    matches = [m for m in messages if proposal and m["content"] == proposal]
    if matches:
        identifiers.add(matches[-1]["id"])
    if context["user_reports"]:
        identifiers.add(context["user_reports"][-1]["message_id"])
    return identifiers


def episode_state_view(
    context, messages, *, identity=False, transition=None, omit_details=False
):
    """Reference original messages once; never substring or summarize a promise."""
    if context is None:
        return None
    result = {
        key: context[key]
        for key in ("phase", "close_reason", "call_outcome")
        if context.get(key) is not None
    }
    if identity:
        result.update(episode_id=context["episode_id"], version=context["version"])
    evidence = context["evidence_message_ids"][-1:]
    if evidence:
        result["latest_evidence_message_id"] = evidence[0]
    proposal = context["pending_proposal"]
    if proposal:
        matches = [m for m in messages if m["content"] == proposal]
        result["pending_proposal"] = (
            {"message_id": matches[-1]["id"]} if matches else {"text": proposal}
        )
    if context["user_reports"]:
        report = context["user_reports"][-1]
        result["user_report"] = (
            {"message_id": report["message_id"]}
            if any(
                m["id"] == report["message_id"] and m["content"] == report["text"]
                for m in messages
            )
            else report
        )
    if omit_details:
        for key in ("pending_proposal", "user_report"):
            if key in result:
                result[key] = {
                    **{k: v for k, v in result[key].items() if k == "message_id"},
                    "content_omitted": True,
                }
        result["past_details_omitted"] = True
    if transition is not None:
        decision = transition["decision"]
        if decision != "no_change":
            result["latest_evidence_message_id"] = transition["evidence_message_id"]
        if decision == "accept":
            result.update(
                phase="accepted",
                pending_proposal={"message_id": transition["evidence_message_id"]},
            )
            result.pop("close_reason", None)
        elif decision in {"defer", "change_topic"}:
            result["phase"] = "deferred"
        elif decision in {"decline", "cancel", "report_outcome"}:
            result.update(phase="closed", close_reason=decision)
            result.pop("pending_proposal", None)
            if decision == "report_outcome":
                result["user_report"] = {
                    "message_id": transition["evidence_message_id"]
                }
    return result


def protected_notices(context, notices):
    """Keep the original invitation and latest referent/outcome, not all notices."""
    if context is None or not notices:
        return set()
    protected = {notices[-1]["id"]}
    invitations = [m for m in notices if m.get("request_kind") == "proactive_episode"]
    if invitations:
        protected.add(invitations[0]["id"])
    outcomes = [m for m in notices if "call_trigger" in m]
    if outcomes:
        protected.add(outcomes[-1]["id"])
    protected.update(episode_evidence_ids(context, notices))
    return protected


def episode_definition(context):
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if catalog.get("version") != "phone-episodes-v1":
        raise ValueError("Unsupported episode catalog")
    definition = catalog["episodes"].get(context["episode_id"])
    if not definition or definition.get("character") != "majima":
        raise ValueError("Unsupported episode definition")
    return definition


def transition_schema(context, message_id):
    _text(message_id, limit=160)
    return {
        "type": "object",
        "properties": {
            "episode_id": {"type": "string", "enum": [context["episode_id"]]},
            "version": {"type": "integer", "enum": [context["version"]]},
            "decision": {"type": "string", "enum": list(DECISIONS)},
            "evidence_message_id": {
                "type": ["string", "null"],
                "enum": [message_id, None],
            },
        },
        "required": ["episode_id", "version", "decision", "evidence_message_id"],
        "additionalProperties": False,
    }


def validate_transition(value, context, message_id):
    if not isinstance(value, dict) or set(value) != {
        "episode_id",
        "version",
        "decision",
        "evidence_message_id",
    }:
        raise ValueError("Invalid episode interpretation")
    if (
        value["episode_id"] != context["episode_id"]
        or isinstance(value["version"], bool)
        or value["version"] != context["version"]
        or value["decision"] not in DECISIONS
    ):
        raise ValueError("Episode interpretation scope mismatch")
    expected = (
        None if value["decision"] == "no_change" else _text(message_id, limit=160)
    )
    if value["evidence_message_id"] != expected:
        raise ValueError("Episode interpretation requires the current user evidence")
    return dict(value)


def timeline(recent, notices):
    """A reference timeline, never synthetic alternating native chat turns."""
    rows = {}
    for message in (*recent, *notices):
        if message["id"] in rows:
            continue
        rows[message["id"]] = {
            key: message[key]
            for key in ("id", "role", "content", "time", "sequence", "request_kind")
            if key in message
        }
        if "call_trigger" in message:
            from .call_followups import describe_trigger, validate_trigger

            trigger = validate_trigger(message["call_trigger"])
            rows[message["id"]].update(
                call_trigger=trigger, call_result=describe_trigger(trigger)
            )

    def order(message):
        sequence = message.get("sequence")
        if isinstance(sequence, int) and not isinstance(sequence, bool):
            return (0, sequence, "")
        return (1, 0, message.get("time") or "")

    return sorted(rows.values(), key=order)
