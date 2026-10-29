"""Narrow explicit-content guard for this non-explicit character experience.

This is a deterministic backstop, not a semantic moderation model. The character
instructions also decline sexual roleplay; their behavior is tested separately.
Do not classify affection, ordinary romance or reports of harassment as explicit.
"""

import re
import unicodedata

POLICY_VERSION = "phone-non-explicit-v1"
POLICY_MESSAGE = (
    "이 대화에서는 노골적인 성적 내용은 주고받지 않습니다. 다른 이야기로 보내 주세요."
)

_EXPLICIT_TERMS = re.compile(
    r"(?:섹스|쎅스|성관계|성행위|사정액|포르노|야동|펠라치오|"
    r"(?<![가-힣])(?:성기|자위(?!대)|정액(?!제))|음경|음핵|질내사정|강간|セックス|オナニー|フェラ|射精|"
    r"\b(?:sex|sexting|porn|blowjob|handjob|masturbat\w*|penis|vagina|"
    r"ejaculat\w*|cumshot|fuck(?:ing|ed)?)\b)",
    re.IGNORECASE,
)
_REQUEST = re.compile(
    r"(?:하자|해줘|해봐|하고싶|보여줘|묘사|상세|자세|구체|노골|대사|"
    r"역할극|롤플|상상|하는장면|하던장면|입으로|벗기|벗어|"
    r"describe|explicit|roleplay|pretend|showme|let'?s|withme|"
    r"描写|詳しく|して|しよう)"
)
_GRAPHIC = re.compile(
    r"(?<![가-힣])(?:성기|음경|음핵|질내|정액(?!제)|사정액|페니스|ヴァギナ|ペニス)"
    r".{0,24}(?:넣|빨|핥|문질|쑤|싸|비비|삽입|舐|入れ|擦)"
    r"|(?:blowjob|handjob|cumshot|질내사정|펠라치오)"
)
_NON_EXPLICIT_CONTEXT = re.compile(
    r"(?:피해|신고|상담|거절|동의없이|성교육|예방|하지마|하지말|"
    r"하지않|안할|싫어|괴롭힘|report|harass|assault|consent|"
    r"don'?t|do\s*not|stop|嫌|通報|やめ)"
)


def _normalized(text):
    return unicodedata.normalize("NFKC", text).casefold()


def explicit_request(text: str) -> bool:
    """Block clear generation requests; let non-explicit discussion reach policy."""
    normalized = _normalized(text)
    compact = re.sub(r"[\s\u200b-\u200f\ufeff]+", "", normalized)
    if not _EXPLICIT_TERMS.search(normalized) and not _EXPLICIT_TERMS.search(compact):
        return False
    # A protective context is not an exemption for a graphic requested scene.
    if _GRAPHIC.search(compact):
        return bool(_REQUEST.search(compact)) or not _NON_EXPLICIT_CONTEXT.search(
            compact
        )
    return bool(_REQUEST.search(compact)) and not _NON_EXPLICIT_CONTEXT.search(compact)


def output_allowed(text: str) -> bool:
    """Withhold explicit action text; a short refusal can name the topic."""
    normalized = _normalized(text)
    compact = re.sub(r"\s+", "", normalized)
    if _GRAPHIC.search(compact):
        return bool(_NON_EXPLICIT_CONTEXT.search(compact)) and not _REQUEST.search(
            compact
        )
    return not explicit_request(text)
