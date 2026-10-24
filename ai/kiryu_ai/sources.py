"""Collect a bounded, explicit catalog into private local reference storage.

The collected prose is reference evidence, never automatically approved SFT data.
No JavaScript is executed and no links are recursively followed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import UTC, datetime
from pathlib import Path

from bs4 import BeautifulSoup

USER_AGENT = "KiryuPhoneResearch/0.1 (+https://github.com/nam9nine/yaku_IPhone)"
ALLOWED_HOSTS = {
    "ryu-ga-gotoku.com",
    "www.ryu-ga-gotoku.com",
    "game-scripts-wiki.blogspot.com",
}
MAX_BYTES = 8 * 1024 * 1024
ALIASES = {
    "kiryu": {"키류 카즈마", "Kazuma Kiryu", "桐生 一馬"},
    "majima": {"마지마 고로", "Goro Majima", "真島 吾朗"},
    "haruka": {
        "하루카",
        "사와무라 하루카",
        "Haruka",
        "Haruka Sawamura",
        "遥",
        "澤村 遥",
    },
    "daigo": {"도지마 다이고", "Daigo Dojima", "堂島 大吾"},
    "mine": {"미네 요시타카", "Yoshitaka Mine", "峯 義孝"},
    "date": {"다테 마코토", "Makoto Date", "伊達 真"},
    "akiyama": {"아키야마 슌", "Shun Akiyama", "秋山 駿"},
    "saejima": {"사에지마 타이가", "Taiga Saejima", "冴島 大河"},
    "nishiki": {"니시키야마 아키라", "Akira Nishikiyama", "錦山 彰"},
    "yuki": {"유키", "Yuki", "ユキ"},
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def save_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    )
    temporary.replace(path)


def validate_url(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError(f"URL outside the explicit HTTPS source allowlist: {url}")
    if parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Credentials and custom ports are not valid source URLs")


class CheckedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        validate_url(newurl)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def download(url: str) -> tuple[bytes, dict]:
    validate_url(url)
    opener = urllib.request.build_opener(CheckedRedirect())
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with opener.open(request, timeout=30) as response:
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError(f"Source exceeds {MAX_BYTES} bytes")
        return data, {
            "status": response.status,
            "finalUrl": response.url,
            "contentType": response.headers.get("Content-Type", ""),
            "etag": response.headers.get("ETag"),
            "lastModified": response.headers.get("Last-Modified"),
        }


def text_from_html(html: str, *, page: bool = False) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for node in soup.select("script,style,noscript,nav,footer,header"):
        node.decompose()
    if page:
        soup = soup.select_one(".post-body") or soup.select_one("main") or soup
    for node in soup.select("br"):
        node.replace_with("\n")
    for node in soup.select("p,div,h1,h2,h3,h4,h5,li,section,article,tr"):
        node.insert_before("\n")
        node.insert_after("\n")
    return "\n".join(
        " ".join(line.split())
        for line in soup.get_text("").splitlines()
        if line.strip()
    )


def character_id(name: str) -> str | None:
    normalized = " ".join(name.split())
    return next(
        (key for key, aliases in ALIASES.items() if normalized in aliases), None
    )


def cast_records(data: object, source: dict, digest: str) -> list[dict]:
    if not isinstance(data, list):
        raise TypeError("Expected a list of title groups in official cast JSON")
    rows = []
    for group in data:
        title_id = group.get("id", group.get("titleId"))
        chars = group.get("chara")
        if chars is None:
            chars = [
                c for s in group.get("sections", []) for c in s.get("characters", [])
            ]
        for char in chars:
            if not char.get("id"):
                continue
            name = char.get("name", {}).get(
                "value", char.get("name", {}).get("display", "")
            )
            copy = char.get(
                "copy", char.get("popup", {}).get("copy", {}).get("bodyHtml", "")
            )
            if not isinstance(copy, str):
                raise TypeError("Unexpected cast prose format")
            rows.append(
                {
                    "id": f"{source['id']}:{char['id']}",
                    "sourceId": source["id"],
                    "sourceUrl": source["url"],
                    "sourceSha256": digest,
                    "sourceRecordId": char["id"],
                    "titleId": title_id,
                    "language": source["language"],
                    "characterId": character_id(name),
                    "name": name,
                    "text": text_from_html(copy),
                    "kind": "official_character_description",
                    "trainingEligible": False,
                    "knowledgeScope": "world_reference_requires_scenario_selection",
                }
            )
    return rows


def transcript_candidates(text: str, source: dict, digest: str) -> list[dict]:
    """Keep text in order, without certifying the fan's speaker labels or chronology."""
    rows = []
    for i, line in enumerate(text.splitlines()):
        match = re.match(r"^([A-Za-z][A-Za-z .’'\-]{0,55}):\s*(.+)$", line)
        if match:
            rows.append(
                {
                    "id": f"{source['id']}:{i}",
                    "sourceId": source["id"],
                    "sourceUrl": source["url"],
                    "sourceSha256": digest,
                    "lineIndex": i,
                    "speakerLabel": match[1],
                    "text": match[2],
                    "language": source["language"],
                    "scope": source["scope"],
                    "kind": "fan_transcript_candidate",
                    "trainingEligible": False,
                    "speakerVerified": False,
                    "orderVerified": False,
                }
            )
    return rows


def annotated_facts(records: list[dict], annotations: list[dict]) -> list[dict]:
    by_id = {(r["sourceId"], r["sourceRecordId"]): r for r in records}
    facts = []
    for annotation in annotations:
        source = by_id.get((annotation["sourceId"], annotation["sourceRecordId"]))
        if source is None:
            continue
        evidence = annotation["evidenceContains"]
        if evidence not in source["text"]:
            raise ValueError(
                f"Fact evidence no longer matches source: {annotation['id']}"
            )
        facts.append(
            {
                "id": annotation["id"],
                "textKo": annotation["textKo"],
                "characterIds": [annotation["characterId"]],
                "titleId": source["titleId"],
                "sourceId": source["sourceId"],
                "sourceRecordId": source["sourceRecordId"],
                "sourceUrl": source["sourceUrl"],
                "sourceSha256": source["sourceSha256"],
                "evidenceText": evidence,
                "evidenceStart": source["text"].index(evidence),
                "language": "ko",
                "sourceLanguage": source.get("language", "unknown"),
                "kind": "source_grounded_summary",
                "review": {"evidenceSubstringVerified": True, "fanReview": "pending"},
                "knownBy": [],
                "requiresScenarioSelection": True,
                "trainingEligible": False,
            }
        )
    return facts


def ensure_private_output(path: Path) -> Path:
    resolved = path.resolve()
    parts = resolved.parts
    if any(part in {"public", "src", "dist"} for part in parts):
        raise ValueError(
            "Source output cannot be placed in application or bundle directories"
        )
    if (
        not any(
            parts[i : i + 2] in (("references", "local"), ("harness", "local"))
            for i in range(len(parts) - 1)
        )
        and ".tooling" not in parts
    ):
        raise ValueError(
            "Source output must live in ignored references/local, harness/local, or .tooling"
        )
    return resolved


def collect(
    catalog_path: Path,
    output: Path,
    refresh: bool = False,
    annotations_path: Path | None = None,
) -> dict:
    output = ensure_private_output(output)
    catalog_bytes = catalog_path.read_bytes()
    catalog = json.loads(catalog_bytes)
    annotations_path = annotations_path or output / "annotations.json"
    annotations_bytes = (
        annotations_path.read_bytes() if annotations_path.exists() else None
    )
    annotations = json.loads(annotations_bytes) if annotations_bytes is not None else []
    if not isinstance(annotations, list):
        raise TypeError("Local annotations must be a list")
    source_ids = [s["id"] for s in catalog["sources"]]
    if len(set(source_ids)) != len(source_ids) or any(
        not re.fullmatch(r"[a-z0-9-]+", s) for s in source_ids
    ):
        raise ValueError("Source IDs must be unique safe filenames")
    output.mkdir(parents=True, exist_ok=True)
    old_path = output / "manifest.json"
    old = json.loads(old_path.read_text()) if old_path.exists() else {}
    old_sources = {s["id"]: s for s in old.get("sources", [])}
    robots = {}
    receipts, records, articles, candidates = [], [], [], []
    for source in catalog["sources"]:
        receipt = dict(source)
        if source.get("fetch") is False:
            receipt["collectionStatus"] = "excluded"
            receipts.append(receipt)
            continue
        try:
            validate_url(source["url"])
            origin = urllib.parse.urlsplit(source["url"])
            robots_url = f"{origin.scheme}://{origin.netloc}/robots.txt"
            if robots_url not in robots:
                try:
                    data, headers = download(robots_url)
                    body = data.decode("utf-8", "replace")
                    rp = urllib.robotparser.RobotFileParser()
                    rp.parse(body.splitlines())
                    robots[robots_url] = (
                        rp,
                        {
                            "url": robots_url,
                            "sha256": sha256(data),
                            **headers,
                            "body": body,
                        },
                    )
                except urllib.error.HTTPError as error:
                    if error.code != 404:
                        raise
                    robots[robots_url] = (
                        None,
                        {"url": robots_url, "status": 404, "body": ""},
                    )
            rp, _robot_receipt = robots[robots_url]
            if rp and not rp.can_fetch(USER_AGENT, source["url"]):
                raise ValueError("robots.txt disallows this collector")
            previous = old_sources.get(source["id"], {})
            cached = previous.get("rawPath")
            if not refresh and cached and previous.get("url") == source["url"]:
                candidate_path = (output / cached).resolve()
                if not candidate_path.is_relative_to(output):
                    raise ValueError("Cached source path escapes output directory")
                data = candidate_path.read_bytes()
                if sha256(data) != previous.get("sha256"):
                    raise ValueError("Cached source checksum mismatch")
                headers = previous.get("http", {})
                fetched_at = previous["fetchedAt"]
                receipt["cacheHit"] = True
            else:
                data, headers = download(source["url"])
                fetched_at = datetime.now(UTC).isoformat()
                receipt["cacheHit"] = False
                time.sleep(0.15)
            digest = sha256(data)
            suffix = "json" if source["format"] in ("json", "cast_json") else "html"
            raw_path = Path("raw") / f"{source['id']}-{digest[:16]}.{suffix}"
            (output / raw_path).parent.mkdir(parents=True, exist_ok=True)
            (output / raw_path).write_bytes(data)
            receipt.update(
                {
                    "rawPath": raw_path.as_posix(),
                    "sha256": digest,
                    "bytes": len(data),
                    "http": headers,
                    "fetchedAt": fetched_at,
                    "robotsUrl": robots_url,
                    "collectionStatus": "collected",
                }
            )
            decoded = data.decode("utf-8-sig")
            if source["format"] == "cast_json":
                records.extend(cast_records(json.loads(decoded), source, digest))
            elif source["format"] == "json":
                json.loads(decoded)
            else:
                text = text_from_html(decoded, page=True)
                if not text:
                    raise ValueError("Source has no readable text")
                articles.append(
                    {
                        "id": source["id"],
                        "url": source["url"],
                        "sourceSha256": digest,
                        "language": source["language"],
                        "kind": source["kind"],
                        "scope": source["scope"],
                        "text": text,
                        "trainingEligible": False,
                    }
                )
                if source["kind"] == "fan_transcript":
                    candidates.extend(transcript_candidates(text, source, digest))
            print(
                json.dumps(
                    {
                        "id": source["id"],
                        "status": "collected",
                        "bytes": len(data),
                        "cacheHit": receipt["cacheHit"],
                    }
                ),
                flush=True,
            )
        except (OSError, ValueError, TypeError, urllib.error.URLError) as error:
            receipt.update({"collectionStatus": "failed", "error": str(error)})
            print(
                json.dumps(
                    {"id": source["id"], "status": "failed", "error": str(error)}
                ),
                flush=True,
            )
        receipts.append(receipt)
    article_evidence = [
        {
            "sourceId": r["id"],
            "sourceRecordId": "main",
            "sourceUrl": r["url"],
            "sourceSha256": r["sourceSha256"],
            "titleId": r["scope"],
            "language": r["language"],
            "text": r["text"],
        }
        for r in articles
    ]
    facts = annotated_facts(records + article_evidence, annotations)
    save_jsonl(output / "cast-records.jsonl", records)
    save_jsonl(output / "articles.jsonl", articles)
    save_jsonl(output / "transcript-candidates.jsonl", candidates)
    save_jsonl(output / "knowledge.jsonl", facts)
    save_json(output / "robots-receipts.json", [r[1] for r in robots.values()])
    report = {
        "schemaVersion": 1,
        "checkedAt": datetime.now(UTC).isoformat(),
        "catalogSha256": sha256(catalog_bytes),
        "annotationsSha256": sha256(annotations_bytes)
        if annotations_bytes is not None
        else None,
        "annotationStatus": "provided"
        if annotations_bytes is not None
        else "not-provided",
        "collectorSha256": sha256(Path(__file__).read_bytes()),
        "sources": receipts,
        "counts": {
            "collected": sum(s["collectionStatus"] == "collected" for s in receipts),
            "failed": sum(s["collectionStatus"] == "failed" for s in receipts),
            "excluded": sum(s["collectionStatus"] == "excluded" for s in receipts),
            "castRecords": len(records),
            "articles": len(articles),
            "transcriptCandidates": len(candidates),
            "evidenceCheckedFacts": len(facts),
            "expectedFactAnnotations": len(annotations),
            "trainingApproved": 0,
        },
        "characterCoverage": {
            key: sum(r["characterId"] == key for r in records) for key in ALIASES
        },
        "factCharacterCoverage": {
            key: sum(key in r["characterIds"] for r in facts) for key in ALIASES
        },
        "missingFactIds": [
            a["id"] for a in annotations if a["id"] not in {f["id"] for f in facts}
        ],
        "coverageGaps": catalog.get("explicitCoverageGaps", []),
        "interpretation": "Fetched official summaries and candidate transcripts, not all-series complete plots or approved dialogues.",
    }
    save_json(output / "manifest.json", report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "source-catalog.json",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument(
        "--annotations",
        type=Path,
        help="Private reviewed annotations; defaults to OUTPUT/annotations.json",
    )
    args = parser.parse_args()
    report = collect(args.catalog, args.output, args.refresh, args.annotations)
    print(json.dumps(report["counts"], ensure_ascii=False))
    if report["counts"]["failed"] or report["missingFactIds"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
