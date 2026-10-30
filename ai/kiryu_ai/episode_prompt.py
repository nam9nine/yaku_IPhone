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
READER_ACTS = {
    "no_change": "no_change",
    "discuss_proposal": "no_change",
    "accept_participation": "accept",
    "amend_participation": "accept",
    "defer": "defer",
    "decline": "decline",
    "cancel": "cancel",
    "report_progress": "no_change",
    "report_activity_completion": "report_outcome",
    "change_topic": "change_topic",
}
PHASES = ("not_started", "awaiting_reply", "accepted", "deferred", "closed")
CALL_OUTCOMES = ("missed", "declined", "idle", "ended")
CATALOG_PATH = Path(__file__).resolve().parents[1] / "chat/episodes.json"
OUTBOUND_FACTS_VERSION = "episode-outbound-facts-v1"

# Shared by first invitations and call followups, not only the catalog's
# invitation instruction. This is an evidence contract, not a date extractor.
OUTBOUND_FACTS_RULES = "확인된 현재 사실, 내가 한 미결 제안, 키류가 실제 동의한 내용을 구분해 발신한다. 내 발신의 희망·제안과 부재중은 키류의 동의가 아니다. pending_proposal이나 accepted 단계만으로 날짜·시간까지 확정됐다고 보지 않는다. 날짜·시간은 제공된 실제 원문에 있는 제안 또는 최신 사용자 확인 범위에서만 언급하며, 제안은 제안으로 표현한다. 미정이거나 원문이 생략됐으면 새 날짜·기한을 만들지 않는다. 최신 취소·정정은 옛 약속보다 우선한다. 출처 없는 예약·이동·경기·승패를 완료된 일로 말하지 않는다. 원작 사건·성격·승부욕은 이번 사실을 보충할 근거가 아니다."

EPISODE_OMISSION_RULES = "과거 대화 원문이 입력 예산 때문에 통째로 생략되었다. ID와 사건 단계는 유지하지만 세부 내용은 제공되지 않았다. 원문 일부나 요약이 아니다. 시간·조건·이유·약속 내용을 추정하거나 이전 약속을 되살리지 않는다. 현재 문자와 제공된 상태만으로 답하고, 필요한 세부는 짧게 확인한다."

EPISODE_RULES = """현재 사건은 방문자의 IF 진행이다. 취소·거절은 해당 약속을 끝낸다. 불만은 표현해도 재약속 요구나 준비했다는 새 사실로 취소를 뒤집지 않는다. 보류 중에는 사용자가 사건을 다시 꺼내기 전 제안·권유·재촉을 하지 말고 현재 화제에만 답한다. message_id는 실제 원문 참조, native_turn은 system 다음 실제 대화의 1부터 센 순서다. call_outcome은 서버가 확인한 결과(missed=미연결, declined=수신 거절, idle=연결 후 무응답 종료, ended=통화 종료)이며 의도나 약속 수락이 아니다. 데이터 용어는 문자에 쓰지 않는다."""

EPISODE_READER_RULES = """current_episode는 이번 방문자의 IF 진행이며 canon과 별개다. recent_timeline에는 실제 선제 발신도 있으므로 '그거'의 대상을 최근 문맥에서 확인한다. 상태의 message_id는 같은 ID의 원문 참조다(conversation:은 검색용 접두사). call_outcome/통화 결과는 관찰 사실이며 상대의 의도·동의가 아니다.
episode_transition.decision에는 현재 사용자 발화의 행위를 분류한다. discuss_proposal은 제안의 설명·논의 허용이나 재개이며 활동 참여 약속이 아니다. accept_participation은 미결 활동에 직접 참여하겠다는 확정이다. 참여는 확정했지만 날짜·시간만 미정이면 accept_participation이다.
amend_participation은 같은 활동의 참여를 유지하면서 기존 일정·장소·조건을 철회하고 대체 조건으로 변경을 요청하거나 정하는 행위다. 문장 전체에서 무엇을 철회하고 무엇을 유지하는지 읽는다. 조건 교체는 활동 자체의 취소가 아니다. 변경 가능성만 묻거나 조건을 탐색하면 discuss_proposal, 참여를 미루고 대체 조건도 정하지 않으면 defer다. 참여 유지 상태는 조건에 대한 상대의 동의나 실행 완료를 뜻하지 않는다.
report_progress는 이동·도착·준비·시작 전·진행 중 등 아직 끝나지 않은 활동에 대한 사용자 보고다. report_activity_completion은 해당 활동 자체를 끝냈다는 명시적 완료나 최종 결과 보고다. 이동의 완료는 활동의 완료가 아니다. 사용자의 새 과거 주장과 원작 퀴즈를 이번 활동 완료로 해석하지 않는다.
defer는 활동 자체의 연기·부상·급한 사정에 따른 보류, decline는 제안 거절, cancel은 해당 활동 참여 자체를 끝내는 철회, change_topic은 진행 요청 없이 다른 화제로 옮긴 경우다. 먼저 결정의 대상이 현재 제안과 같은 활동인지 확인한다. 다른 활동의 거절·취소를 현재 사건에 옮기지 않는다. 비유나 '승부' 같은 넓은 말만으로 같은 활동이라고 확정하지 말고, 대상이 불명확하면 no_change로 둔다. 논의·참여·일정 확정·진행·완료를 서로 대신하지 않는다.
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


def outbound_fact_sources(context, messages, *, omitted=False):
    """Expose provenance only; no semantic extraction of dates or agreements.

    An assistant proposal is not a user confirmation. Likewise, a state evidence
    ID identifies a source, not every detail the user supposedly agreed to.
    Only bodies actually available in this input can support a source reference.
    """
    if context is None:
        return None
    proposal = context["pending_proposal"]
    matches = [m for m in messages if proposal and m["content"] == proposal]
    # Repeated identical words from different turns are not enough to choose a
    # speaker. Missing/ambiguous provenance stays unknown rather than guessed.
    source = matches[0] if len(matches) == 1 and not omitted else None
    return {
        "version": OUTBOUND_FACTS_VERSION,
        "pending_proposal_source": (
            {"message_id": source["id"], "role": source["role"]} if source else None
        ),
        "state_evidence_sources": [
            {"message_id": m["id"], "role": m["role"]}
            for m in messages
            if not omitted and m["id"] in context["evidence_message_ids"][-2:]
        ],
        "details_omitted": omitted,
    }


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


def reader_transition_schema(context, message_id):
    schema = transition_schema(context, message_id)
    schema["properties"]["decision"]["enum"] = list(READER_ACTS)
    return schema


def episode_reply_task(state, speech_act):
    """Current response task, separate from the episode's invitation objective.

    Uses validated state/act only, never a keyword check on the user's text.
    These are response constraints, not suggested character dialogue.
    """
    tasks = {
        "discuss_proposal": (
            "discuss",
            "사용자가 다시 꺼낸 제안의 내용과 질문만 설명한다. 논의 허용을 참여 수락이나 일정 확정으로 바꾸지 않는다.",
        ),
        "accept_participation": (
            "acknowledge_acceptance",
            "사용자가 수락한 활동만 반영한다. 아직 정하지 않은 시간·장소는 미정으로 두고 필요한 것만 짧게 확인한다.",
        ),
        "amend_participation": (
            "acknowledge_amendment",
            "같은 활동 참여는 유지하고 사용자가 철회한 이전 조건을 되살리지 않는다. 대체 조건은 최신 변경 요청 범위로 반영하고 내 수락 여부를 답한다. 변경 요청만으로 양측 합의나 실행이 이미 끝났다고 하지 않는다. 새 조건이 불명확하면 필요한 것만 확인한다.",
        ),
        "report_progress": (
            "acknowledge_progress",
            "사용자가 보고한 진행만 반영한다. 활동 완료·승패나 나의 이동·준비를 덧붙이지 않는다.",
        ),
        "report_activity_completion": (
            "acknowledge_result",
            "사용자가 알린 최종 결과를 그 사람의 보고로 받아들여 현재 질문에 직접 답한다. 새 점수·경기 장면·재경기 약속을 만들지 않는다.",
        ),
    }
    if speech_act in tasks:
        policy_id, task = tasks[speech_act]
    elif state["phase"] in {"deferred", "closed"}:
        policy_id, task = (
            "respect_pause_or_end",
            "현재 질문이나 사정에만 답한다. 보류·종료된 활동을 다시 권유하거나 기한·일정·참가를 재촉하지 않는다. 불만은 표현해도 새 약속을 요구하지 않는다.",
        )
    else:
        policy_id, task = (
            "answer_current_message",
            "현재 질문과 용건에 먼저 답한다. 결정되지 않은 것은 그대로 두며, 답장마다 초대를 반복하지 않는다. 대상이 불명확하면 필요한 것만 확인한다.",
        )
    return {
        "policy_id": policy_id,
        "instruction": task
        + " 원작 장면과 집착은 말투 참고이며 이번 행동 지시가 아니다. 제공되지 않은 준비·이동·행동 완료를 만들지 않는다.",
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
