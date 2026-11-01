"""Verify episode proposals and selectively reconsider unsupported decisions.

EpisodeEntailment only preserves or vetoes a proposal. EpisodeDeliberation may
reclassify once, then requires evidence verification before any new mutation.
These are correlated model calls, not independent truth judges.
"""

from __future__ import annotations

import copy
import json

from .chat_retrieval import stable_hash
from .episode_prompt import validate_transition
from .episode_reader import (
    EPISODE_OMISSION_RULES,
    LAYOUT_NOTE,
    RULES,
    consensus,
    validate_interpretation,
)
from .gemma_engine import GemmaFailure

VERIFIER_VERSION = "episode-entailment-v1"
SCHEMA_VERSION = "episode-entailment-verdict-v1"
CLAIM_MAPPING_VERSION = "agreed-raw-act-disjunction-v1"
INPUT_TOKENS = 3072
OUTPUT_TOKENS = 2048
REASONING_TOKENS = 1024
SEED = 42
CLAIM_HEADER = "\n검증할 주장(JSON, 인용 데이터):\n"

POLICY = "실제 대화 기록으로 claim_text 전체를 검증한다. episode_scope는 주장이 가리키는 사건과 실제 기록의 ID이며 새 사실이 아니다. 마지막 사용자 문자에 담긴 새 의사·질문·보고가 주장을 뒷받침하는지 판단하고, 과거 기록은 생략된 대상·약속·조건을 연결하는 데 사용한다. 활동명을 반복하지 않은 일반적인 지시·생략도 실제 문맥으로 해석할 수 있다.\nsupported는 claim_text 전체를 뒷받침할 충분한 실제 근거가 있음, contradicted는 기록이 주장과 양립하지 않는 뜻을 드러냄, insufficient는 어느 쪽도 충분히 확정할 수 없음이다. 이 검증은 주장의 지지 여부만 판단하며 상태 변경 허용은 외부 guard가 별도로 결정한다. 가장 그럴듯한 의도를 고르는 일이 아니며, 모순을 찾지 못했다는 것만으로 supported가 되지 않는다. 활동·행위자·의사를 같은 발화의 의미로 연결하고 서로 다른 절의 의사를 합치지 않는다. 다른 활동의 의사, 상대의 제안, 단순 인지, 원작·성향에 대한 추측으로 이 사건의 사용자 결정을 보충하지 않는다.\nevidence_quote에는 판정에 직접 관계된 마지막 사용자 원문의 연속 구절을 그대로 쓰거나 null을 쓴다. supported에는 비어 있지 않은 현재 원문 인용이 필수다. 인용은 부정·조건·정정을 훼손하지 않아야 하며 인용의 존재만으로 의미가 검증되는 것은 아니다. verdict와 evidence_quote만 지정 JSON으로 출력하고 설명·생각과정·대사는 쓰지 않는다."

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["supported", "contradicted", "insufficient"],
        },
        "evidence_quote": {
            "type": ["string", "null"],
            "minLength": 1,
            "maxLength": 500,
        },
    },
    "required": ["verdict", "evidence_quote"],
    "additionalProperties": False,
}

CLAIM_TEMPLATES = {
    "agreement": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 그 활동에 참여하기로 확정했다. 시간·장소가 확정되었다는 주장은 아니다.",
    "temporary_unavailability": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 지금 그 활동에 참여하기 어렵게 하는 일시적 사정을 전했다.",
    "decision_postponed": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 그 활동에 참여할지 여부의 결정을 뒤로 미루었다.",
    "rejection": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 그 활동 참여 제안을 거절했다.",
    "withdrawal": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 자신이 앞서 한 그 활동의 참여 약속 자체를 철회했다.",
    "discussion": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 그 활동의 제안이나 내용을 설명·논의하도록 요청하거나 허용했다. 참여를 확정했다는 주장은 아니다.",
    "terms_change": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 그 활동의 참여 약속을 유지하면서 기존 조건을 바꾸자고 요청했다.",
    "progress": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 그 활동을 위한 이동·준비·도착 또는 활동의 시작·진행을 보고했다. 활동 자체의 완료를 보고했다는 주장은 아니다.",
    "completion": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 그 활동 자체의 완료나 최종 결과를 보고했다.",
    "topic_change": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 새 참여 결정·요청·진행 보고 없이 별개의 질문이나 요청으로 대화 주제를 옮겼다.",
    "none": "현재 사용자는 실제 대화 기록이 가리키는 사건 ‘{episode_title}’에 관하여, 단순 수신 확인·인지에 그쳤거나, 그 활동에 관하여 확정할 수 있는 새 의사·질문·보고를 전하지 않았다.",
}

CLAIM_DECISIONS = {
    "agreement": "accept",
    "temporary_unavailability": "defer",
    "decision_postponed": "defer",
    "rejection": "decline",
    "withdrawal": "cancel",
    "discussion": "no_change",
    "terms_change": "accept",
    "progress": "no_change",
    "completion": "report_outcome",
    "topic_change": "change_topic",
    "none": "no_change",
}

OR_PREFIX = "다음 주장 중 적어도 하나가 실제 대화 기록으로 뒷받침된다. 논리적 OR이며 둘 모두의 성립을 요구하지 않는다:\n"


def _require(value, reason):
    if not value:
        raise ValueError(reason)


def verification_input(audit, proposed, episode, current_id, question):
    """Revalidate raw arms and preserve the classifier's retained source exactly."""
    _require(set(audit["arms"]) == {"primary", "secondary"}, "arm_set_changed")
    for arm in audit["arms"].values():
        canonical, meaning = validate_interpretation(
            arm["output_json"], episode, current_id
        )
        _require(
            arm["stage"] == "complete"
            and canonical == arm["canonical_transition"]
            and meaning == arm["interpretation"],
            "arm_validation_mismatch",
        )
        _require(
            arm["input_sha256"] == stable_hash(arm["input_messages"]),
            "arm_input_changed",
        )
    canonical, interpretation = consensus(
        audit["arms"]["primary"], audit["arms"]["secondary"], episode, current_id
    )
    _require(
        canonical == proposed and interpretation == audit["interpretation"],
        "consensus_changed",
    )
    if interpretation["status"] != "agreed" or proposed["decision"] == "no_change":
        return None
    _require(interpretation["mutation_eligible"], "ineligible_mutation")
    clauses = []
    for name in ("primary", "secondary"):
        arm = audit["arms"][name]
        effect = arm["canonical_transition"]["decision"]
        _require(
            effect == proposed["decision"]
            or (
                proposed["decision"] == "defer" and effect in {"defer", "change_topic"}
            ),
            "different_state_effect",
        )
        response = arm["output_json"]["response"]
        _require(CLAIM_DECISIONS[response] == effect, "raw_claim_effect_mismatch")
        existing = next((row for row in clauses if row["response"] == response), None)
        if existing:
            existing["contributing_arms"].append(name)
        else:
            clauses.append({"response": response, "contributing_arms": [name]})
    original = copy.deepcopy(audit["arms"]["primary"]["input_messages"])
    _require(original[0]["content"].startswith(RULES), "classifier_policy_mismatch")
    suffix = original[0]["content"][len(RULES) :]
    prefix = (
        "\n" + EPISODE_OMISSION_RULES if audit.get("past_context_omission") else ""
    ) + LAYOUT_NOTE
    _require(suffix.startswith(prefix), "omission_instruction_changed")
    quoted = json.loads(suffix[len(prefix) :])
    _require(
        original[-1] == {"role": "user", "content": question}, "last_raw_sms_changed"
    )
    state = quoted["episode_before_current_message"]
    _require(
        state["episode_id"] == episode["episode_id"]
        and state["version"] == episode["version"],
        "episode_scope_changed",
    )
    current = quoted["current_user_message"]
    _require(
        current["id"] == current_id
        and current["native_message_index"] == len(original) - 1,
        "current_id_changed",
    )
    ids = list(
        dict.fromkeys(
            row["id"]
            for row in quoted["prior_notices"]
            + quoted["episode_evidence"]
            + quoted["native_turn_message_id_map"]
        )
    )
    _require(current_id in ids, "current_id_not_in_scope")
    title = quoted["activity"]["title"]
    for row in clauses:
        row["claim"] = CLAIM_TEMPLATES[row["response"]].format(episode_title=title)
    text = (
        clauses[0]["claim"]
        if len(clauses) == 1
        else OR_PREFIX
        + "\n".join(
            f"({index}) " + row["claim"] for index, row in enumerate(clauses, 1)
        )
    )
    scope = {
        "episode_id": episode["episode_id"],
        "title": title,
        "source_message_ids": ids,
    }
    messages = copy.deepcopy(original)
    messages[0]["content"] = (
        POLICY
        + suffix
        + CLAIM_HEADER
        + json.dumps(
            {"claim_text": text, "episode_scope": scope},
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    _require(messages[1:] == original[1:], "retained_native_turns_changed")
    return {
        "messages": messages,
        "schema": copy.deepcopy(RESPONSE_SCHEMA),
        "claim_text": text,
        "claim_operator": "single" if len(clauses) == 1 else "inclusive_or",
        "clauses": clauses,
        "scope": scope,
        "current_sms": question,
        "quote_max_chars": min(500, len(question)),
        "current_message_id": current_id,
        "candidate_transition": proposed,
        "candidate_interpretation": interpretation,
        "classifier_dropped_ids": audit["dropped_ids"],
        "classifier_context_omission": audit.get("past_context_omission"),
        "additional_omissions": [],
        "both_clauses_verified": False,
    }


def validate_verdict(value, question):
    _require(
        isinstance(value, dict) and set(value) == {"verdict", "evidence_quote"},
        "verifier_shape_invalid",
    )
    verdict, quote = value["verdict"], value["evidence_quote"]
    _require(
        isinstance(verdict, str)
        and verdict in {"supported", "contradicted", "insufficient"},
        "verdict_invalid",
    )
    _require(
        quote is None
        or (
            isinstance(quote, str)
            and bool(quote.strip())
            and 1 <= len(quote) <= min(500, len(question))
            and quote in question
        ),
        "quote_not_exact_current_sms_substring",
    )
    _require(
        verdict != "supported" or quote is not None, "supported_requires_current_quote"
    )
    return value


def compose(proposed, interpretation, verdict, episode, current_id):
    """Only an agreed mutation can survive; valid non-support means abstention."""
    if interpretation["status"] != "agreed" or proposed["decision"] == "no_change":
        _require(verdict is None, "verifier_must_not_promote_skipped_case")
        return proposed, interpretation
    _require(verdict is not None, "verifier_result_missing")
    if verdict["verdict"] == "supported":
        return proposed, interpretation
    unchanged = validate_transition(
        {**proposed, "decision": "no_change", "evidence_message_id": None},
        episode,
        current_id,
    )
    return unchanged, {
        "status": "abstained",
        "reason": "verifier_non_support",
        "reader_act": None,
        "reader_act_agreement": False,
        "validated_transition": unchanged,
        "mutation_eligible": False,
        "meaning_correctness_established": False,
    }


class EpisodeEntailment:
    def __init__(self, engine, *, seed=SEED):
        self.engine = engine
        self.seed = seed

    def verify(
        self,
        *,
        classifier_audit,
        proposed,
        episode,
        current_id,
        question,
        on_stage=None,
    ):
        audit = {
            "version": VERIFIER_VERSION,
            "claim_mapping_version": CLAIM_MAPPING_VERSION,
            "policy_sha256": stable_hash(POLICY),
            "schema_version": SCHEMA_VERSION,
            "response_schema": copy.deepcopy(RESPONSE_SCHEMA),
            "response_schema_sha256": stable_hash(RESPONSE_SCHEMA),
            "input_messages": [],
            "input_sha256": stable_hash([]),
            "input_tokens": None,
            "input_budget": INPUT_TOKENS,
            "output_budget": OUTPUT_TOKENS,
            "generation": {
                "seed": self.seed,
                "max_tokens": OUTPUT_TOKENS,
                "temperature": 0,
            },
            "model_manifest": copy.deepcopy(getattr(self.engine, "manifest", {})),
            "engine_settings": {
                name: getattr(self.engine, name, None)
                for name in (
                    "thinking",
                    "reasoning_tokens",
                    "context_tokens",
                    "timeout",
                )
            },
            "classifier_version": classifier_audit["version"],
            "classifier_input_sha256": classifier_audit["input_sha256"],
            "proposal": copy.deepcopy(proposed),
            "pre_veto_interpretation": copy.deepcopy(
                classifier_audit["interpretation"]
            ),
            "meaning_correctness_established": False,
        }
        result = None

        def notify(stage):
            audit["stage"] = stage
            if on_stage:
                on_stage(copy.deepcopy(audit))

        try:
            try:
                request = verification_input(
                    classifier_audit, proposed, episode, current_id, question
                )
            except (ValueError, TypeError, KeyError) as error:
                raise GemmaFailure("grounding_invalid") from error
            if request is None:
                audit.update(
                    status="skipped",
                    reason="classifier_abstained_or_nonmutation",
                    final_transition=proposed,
                    final_interpretation=classifier_audit["interpretation"],
                )
                notify("episode_verifier_skipped")
                return proposed, classifier_audit["interpretation"], audit
            audit.update(
                request=request,
                input_messages=request["messages"],
                input_sha256=stable_hash(request["messages"]),
            )
            if audit["engine_settings"] != {
                "thinking": True,
                "reasoning_tokens": REASONING_TOKENS,
                "context_tokens": 6144,
                "timeout": 120,
            }:
                raise GemmaFailure("grounding_invalid")
            notify("episode_verifier_preparing")
            count = self.engine.count_tokens(request["messages"])
            audit["input_tokens"] = count
            if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                raise GemmaFailure("generation_failed")
            if count > INPUT_TOKENS:
                raise GemmaFailure("context_limit")
            notify("episode_verifier_generating")
            result = self.engine.reply(
                request["messages"],
                **audit["generation"],
                response_schema=RESPONSE_SCHEMA,
            )
            # GemmaEngine discards the reasoning channel; this is only its final
            # verdict JSON, retained privately for audit (never character memory).
            audit["model_result"] = copy.deepcopy(result)
            # Check cancellation/staleness before accepting any returned verdict.
            notify("episode_verifier_returned")
            if result.get("finish_reason") == "length":
                raise GemmaFailure("response_truncated", result)
            if result.get("finish_reason") != "stop":
                raise GemmaFailure("model_protocol", result)
            try:
                verdict = validate_verdict(json.loads(result["reply"]), question)
                transition, interpretation = compose(
                    proposed,
                    classifier_audit["interpretation"],
                    verdict,
                    episode,
                    current_id,
                )
            except (ValueError, TypeError, KeyError) as error:
                raise GemmaFailure("grounding_invalid", result) from error
            audit.update(
                status="supported"
                if verdict["verdict"] == "supported"
                else "abstained",
                verdict=verdict,
                final_transition=transition,
                final_interpretation=interpretation,
            )
            notify("episode_verifier_complete")
            return transition, interpretation, audit
        except GemmaFailure as failure:
            partial = failure.result or result or {}
            audit.update(
                status="failed",
                error_code=failure.code,
                model_result=copy.deepcopy(partial),
                final_transition=None,
                final_interpretation={
                    "status": "failed",
                    "reader_act": None,
                    "mutation_eligible": False,
                },
            )
            notify("episode_verifier_failed")
            raise GemmaFailure(
                failure.code, {**partial, "episode_entailment": audit}
            ) from failure


DELIBERATION_VERSION = "episode-selective-deliberation-v1"
DELIBERATION_POLICY = {
    "trigger": "base_agreed_mutation_and_valid_first_verifier_non_support_only",
    "maximum_extra_classification_passes": 1,
    "same_retained_messages_schema_and_current_id": True,
    "verifier_feedback_in_classifier_input": False,
    "skip_baseline_abstained_no_change_or_supported": True,
    "execution_errors_are_not_retry_triggers": True,
    "same_verification_request_reuses_first_negative": True,
    "otherwise_abstain_and_keep_pending_hold": True,
}


def verification_identity(request, *, generation, engine_settings, model_manifest):
    """Compare the first execution snapshot with the planned next execution."""
    return stable_hash(
        {
            "messages": request["messages"],
            "schema": request["schema"],
            "generation": generation,
            "engine_settings": engine_settings,
            "model_manifest": model_manifest,
        }
    )


def abstained(proposed, episode, current_id, reason):
    unchanged = validate_transition(
        {**proposed, "decision": "no_change", "evidence_message_id": None},
        episode,
        current_id,
    )
    return unchanged, {
        "status": "abstained",
        "reason": reason,
        "reader_act": None,
        "reader_act_agreement": False,
        "validated_transition": unchanged,
        "mutation_eligible": False,
        "meaning_correctness_established": False,
    }


class EpisodeDeliberation:
    """One evidence-triggered reclassification; never a retry-until-supported loop."""

    def __init__(self, verifier):
        self.verifier = verifier

    def reclassify(self, baseline, episode, current_id, on_stage=None):
        engine = self.verifier.engine
        audit = {
            "version": "episode-interpreter-bounded-recheck-v1",
            "response_schema": copy.deepcopy(baseline["response_schema"]),
            "response_schema_sha256": baseline["response_schema_sha256"],
            "input_messages": copy.deepcopy(
                baseline["arms"]["primary"]["input_messages"]
            ),
            "input_sha256": baseline["arms"]["primary"]["input_sha256"],
            "generation": {"seed": SEED, "max_tokens": OUTPUT_TOKENS, "temperature": 0},
            "engine_settings": {
                name: getattr(engine, name, None)
                for name in (
                    "thinking",
                    "reasoning_tokens",
                    "context_tokens",
                    "timeout",
                )
            },
            "model_manifest": copy.deepcopy(getattr(engine, "manifest", {})),
            "input_budget": INPUT_TOKENS,
            "output_budget": OUTPUT_TOKENS,
            "dropped_ids": list(baseline["dropped_ids"]),
            "additional_omissions": [],
            "arms": {},
        }
        if baseline.get("past_context_omission"):
            audit["past_context_omission"] = copy.deepcopy(
                baseline["past_context_omission"]
            )

        def notify(stage):
            audit["stage"] = stage
            if on_stage:
                on_stage(copy.deepcopy(audit))

        result = None
        try:
            for name in ("primary", "secondary"):
                original = baseline["arms"][name]
                messages = copy.deepcopy(original["input_messages"])
                if stable_hash(messages) != original["input_sha256"]:
                    raise GemmaFailure("grounding_invalid")
                arm = {
                    "input_messages": messages,
                    "input_sha256": original["input_sha256"],
                    "stage": "preparing",
                }
                audit["arms"][name] = arm
                audit["active_arm"] = name
                notify("episode_reconsider_preparing")
                count = engine.count_tokens(messages)
                arm["input_tokens"] = count
                if type(count) is not int or count < 0:
                    raise GemmaFailure("generation_failed")
                if count > INPUT_TOKENS:
                    raise GemmaFailure("context_limit")
                arm["stage"] = "generating"
                notify("episode_reconsider_generating")
                result = engine.reply(
                    messages,
                    **audit["generation"],
                    response_schema=audit["response_schema"],
                )
                arm["model_result"] = copy.deepcopy(result)
                notify("episode_reconsider_returned")
                if result.get("finish_reason") == "length":
                    raise GemmaFailure("response_truncated", result)
                if result.get("finish_reason") != "stop":
                    raise GemmaFailure("model_protocol", result)
                try:
                    raw = json.loads(result["reply"])
                    canonical, meaning = validate_interpretation(
                        raw, episode, current_id
                    )
                except (ValueError, TypeError, KeyError) as error:
                    raise GemmaFailure("grounding_invalid", result) from error
                arm.update(
                    stage="complete",
                    output_json=raw,
                    canonical_transition=canonical,
                    interpretation=meaning,
                )
                notify("episode_reconsider_arm_complete")
                result = None
            audit.pop("active_arm", None)
            proposal, interpretation = consensus(
                audit["arms"]["primary"],
                audit["arms"]["secondary"],
                episode,
                current_id,
            )
            audit.update(
                stage="complete", interpretation=interpretation, proposal=proposal
            )
            notify("episode_reconsider_complete")
            return proposal, audit
        except GemmaFailure as failure:
            partial = failure.result or result or {}
            if "active_arm" in audit:
                audit["arms"][audit["active_arm"]].update(
                    stage="failed",
                    error_code=failure.code,
                    model_result=copy.deepcopy(partial),
                )
            audit.update(
                error_code=failure.code,
                interpretation={
                    "status": "failed",
                    "reader_act": None,
                    "mutation_eligible": False,
                },
            )
            notify("episode_reconsider_failed")
            raise GemmaFailure(
                failure.code, {**partial, "episode_reclassification": audit}
            ) from failure

    def decide(
        self,
        *,
        classifier_audit,
        proposed,
        episode,
        current_id,
        question,
        on_stage=None,
    ):
        baseline = copy.deepcopy(classifier_audit)
        audit = {
            "version": DELIBERATION_VERSION,
            "policy": dict(DELIBERATION_POLICY),
            "policy_sha256": stable_hash(DELIBERATION_POLICY),
            "base_classifier": baseline,
            "base_transition": copy.deepcopy(proposed),
            "extra_passes": 0,
            "input_messages": baseline["input_messages"],
            "input_sha256": baseline["input_sha256"],
        }

        def notify(stage):
            audit["stage"] = stage
            if on_stage:
                on_stage(copy.deepcopy(audit))

        def bridge(key):
            def stage(value):
                audit[key] = value
                audit["input_messages"] = value["input_messages"]
                audit["input_sha256"] = value["input_sha256"]
                notify(value["stage"])

            return stage

        def finish(transition, interpretation, path):
            audit.update(
                path=path,
                final_transition=transition,
                final_interpretation=interpretation,
            )
            notify("episode_deliberation_complete")
            return transition, interpretation, audit

        try:
            transition, interpretation, first = self.verifier.verify(
                classifier_audit=baseline,
                proposed=proposed,
                episode=episode,
                current_id=current_id,
                question=question,
                on_stage=bridge("first_verifier"),
            )
            audit["first_verifier"] = first
            if first["status"] == "skipped":
                return finish(transition, interpretation, "base_skipped")
            if first["status"] == "supported":
                return finish(transition, interpretation, "base_supported")
            if first["status"] != "abstained" or first["verdict"]["verdict"] not in {
                "contradicted",
                "insufficient",
            }:
                raise GemmaFailure("grounding_invalid")
            audit["extra_passes"] = 1
            notify("episode_reconsider_selected")
            proposal, reconsidered = self.reclassify(
                baseline, episode, current_id, on_stage=bridge("reclassification")
            )
            audit["reclassification"] = reconsidered
            if (
                reconsidered["interpretation"]["status"] != "agreed"
                or proposal["decision"] == "no_change"
            ):
                transition, interpretation = abstained(
                    proposal, episode, current_id, "reclassification_unresolved"
                )
                return finish(transition, interpretation, "reclassified_abstained")
            try:
                request = verification_input(
                    reconsidered, proposal, episode, current_id, question
                )
                first_identity = verification_identity(
                    first["request"],
                    generation=first["generation"],
                    engine_settings=first["engine_settings"],
                    model_manifest=first["model_manifest"],
                )
                second_identity = verification_identity(
                    request,
                    generation={
                        "seed": self.verifier.seed,
                        "temperature": 0,
                        "max_tokens": OUTPUT_TOKENS,
                    },
                    engine_settings={
                        name: getattr(self.verifier.engine, name, None)
                        for name in (
                            "thinking",
                            "reasoning_tokens",
                            "context_tokens",
                            "timeout",
                        )
                    },
                    model_manifest=copy.deepcopy(
                        getattr(self.verifier.engine, "manifest", {})
                    ),
                )
            except (ValueError, TypeError, KeyError) as error:
                raise GemmaFailure("grounding_invalid") from error
            audit["verification_request_identity"] = {
                "first": first_identity,
                "second": second_identity,
            }
            if first_identity == second_identity:
                audit["second_verifier"] = {
                    "status": "reused_non_support",
                    "source": "first_verifier",
                    "request": request,
                    "request_identity": second_identity,
                    "verdict": first["verdict"],
                    "model_calls": 0,
                }
                transition, interpretation = abstained(
                    proposal, episode, current_id, "identical_verification_non_support"
                )
                return finish(transition, interpretation, "reclassified_abstained")
            transition, interpretation, second = self.verifier.verify(
                classifier_audit=reconsidered,
                proposed=proposal,
                episode=episode,
                current_id=current_id,
                question=question,
                on_stage=bridge("second_verifier"),
            )
            audit["second_verifier"] = second
            return finish(
                transition,
                interpretation,
                "reclassified_supported"
                if second["status"] == "supported"
                else "reclassified_abstained",
            )
        except GemmaFailure as failure:
            audit.update(
                path="execution_failed",
                error_code=failure.code,
                final_transition=None,
                final_interpretation={
                    "status": "failed",
                    "reader_act": None,
                    "mutation_eligible": False,
                },
            )
            notify("episode_deliberation_failed")
            raise GemmaFailure(
                failure.code, {**failure.result, "episode_deliberation": audit}
            ) from failure
