"""Approved character evidence and scoped raw-memory retrieval.

The broad story corpus is never an implicit runtime knowledge source. This
module only indexes explicitly adopted records, and filters before ranking.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from collections import OrderedDict
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

EMBEDDING_REPO = "intfloat/multilingual-e5-small"
EMBEDDING_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
RETRIEVER_VERSION = "daily-if-hybrid-v2"
ALIASES = {
    "키류": ("kiryu", "桐生"),
    "하루카": ("haruka", "遥"),
    "마지마": ("majima", "真島"),
    "사에지마": ("saejima", "冴島"),
    "다이고": ("daigo", "大吾"),
    "다테": ("makoto date", "伊達"),
    "니시키": ("니시키야마", "nishiki", "nishikiyama", "錦山"),
    "유미": ("yumi", "由美"),
    "미네": ("yoshitaka mine", "峯"),
    "아키야마": ("akiyama", "秋山"),
    "나팔꽃": ("아사가오", "asagao", "morning glory", "orphanage", "보육원"),
    "카무로쵸": ("카무로초", "kamurocho", "神室町"),
    "소텐보리": ("sotenbori", "蒼天堀"),
    "오키나와": ("okinawa", "沖縄"),
}
CORRECTION = re.compile(
    r"말고|아니라|취소|바꾸|바꿔|변경|정정|철회|하지\s?마|안\s?(?:갈|살|할)"
    r"|그거.{0,12}(?:않|안)|이제.{0,12}(?:않|안)"
)
PRONOUN = re.compile(r"그거|그것|그건|그\s?(?:약속|계획|일정)|아까|전에\s?말|말한\s?거")
PARTICLES = re.compile(
    r"(?:에게는|한테는|에서는|으로는|께서는|에게|한테|에서|으로|와는|과는|이나|라는|라고|은|는|이|가|을|를|에|도|와|과|야|아)$"
)
STOPWORDS = frozenset(
    [
        "오늘",
        "현재",
        "나는",
        "내가",
        "네가",
        "우리",
        "너는",
        "무슨",
        "어떤",
        "언제",
        "왜",
        "어디",
        "것이",
        "있는",
        "하는",
        "한다",
        "있다",
        "한다고",
        "하면",
        "하고",
        "그거",
        "저거",
        "이것",
        "저것",
        "입니다",
        "아니라",
        "않는다",
        "때문",
        "때문",
        "생각",
        "대한",
        "대해",
        "위한",
        "위한",
        "것",
        "같아",
        "좋을",
        "정말",
        "지금",
        "이번",
        "그럼",
        "에서",
        "까지",
        "으로",
        "에게",
        "한테",
        "하루카",
        "마지마",
        "키류",
        "haruka",
        "majima",
        "kiryu",
        "遥",
        "真島",
        "桐生",
    ]
)


def stable_hash(value):
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()


def normalize(text):
    """Keep Korean stems and cross-language proper names, including particles."""
    normalized = text.casefold()
    additions = []
    for name, alternatives in ALIASES.items():
        if name in normalized or any(x in normalized for x in alternatives):
            additions.extend((name, *alternatives))
    words = re.findall(r"[\w]+", normalized)
    for word in words:
        stem = PARTICLES.sub("", word)
        if len(stem) >= 2 and stem != word:
            additions.append(stem)
    # Korean character bigrams handle inflection without a heavyweight analyzer.
    for word in re.findall(r"[가-힣]{2,}", normalized):
        additions.extend(word[i : i + 2] for i in range(len(word) - 1))
    return " ".join((*words, *dict.fromkeys(additions)))


def _tokens(text):
    return {t for t in normalize(text).split() if len(t) >= 2 and t not in STOPWORDS}


def _topic_tokens(text):
    text = re.sub(r"말고|아니라|취소\w*|변경\w*|정정\w*|바꾸\w*|바꿔\w*", " ", text)
    return _tokens(text) - {
        "하자",
        "하던",
        "하기",
        "하기로",
        "대신",
        "약속",
        "계획",
        "말한",
        "아까",
        "전에",
        "알겠",
        "좋아",
        "겠어",
        "거야",
        "할게",
        "해요",
        "해야",
        "해줘",
    }


def requested_dates(query):
    """Explicit ISO dates only; never guess 'last week' from server time."""
    result = set()
    for match in re.findall(r"(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)", query):
        try:
            result.add(date.fromisoformat(match).isoformat())
        except ValueError:
            continue
    return result


def message_date(message):
    value = message.get("time")
    if not isinstance(value, str):
        return None
    try:
        instant = datetime.fromisoformat(value)
        if instant.tzinfo is None:
            return None
        return instant.astimezone(ZoneInfo("Asia/Seoul")).date().isoformat()
    except ValueError:
        return None


def load_registry(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if value.get("schema_version") != 1:
        raise ValueError("Unsupported runtime registry")
    seen = set()
    for record in value["records"]:
        if record["id"] in seen:
            raise ValueError("Duplicate runtime record")
        seen.add(record["id"])
        if record.get("kind") not in {"fact", "scene"}:
            raise ValueError("Runtime records must separate facts from scenes")
        source = record.get("source", {})
        if not source.get("url") or not source.get("sha256"):
            raise ValueError("Runtime record requires source identity")
        if not source.get("span") or not source.get("excerpt"):
            raise ValueError("Runtime record requires an explicit evidence span")
        if (
            source.get("excerpt_sha256")
            != hashlib.sha256(source["excerpt"].encode()).hexdigest()
        ):
            raise ValueError("Runtime evidence hash mismatch")
        if record.get("split") not in {None, "train"}:
            raise ValueError("Held-out dialogue may not enter the runtime pool")
        for field in ("known_by", "scenarios"):
            scope = record.get(field)
            if not isinstance(scope, list) or not all(
                isinstance(item, str) and item for item in scope
            ):
                raise ValueError("Runtime evidence requires explicit scope lists")
        if not record.get("review_basis"):
            raise ValueError("Missing explicit adoption basis")
    return value


def runtime_eligible(record, character, scenario):
    """One authorization boundary for ranked evidence and fixed card facts."""
    return (
        record.get("runtime_eligible") is True
        and record.get("approval") == "agent-reviewed-experiment"
        and isinstance(record.get("known_by"), list)
        and character in record["known_by"]
        and isinstance(record.get("scenarios"), list)
        and scenario in record["scenarios"]
        and record.get("split") in {None, "train"}
    )


def download_embedding(output):
    """Fetch only a pinned, portable CPU ONNX graph and native tokenizer."""
    from huggingface_hub import hf_hub_download

    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    files = []
    for name in ("onnx/model.onnx", "onnx/tokenizer.json"):
        path = Path(
            hf_hub_download(
                EMBEDDING_REPO,
                name,
                revision=EMBEDDING_REVISION,
                local_dir=output,
            )
        )
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        files.append(
            {"path": name, "bytes": path.stat().st_size, "sha256": digest.hexdigest()}
        )
    manifest = {
        "repo": EMBEDDING_REPO,
        "revision": EMBEDDING_REVISION,
        "provider": "CPUExecutionProvider",
        "pooling": "attention-masked mean, L2 normalized",
        "prefixes": {"query": "query: ", "passage": "passage: "},
        "max_tokens": 512,
        "files": files,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


class E5Onnx:
    """CPU-only E5; no model repository code or generative model is loaded."""

    def __init__(self, directory, threads=4):
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer

        ort.disable_telemetry_events()
        root = Path(directory)
        manifest = json.loads((root / "manifest.json").read_text())
        if manifest.get("revision") != EMBEDDING_REVISION:
            raise ValueError("Unexpected embedding revision")
        for file in manifest["files"]:
            digest = hashlib.sha256()
            with (root / file["path"]).open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            if digest.hexdigest() != file["sha256"]:
                raise ValueError("Embedding asset hash mismatch")
        self.np = np
        self.tokenizer = Tokenizer.from_file(str(root / "onnx/tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=512)
        self.tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(
            str(root / "onnx/model.onnx"),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self.input_names = {item.name for item in self.session.get_inputs()}
        self.cache = OrderedDict()

    def encode(self, texts, *, query=False):
        prefix = "query: " if query else "passage: "
        keys = [prefix + value for value in texts]
        missing = list(dict.fromkeys(key for key in keys if key not in self.cache))
        for offset in range(0, len(missing), 8):
            batch = missing[offset : offset + 8]
            encoded = self.tokenizer.encode_batch(batch)
            arrays = {
                "input_ids": self.np.array([x.ids for x in encoded], dtype="int64"),
                "attention_mask": self.np.array(
                    [x.attention_mask for x in encoded], dtype="int64"
                ),
                "token_type_ids": self.np.array(
                    [x.type_ids for x in encoded], dtype="int64"
                ),
            }
            states = self.session.run(
                None, {k: v for k, v in arrays.items() if k in self.input_names}
            )[0]
            mask = arrays["attention_mask"][:, :, None]
            vectors = (states * mask).sum(1) / mask.sum(1).clip(min=1)
            vectors /= self.np.linalg.norm(vectors, axis=1, keepdims=True).clip(
                min=1e-12
            )
            for key, vector in zip(batch, vectors, strict=True):
                self.cache[key] = vector.tolist()
        result = [self.cache[key] for key in keys]
        while len(self.cache) > 4096:
            self.cache.popitem(last=False)
        return result


def _lexical_rank(records, query):
    if not records:
        return []
    # Build after authorization filtering. FTS never sees an unauthorized row.
    with sqlite3.connect(":memory:") as connection:
        connection.execute("CREATE VIRTUAL TABLE docs USING fts5(id UNINDEXED, text)")
        connection.executemany(
            "INSERT INTO docs VALUES (?, ?)",
            [(r["id"], normalize(r["search_text"])) for r in records],
        )
        terms = sorted(_tokens(query))
        if not terms:
            return []
        match = " OR ".join('"' + t.replace('"', '""') + '"' for t in terms)
        return [
            row[0]
            for row in connection.execute(
                "SELECT id FROM docs WHERE docs MATCH ? ORDER BY bm25(docs), id",
                (match,),
            )
        ]


class HybridRetriever:
    def __init__(self, registry, encoder=None, semantic_threshold=0.84):
        self.registry = (
            load_registry(registry) if isinstance(registry, (str, Path)) else registry
        )
        self.encoder = encoder
        self.semantic_threshold = semantic_threshold
        self.version = RETRIEVER_VERSION
        self.mode = "bm25-e5-rrf" if encoder else "bm25-only"

    def rank(self, records, query, limit):
        lexical = _lexical_rank(records, query)
        semantic = []
        similarities = {}
        if self.encoder and records:
            q = self.encoder.encode([query], query=True)[0]
            vectors = self.encoder.encode([r["search_text"] for r in records])
            similarities = {
                r["id"]: sum(a * b for a, b in zip(q, v, strict=True))
                for r, v in zip(records, vectors, strict=True)
            }
            semantic = sorted(similarities, key=lambda key: (-similarities[key], key))
            semantic = [
                key for key in semantic if similarities[key] >= self.semantic_threshold
            ]
        scores = {}
        for ranking in (lexical, semantic):
            for rank, key in enumerate(ranking, 1):
                scores[key] = scores.get(key, 0) + 1 / (60 + rank)
        by_id = {r["id"]: r for r in records}
        return [
            {
                **by_id[key],
                "score": scores[key],
                "semantic_score": similarities.get(key),
                "retrieval_mode": self.mode,
            }
            for key in sorted(scores, key=lambda key: (-scores[key], key))[:limit]
        ]

    def evidence(self, character, scenario, query, *, exclude_ids=()):
        eligible = [
            {**record, "search_text": record["text"]}
            for record in self.registry["records"]
            if runtime_eligible(record, character, scenario)
            and record["id"] not in exclude_ids
        ]
        return {
            "facts": self.rank([r for r in eligible if r["kind"] == "fact"], query, 3),
            "scenes": self.rank(
                [r for r in eligible if r["kind"] == "scene"], query, 1
            ),
        }

    def memories(
        self,
        visitor,
        character,
        scenario,
        history,
        query,
        recent_start,
        *,
        date_query=None,
    ):
        """Search raw completed exchanges, then attach later correction context.

        Explicit scope fields, when supplied, must match. A scoped DB read is
        required for unannotated rows. No inference of completed actions occurs.
        """
        validate_history(history, visitor, character, scenario)
        windows = []
        dates = requested_dates(query if date_query is None else date_query)
        for start in range(0, recent_start, 2):
            pair = history[start : start + 2]
            if dates and not any(message_date(message) in dates for message in pair):
                continue
            windows.append(
                {
                    "id": "memory:" + pair[0]["id"],
                    "kind": "memory",
                    "visitor_id": visitor,
                    "character_id": character,
                    "scenario_version": scenario,
                    "start": start,
                    "date_filter": sorted(dates),
                    "search_text": "\n".join(m["content"] for m in pair),
                }
            )
        # Keep one candidate selected from the current message alone: a long
        # unrelated recent exchange must not drown out a newly named topic.
        # The other slot still uses recent context to resolve "that"/"then".
        # date_query is the unexpanded current user message from the builder.
        primary_query = query if date_query is None else date_query
        primary = self.rank(windows, primary_query, 2)
        contextual = self.rank(windows, query, 2)
        selected = []
        selected_ids = set()
        for window in (*primary[:1], *contextual, *primary[1:]):
            if window["id"] not in selected_ids:
                selected.append(window)
                selected_ids.add(window["id"])
            if len(selected) == 2:
                break
        result = []
        for window in selected:
            start = window["start"]
            indices = set(range(max(0, start - 2), min(len(history), start + 4)))
            links = []
            # Scan the whole later timeline, not only retrieved top-k. Keep
            # every detected direct correction chain. Explicitly different
            # topics do not inflate this window until it becomes unusable.
            # Either speaker can introduce a proposal. These tokens only link
            # raw utterances; an assistant promise is never a completed action.
            target_tokens = _topic_tokens(
                "\n".join(m["content"] for m in history[start : start + 2])
            )
            cautions = []
            for later in range(start + 2, len(history), 2):
                message = history[later]
                if not CORRECTION.search(message["content"]):
                    continue
                current_tokens = _topic_tokens(message["content"])
                direct = bool(target_tokens & current_tokens)
                prior_tokens = _topic_tokens(
                    "\n".join(m["content"] for m in history[later - 2 : later])
                )
                nearby = bool(PRONOUN.search(message["content"])) and bool(
                    target_tokens & prior_tokens
                )
                if not direct and not nearby:
                    if PRONOUN.search(message["content"]):
                        cautions.append(later)
                    continue
                links.append(
                    {
                        "message_id": message["id"],
                        "resolution": "lexical-link" if direct else "nearby-reference",
                        "certainty": "candidate-not-confirmed-state",
                    }
                )
                indices.update(range(later - 2 if nearby else later, later + 2))
                target_tokens.update(
                    _topic_tokens(
                        "\n".join(m["content"] for m in history[later : later + 2])
                    )
                )
            # Only genuinely unresolved reference corrections get caution
            # slots. They retain original text, never become a fact update.
            for later in cautions[-2:]:
                links.append(
                    {
                        "message_id": history[later]["id"],
                        "resolution": "scope-caution",
                        "certainty": "candidate-not-confirmed-state",
                    }
                )
                indices.update(range(later - 2, later + 2))
            messages = [dict(history[i]) for i in sorted(indices)]
            result.append(
                {
                    **window,
                    "messages": messages,
                    "correction_links": links,
                    "memory_status": "past-utterances-not-current-facts",
                }
            )
        return result


def validate_history(history, visitor, character, scenario):
    if len(history) % 2:
        raise ValueError("Memory requires completed exchanges")
    seen = set()
    for index, message in enumerate(history):
        if message.get("role") != ("user" if index % 2 == 0 else "assistant"):
            raise ValueError("Memory roles must alternate")
        if (
            not isinstance(message.get("content"), str)
            or not message["content"].strip()
        ):
            raise ValueError("Memory content must be nonempty")
        if not message.get("id") or message["id"] in seen:
            raise ValueError("Memory requires unique immutable message IDs")
        seen.add(message["id"])
        for key, expected in (
            ("visitor_id", visitor),
            ("character_id", character),
            ("character", character),
            ("scenario_version", scenario),
        ):
            if key in message and message[key] != expected:
                raise ValueError("Cross-scope memory rejected")
        if message.get("status", "complete") != "complete":
            raise ValueError("Unsuccessful exchange cannot become memory")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download-embedding")
    parser.add_argument("--registry")
    parser.add_argument("--evaluation")
    parser.add_argument("--embedding-dir")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.download_embedding:
        print(json.dumps(download_embedding(args.download_embedding)))
        return
    if not all((args.registry, args.evaluation, args.output)):
        parser.error("Provide registry, evaluation and output, or download-embedding")
    encoder = E5Onnx(args.embedding_dir) if args.embedding_dir else None
    retriever = HybridRetriever(args.registry, encoder)
    evaluation_bytes = Path(args.evaluation).read_bytes()
    evaluation = json.loads(evaluation_bytes)
    cases = evaluation.get("cases", evaluation.get("questions"))
    if not isinstance(cases, list) or not cases:
        parser.error("Evaluation requires a nonempty cases or questions list")
    outcomes = []
    for case in cases:
        # Match ChatPromptBuilder's search input, including the last two real
        # exchanges. This evaluates retrieval before the token-budget step.
        query = (
            case["query"]
            + "\n"
            + "\n".join(message["content"] for message in case.get("history", [])[-4:])
        )
        hits = retriever.evidence(case["character"], case["scenario"], query)
        observed = {hit["id"] for group in hits.values() for hit in group}
        expected = set(case["gold_ids"])
        outcome = {
            "id": case["id"],
            "retrieval_query": query,
            "gold_ids": sorted(expected),
            "observed_ids": sorted(observed),
            "pass": bool(expected & observed) if expected else not observed,
            "answerable": bool(expected),
            "candidate_count": len(observed),
            "gold_candidate_correct": len(expected & observed),
        }
        if "relevant_context_ids" in case:
            context_ids = set(case["relevant_context_ids"])
            outcome["relevant_context_ids"] = sorted(context_ids)
            outcome["context_candidate_correct"] = len(context_ids & observed)
        outcomes.append(outcome)
    answerable = [x for x in outcomes if x["answerable"]]
    gold_correct = sum(x["gold_candidate_correct"] for x in answerable)
    gold_total = sum(x["candidate_count"] for x in answerable)
    context_annotated = [x for x in outcomes if "context_candidate_correct" in x]
    evaluation_canonical_sha256 = stable_hash(evaluation)
    report = {
        "retriever_version": retriever.version,
        "mode": retriever.mode,
        "evaluation_split": evaluation.get("split", "unspecified"),
        "evaluation_sha256": evaluation_canonical_sha256,
        "evaluation_file_sha256": hashlib.sha256(evaluation_bytes).hexdigest(),
        "evaluation_canonical_sha256": evaluation_canonical_sha256,
        "evaluation_purpose": evaluation.get("purpose"),
        "evaluation_author": evaluation.get("author"),
        "registry_sha256": stable_hash(retriever.registry),
        "registry_file_sha256": hashlib.sha256(
            Path(args.registry).read_bytes()
        ).hexdigest(),
        "registry_canonical_sha256": stable_hash(retriever.registry),
        "cases": len(outcomes),
        "answerable_cases": len(answerable),
        "answerable_correct": sum(x["pass"] for x in answerable),
        "candidate_recall": sum(x["pass"] for x in answerable) / len(answerable)
        if answerable
        else None,
        "gold_candidate_correct": gold_correct,
        "gold_candidate_count": gold_total,
        "gold_candidate_precision": gold_correct / gold_total if gold_total else None,
        "negative_correct": sum(x["pass"] for x in outcomes if not x["answerable"]),
        "negative_cases": sum(not x["answerable"] for x in outcomes),
        "candidate_stage": "pre-token-budget",
        "query_contract": "current query + newline + history[-4:] content joined by newline",
        "scope": "Pre-token-budget retrieval only; no model, prompt-budget survival or fan fidelity conclusion",
        "outcomes": outcomes,
    }
    if context_annotated:
        context_correct = sum(x["context_candidate_correct"] for x in context_annotated)
        context_total = sum(x["candidate_count"] for x in context_annotated)
        report.update(
            {
                "context_annotated_cases": len(context_annotated),
                "context_candidate_correct": context_correct,
                "context_candidate_count": context_total,
                "context_precision": context_correct / context_total
                if context_total
                else None,
            }
        )
    Path(args.output).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps({k: v for k, v in report.items() if k != "outcomes"}))


if __name__ == "__main__":
    main()
