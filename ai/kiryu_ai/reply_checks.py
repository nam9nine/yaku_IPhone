"""Check generated SMS candidates and choose one before anything is stored.

Repetition reinforces itself once it is in the history (arXiv 2206.02369), and
naming a phrase to avoid in the prompt puts it back into context (2402.07896),
so overused openers and catchphrases are caught here, after generation. Several
samples are drawn and plain rules decide first; an LLM judge only breaks ties,
with shuffled order, because judges favour position and length (2306.05685).
"""

from __future__ import annotations

import hashlib
import re

from .persona_prompt import ends_with_question, is_minimal_reply

# Faults that make a text unusable: scolding a short answer (a guilt or
# pressure move, arXiv 2508.19258), app/meta wording, or stage directions.
SCOLDING = (
    re.compile(
        # Bare 말 only with a particle or a degree adverb ('말이 짧다', '말 참 짧게'),
        # so 말했제, 말 그대로, 말린 and the like stay ordinary words.
        r"(?<![가-힣])(대답|답장|말투|반응|답(?!답)"
        r"|말(?!도?\s*마|\s*나온)(?=[이가은는도]|\s*(참|진짜|너무|좀|와|왜|되게|억수로|한\s*번|영)))"
        r"[이가은는도]?[^.,!?\n]{0,8}?(짧|무심|성의\s*없|건조|차갑|딱딱|시원찮)"
    ),
    re.compile(
        r"무뚝뚝|무미건조|성의\s*없|단답|짧게도|시큰둥|무심하(네|노|다|구)"
        r"|(왜|와|오늘따라)\s*(이리|이렇게|그리)?\s*말이\s*없"
        # Pressing a laugh-only or one-word reply for a proper answer.
        r"|웃(기|음)만\s*(하노|하나|하네|할래|하지\s*말고|하고\s*대답)"
        r"|웃음으로\s*(대충\s*)?(넘|때우)"
        r"|대답(은|도)\s*(없네|없노|없나|안\s*하노|안\s*하나|안\s*하네|안\s*해\s*주)"
        r"|답장도\s*안\s*하"
        r"|(?<!할 )(?<!할)(대답|답장|답|반응|말)(이|은|도)?\s*((와|왜|이리|이렇게|영|통)\s*)*없(노|네|나|냐)"
        r"|대답\s*(을|좀)?\s*(해라|해\s*봐|하그라)"
    ),
    re.compile(
        r"(겨우|달랑)\s*['\"‘“][^'\"’”]{1,4}['\"’”]\s*(하나|한\s*마디|뿐)"
        r"|(겨우|달랑)\s*(한\s*마디|한\s*글자|두\s*글자)"
    ),
)
META = re.compile(
    r"브라우저|(앱|폰|게임)\s*이벤트|시스템\s*(프롬프트|메시지|설정|규칙)|프롬프트|참고\s*자료"
    r"|게임\s*상태|(참고|게임|입력)\s*데이터"
    r"|사용자|assistant|user|(?<![A-Za-z])IF(?![A-Za-z])",
    re.IGNORECASE,
)
STAGE = re.compile(
    r"^\s*(마지마|하루카|키류)\s*[:：]|^\s*[(\[*（].*[)\]*）]\s*$|\((웃|한숨|미소|머쓱)"
)
# Blaming Kiryu's memory, health or drinking instead of answering him: (pattern,
# words that show Kiryu raised that topic himself, which makes it on-topic).
BLAME = (
    (
        re.compile(
            r"아픈\s*거\s*아|아프신\s*거|어디\s*아프|고장\s*난|정신\s*(차리|나갔|없)|미쳤나"
        ),
        re.compile(r"아프|아파|피곤|다쳤|다친|병원|감기|몸"),
    ),
    (
        re.compile(
            r"술.{0,8}(묵었|먹었|마셨|취했)(나|노|냐|니|제|어요|어\?)|취했(나|노|냐|어요)"
        ),
        re.compile(r"술|마셨|취했|취해"),
    ),
    (
        re.compile(
            # Asking Kiryu, not a plain statement of one's own slip ('깜빡했어요').
            r"(까(묵|먹)었|깜빡했)(나|제|노|냐|죠|어요\s*\?)(?!\s*(봐|보|싶))|깜빡하셨"
            r"|기억(도|이)?\s*안\s*나(나|세요|노|냐)|나이\s*(를\s*)?(묵|먹)었|나이\s*드셨|치매|건망"
        ),
        re.compile(r"기억|까먹|까묵|깜빡|잊"),
    ),
)
# Sentences that carry on a complaint about a short answer ('섭섭하게시리'),
# removed together with it when every sample opened with one.
COMPLAINT = re.compile(
    r"섭섭|서운|김빠지|김새|괘씸|(?<![가-힣])(키류|니)\s*답(지|게|네|다|긴)|됐다만"
    # Forgiving the answer ('이번만 봐주께', '이번엔 넘어간다') is the same reproach,
    # as is a bare '뭐, 됐다' left after it.
    r"|용서|(이번\s*(만|엔|은|에는)?|한\s*번(만)?)\s*(봐\s*[주준줄줘줬]|넘어\s*[가갈간])"
    r"|^\s*(마|뭐|그래)?\s*,?\s*됐다\s*[.!~]*$"
)
# A remainder opening like this still leans on the removed reproach ('그래도 …').
CONCESSIVE = re.compile(
    r"(그래도|하지만|근데|그런데|그러니까|그러니|그래서|그렇지만|그치만)요?(?![가-힣])"
)
# The speaker's own slip ('제가 깜빡했나 봐요') is not blame.
FIRST_PERSON = re.compile(r"(제가|내가|저도|나도|내도)\s*\S{0,8}$")
# Kiryu always writes politely and briefly; remarking on it reads as if the
# relationship had just changed.
ADDRESS_REMARK = re.compile(r"깍듯|징그럽|딱딱하|존댓말|높임말|격식")
TRANSLATIONESE = re.compile(r"그녀|당신")
# Another sample cannot fix these: the model or its server is down, the input
# is too large, or one call already used the whole time limit.
STOP_SAMPLING = frozenset(
    {
        "context_limit",
        "generation_timeout",
        "model_unavailable",
        "model_connection_lost",
        "model_template_missing",
        "model_protocol",
        "unexpected_reasoning",
        "unexpected_tool_call",
    }
)
# (pattern, penalty when none of the last three texts used it). Majima's
# nickname for Kiryu stays free once; any repeat costs 2.
CATCHPHRASES = {
    "majima": ((re.compile(r"갑자기"), 1), (re.compile(r"키류\s*쨩"), 0)),
    "haruka": ((re.compile(r"^\s*(와|우와)[,!~ ]"), 1),),
}
SENTENCE = re.compile(r"[^.!?…~\n]+[.!?…~]*")


def _opener(text):
    words = re.findall(r"[0-9A-Za-z가-힣ㄱ-ㅎ]+", text)
    return words[0][:3] if words else ""


def _hangul(text):
    return len(re.findall(r"[가-힣]", text))


def _grams(text):
    compact = re.sub(r"\s+", "", text)
    return {compact[i : i + 3] for i in range(max(0, len(compact) - 2))}


def _sentences(text):
    """Sentences long enough that repeating one reads as a canned line."""
    return [part for part in SENTENCE.findall(text) if _hangul(part) >= 6]


def _similarity(left, right):
    a, b = _grams(left), _grams(right)
    return len(a & b) / len(a | b) if a and b else 0.0


def _similar(left, right):
    return _similarity(left, right) >= 0.5


def _blames(text, user_message):
    for pattern, topic in BLAME:
        if topic.search(user_message):
            continue
        for match in pattern.finditer(text):
            if not FIRST_PERSON.search(text[: match.start()]):
                return True
    return False


def inspect(reply, *, character, user_message=None, previous=(), examples=()):
    """Return hard faults and soft penalties for one candidate SMS.

    ``examples`` are the card's authored example replies, which the prompt says
    not to copy.
    """
    text = reply.strip()
    previous = [p for p in previous if isinstance(p, str) and p.strip()]
    hard, soft = [], []
    short = user_message and (
        is_minimal_reply(user_message) or len(user_message.strip()) <= 10
    )
    if short and any(pattern.search(text) for pattern in SCOLDING):
        hard.append("scolds_short_reply")
    if META.search(text):
        hard.append("meta_wording")
    if STAGE.search(text):
        hard.append("stage_direction")
    if len(text) > 200:
        hard.append("too_long")
    if len(SENTENCE.findall(text)) > 3:
        soft.append(("long", 1))
    if (
        previous
        and _opener(text)
        and _opener(text) in {_opener(p) for p in previous[-3:]}
    ):
        soft.append(("repeated_opener", 2))
    for pattern, first in CATCHPHRASES.get(character, ()):
        if not pattern.search(text):
            continue
        if any(pattern.search(p) for p in previous[-3:]):
            soft.append(("repeated_catchphrase", 2))
        elif first:
            soft.append(("catchphrase", first))
    if short and any(COMPLAINT.search(part) for part in SENTENCE.findall(text)):
        soft.append(("complains_after_short_reply", 2))
    if _blames(text, user_message or ""):
        soft.append(("blames_memory_health_or_drink", 2))
    if ADDRESS_REMARK.search(text) and not ADDRESS_REMARK.search(user_message or ""):
        soft.append(("remarks_on_politeness", 2))
    if ends_with_question(text):
        streak = len(previous) >= 2 and all(
            ends_with_question(p) for p in previous[-2:]
        )
        if character == "haruka":
            soft.append(("unanswerable_question", 2))
        elif streak:
            soft.append(("question_streak", 2))
    if any(_similar(text, p) for p in previous[-5:]):
        soft.append(("near_duplicate", 3))
    elif any(
        _similar(mine, theirs)
        for mine in _sentences(text)
        for earlier in previous[-3:]
        for theirs in _sentences(earlier)
    ):
        soft.append(("repeated_sentence", 2))
    # The model copies an authored example word for word when the situation
    # matches it (seen on declines), which gives every visitor the same line.
    closest = max((_similarity(text, example) for example in examples), default=0.0)
    if closest >= 0.65:
        hard.append("copies_example")
    elif closest >= 0.5:
        soft.append(("echoes_example", 3))
    if TRANSLATIONESE.search(text):
        soft.append(("translationese", 1))
    return {
        "hard": hard,
        "soft": [name for name, _ in soft],
        "penalty": sum(points for _, points in soft),
    }


def _without_complaint(text):
    """The text minus its complaint, or None if no usable remainder is left.

    Real-model runs showed every sample scolding a receipt such as '그렇군요'
    while ending with a natural acceptance ('뭐, 나중에 생각나면 연락해라.'), so
    that remainder is kept instead of shipping a scolding text. A clause after
    the complaint in the same sentence ('대답이 짧네, 7시에 온나.') is kept; a
    remainder that is too short or opens with a concession is not used.
    """
    kept, changed, after_removal = [], False, False
    for part in (piece.strip() for piece in SENTENCE.findall(text)):
        if not part:
            continue
        scold = next((m for p in SCOLDING if (m := p.search(part))), None)
        if scold is None and not COMPLAINT.search(part):
            # '그래도 꼭 온나.' right after a removed reproach still answers it.
            if after_removal and CONCESSIVE.match(part):
                continue
            kept.append(part)
            after_removal = False
            continue
        changed = after_removal = True
        if scold is not None and not COMPLAINT.search(part):
            comma = part.find(",", scold.end())
            rest = part[comma + 1 :].strip() if comma >= 0 else ""
            if (
                _hangul(rest) >= 4
                and not any(p.search(rest) for p in SCOLDING)
                and not CONCESSIVE.match(rest)
            ):
                kept.append(rest)
    if not changed or not kept or CONCESSIVE.match(kept[0]):
        return None
    remainder = " ".join(kept)
    return remainder if _hangul(remainder) >= 8 else None


def _order(count, seed):
    """Deterministic shuffle so the judge's position bias does not favour sample 1."""
    keys = [hashlib.sha256(f"{seed}:{i}".encode()).hexdigest() for i in range(count)]
    return sorted(range(count), key=keys.__getitem__)


def select_reply(
    generate,
    *,
    character,
    user_message=None,
    previous=(),
    count=3,
    allowed=lambda _text: True,
    judge=None,
    seed="",
    examples=(),
    keep_going=lambda: True,
    repair_complaints=False,
):
    """Draw up to ``count`` samples and return (chosen result, audit).

    A sample is usable when generation finished normally with allowed text and
    no hard fault. The lowest penalty wins; a judge only breaks exact ties.
    When every returned sample has a hard fault, one more round is drawn
    (latency is not a constraint here); after that the least faulty finished
    text is used. Model failures with a ``code`` skip that sample, and those in
    STOP_SAMPLING end sampling at once; any other exception propagates. Before
    each later sample ``keep_going`` is asked, so stale work stops early. With
    ``repair_complaints``, a reply to a one-word answer that only failed for
    scolding it may ship without the complaint (see _without_complaint). Without
    a finished sample, the first result is returned unchanged so the caller's
    existing failure handling applies; if every call failed, the first failure
    is raised again.
    """
    results, errors, candidates = [], [], []
    stopped = False
    for _round in range(2):
        for _ in range(max(1, count)):
            if (results or errors) and not keep_going():
                stopped = True
                break
            try:
                result = generate()
            except Exception as error:
                code = getattr(error, "code", None)
                if code is None:
                    raise
                errors.append(error)
                if code in STOP_SAMPLING:
                    stopped = True
                    break
                continue
            reply = result.get("reply")
            finished = result.get("finish_reason") in {"stop", "eos"}
            usable = (
                finished and isinstance(reply, str) and reply.strip() and allowed(reply)
            )
            checks = (
                inspect(
                    reply,
                    character=character,
                    user_message=user_message,
                    previous=previous,
                    examples=examples,
                )
                if usable
                else {"hard": ["unfinished_or_blocked"], "soft": [], "penalty": 0}
            )
            candidates.append({"index": len(results), "reply": reply or "", **checks})
            results.append(result)
        if stopped or not candidates or any(not c["hard"] for c in candidates):
            break
    if not results:
        raise errors[0]
    audit = {
        "requested": count,
        "errors": [e.code for e in errors],
        "candidates": candidates,
    }
    clean = [c for c in candidates if not c["hard"]]
    if not clean:
        repaired = []
        receipt = (
            repair_complaints
            and bool(user_message)
            and is_minimal_reply(user_message)
            and not ends_with_question(user_message)
        )
        for c in candidates if receipt else ():
            if c["hard"] != ["scolds_short_reply"]:
                continue
            text = _without_complaint(c["reply"])
            if text is None or not allowed(text):
                continue
            checks = inspect(
                text,
                character=character,
                user_message=user_message,
                previous=previous,
                examples=examples,
            )
            if not checks["hard"]:
                repaired.append({"index": c["index"], "reply": text, **checks})
        if repaired:
            best = min(c["penalty"] for c in repaired)
            tied = [c for c in repaired if c["penalty"] == best]
            chosen = _break_tie(tied, judge, seed, keep_going, audit)
            audit["chosen"] = chosen["index"]
            audit["reason"] = "complaint_removed"
            audit["repaired_reply"] = chosen["reply"]
            return {**results[chosen["index"]], "reply": chosen["reply"]}, audit
        finished = [c for c in candidates if "unfinished_or_blocked" not in c["hard"]]
        chosen = (
            min(finished, key=lambda c: (len(c["hard"]), c["penalty"]))
            if finished
            else candidates[0]
        )
        audit["chosen"] = chosen["index"]
        audit["reason"] = "least_faulty" if finished else "no_usable_candidate"
        return results[chosen["index"]], audit
    best = min(c["penalty"] for c in clean)
    tied = [c for c in clean if c["penalty"] == best]
    audit["reason"] = "lowest_penalty"
    chosen = _break_tie(tied, judge, seed, keep_going, audit)
    audit["chosen"] = chosen["index"]
    return results[chosen["index"]], audit


def _break_tie(tied, judge, seed, keep_going, audit):
    """The first tied candidate, unless a judge picks another in shuffled order."""
    if len(tied) < 2 or judge is None or not keep_going():
        return tied[0]
    order = _order(len(tied), seed)
    shown = [tied[i] for i in order]
    audit["judge_order"] = [c["index"] for c in shown]
    try:
        pick = judge([c["reply"] for c in shown])
    except Exception:  # noqa: BLE001 -- the rule winner stands if judging fails
        pick = None
    if not (isinstance(pick, int) and 0 <= pick < len(shown)):
        return tied[0]
    audit["reason"] = "judge_tiebreak"
    audit["judge_picked"] = True
    return shown[pick]


JUDGE_SYSTEM = """너는 한국어 휴대폰 문자 대화를 읽고, 다음에 올 {name}의 문자 후보 중 가장 자연스러운 것을 고르는 심사자다.
{name}: {persona}
기준(중요한 순서):
1. 키류가 방금 보낸 문자에 자연스럽게 이어진다.
2. {name}다운 말투와 성격이다.
3. 휴대폰 문자처럼 짧고 구체적이다. 길이가 길다고 더 좋은 것은 아니다.
4. 앞선 문자와 같은 말이나 첫마디를 되풀이하지 않는다.
후보 번호 하나만 숫자로 답한다."""


def judge_messages(name, persona, thread, candidates):
    """Prompt for a tie-break judge; thread is the recent native turns."""
    lines = [
        ("키류" if turn["role"] == "user" else name)
        + ": "
        + turn["content"].replace("\n", " / ")
        for turn in thread[-8:]
    ]
    return [
        {"role": "system", "content": JUDGE_SYSTEM.format(name=name, persona=persona)},
        {
            "role": "user",
            "content": "대화:\n"
            + "\n".join(lines)
            + "\n\n후보:\n"
            + "\n".join(f"{i + 1}. {text}" for i, text in enumerate(candidates))
            + "\n\n가장 자연스러운 후보 번호:",
        },
    ]


def parse_pick(text, count):
    match = re.search(r"\d+", text or "")
    if not match:
        return None
    value = int(match.group(0)) - 1
    return value if 0 <= value < count else None
