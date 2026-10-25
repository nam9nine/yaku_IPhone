"""Resumable image acquisition and unapproved OCR with exact source linkage.

Only URLs already observed in the supplied backlog are fetched. Access denials
stop a host; neither mirrors, credential changes nor challenge bypasses are used.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import selectors
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict, deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import UTC, datetime
from pathlib import Path

SCHEMA = 1


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def now() -> str:
    return datetime.now(UTC).isoformat()


def read_jsonl(path: Path, *, append_log: bool = False) -> list[dict]:
    if not path.exists():
        return []
    data = path.read_bytes()
    if append_log and data and not data.endswith(b"\n"):
        # A writer may currently be flushing its last record, or was interrupted.
        data = data[: data.rfind(b"\n") + 1]
    rows = []
    for line_no, line in enumerate(data.decode("utf-8").splitlines(), 1):
        if line.strip():
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid JSONL {path}:{line_no}") from exc
            if not isinstance(row, dict):
                raise ValueError(f"expected object {path}:{line_no}")
            rows.append(row)
    return rows


def write_json(path: Path, value: object) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temp.replace(path)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    temp.replace(path)


def append_jsonl(path: Path, row: dict) -> None:
    # The owning CLI is the only writer to this log. Repair a partial last line
    # after an interrupted write before appending a complete new record.
    with path.open("a+b") as stream:
        stream.seek(0, os.SEEK_END)
        if stream.tell():
            stream.seek(-1, os.SEEK_END)
            if stream.read(1) != b"\n":
                stream.seek(0)
                data = stream.read()
                stream.truncate(data.rfind(b"\n") + 1)
        stream.write((json.dumps(row, ensure_ascii=False) + "\n").encode())
        stream.flush()
        os.fsync(stream.fileno())


def checked_url(url: str) -> urllib.parse.SplitResult:
    parsed = urllib.parse.urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or any(c in url for c in "\r\n\x00")
    ):
        raise ValueError("expected observed HTTP(S) URL without credentials")
    return parsed


def prepare_backlog(backlog: Path, output: Path) -> list[dict]:
    rows = read_jsonl(backlog)
    if not rows:
        raise ValueError("backlog is empty")
    existing = output / "download-manifest.json"
    backlog_hash = file_digest(backlog)
    if existing.exists():
        prior = json.loads(existing.read_text())
        if prior["backlog_sha256"] != backlog_hash:
            raise ValueError("backlog changed; use a separate output directory")
    unique = {}
    linkage = []
    for ordinal, row in enumerate(rows):
        for key in ("source_id", "source_url", "url"):
            if not isinstance(row.get(key), str) or not row[key]:
                raise ValueError(f"backlog row {ordinal}: missing {key}")
        parsed = checked_url(row["url"])
        checked_url(row["source_url"])
        url_hash = digest(row["url"].encode())
        unique.setdefault(
            row["url"],
            {
                "url": row["url"],
                "url_sha256": url_hash,
                "host": parsed.hostname,
                "referer": row["source_url"],
            },
        )
        linkage.append(
            {"backlog_ordinal": ordinal, "url_sha256": url_hash, "source_record": row}
        )
    output.mkdir(parents=True, exist_ok=True)
    (output / "images").mkdir(exist_ok=True)
    (output / "tmp").mkdir(exist_ok=True)
    write_jsonl(output / "source-links.jsonl", linkage)
    if not existing.exists():
        write_json(
            existing,
            {
                "schema_version": SCHEMA,
                "created_at": now(),
                "backlog_path": str(backlog.resolve()),
                "backlog_sha256": backlog_hash,
                "source_link_count": len(rows),
                "unique_url_count": len(unique),
                "training_eligible": False,
            },
        )
    return list(unique.values())


class SameHostRedirect(urllib.request.HTTPRedirectHandler):
    """Do not silently turn redirects into new unobserved host acquisition."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        before, after = checked_url(req.full_url), checked_url(newurl)
        if before.hostname != after.hostname or (
            before.scheme == "https" and after.scheme != "https"
        ):
            raise urllib.error.HTTPError(
                req.full_url,
                code,
                "cross-host/downgrade redirect requires review",
                headers,
                fp,
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def image_kind(head: bytes) -> str | None:
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head.startswith((b"II*\x00", b"MM\x00*")):
        return "tiff"
    if head.startswith(b"BM"):
        return "bmp"
    if head[4:8] == b"ftyp" and head[8:12] in {
        b"heic",
        b"heix",
        b"hevc",
        b"hevx",
        b"mif1",
        b"avif",
        b"avis",
    }:
        return "heif"
    return None


def fetch_image(
    item: dict, output: Path, *, timeout: float, max_bytes: int, opener=None
) -> dict:
    started = time.monotonic()
    result = {
        **item,
        "schema_version": SCHEMA,
        "attempted_at": now(),
        "status": "failed",
        "training_eligible": False,
    }
    temp_path = None
    try:
        request = urllib.request.Request(
            item["url"],
            headers={
                "User-Agent": "yaku-IPhone-corpus-image-acquisition/1.0",
                "Referer": item["referer"],
                "Accept": "image/*",
            },
        )
        open_url = opener or urllib.request.build_opener(SameHostRedirect()).open
        with open_url(request, timeout=timeout) as response:
            result["http_status"] = response.status
            result["final_url"] = response.geturl()
            content_type = response.headers.get("Content-Type", "")
            result["content_type"] = content_type
            declared = response.headers.get("Content-Length")
            if declared and int(declared) > max_bytes:
                result["error"] = "too_large"
                return result
            with tempfile.NamedTemporaryFile(
                dir=output / "tmp", delete=False
            ) as stream:
                temp_path = Path(stream.name)
                h = hashlib.sha256()
                size = 0
                head = b""
                while True:
                    chunk = response.read(min(65536, max_bytes + 1 - size))
                    if not chunk:
                        break
                    head = (head + chunk)[:32]
                    size += len(chunk)
                    if size > max_bytes:
                        result["error"] = "too_large"
                        return result
                    h.update(chunk)
                    stream.write(chunk)
            if declared is not None and size != int(declared):
                result["error"] = "content_length_mismatch"
                result["received_byte_count"] = size
                return result
            kind = image_kind(head)
            if not kind:
                result["error"] = "non_image"
                return result
            content_hash = h.hexdigest()
            relative = f"images/{content_hash}.img"
            target = output / relative
            if not target.exists() or file_digest(target) != content_hash:
                # The newly downloaded bytes repair a corrupt generated cache.
                temp_path.replace(target)
            result.update(
                status="success",
                image_sha256=content_hash,
                image_path=relative,
                byte_count=size,
                image_kind=kind,
            )
    except urllib.error.HTTPError as exc:
        result.update(http_status=exc.code, error=f"http_{exc.code}")
    except (OSError, ValueError, http.client.HTTPException) as exc:
        result.update(
            error="transport_or_validation_error", error_detail=str(exc)[:500]
        )
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        result["elapsed_seconds"] = round(time.monotonic() - started, 6)
    return result


def download(
    backlog: Path,
    output: Path,
    *,
    limit: int | None = None,
    workers: int = 4,
    per_host: int = 2,
    timeout: float = 20,
    max_bytes: int = 20 * 1024 * 1024,
    retry_failures: bool = False,
    retry_stopped_hosts: tuple[str, ...] = (),
    fetcher=fetch_image,
) -> dict:
    if (
        not 1 <= workers <= 4
        or not 1 <= per_host <= 2
        or timeout <= 0
        or max_bytes <= 0
    ):
        raise ValueError("workers <= 4, per_host <= 2 and positive limits required")
    if limit is not None and limit < 1:
        raise ValueError("limit must be positive")
    items = prepare_backlog(backlog, output)
    selected = items[:limit] if limit is not None else items
    receipts_path = output / "download-receipts.jsonl"
    receipts = read_jsonl(receipts_path, append_log=True)
    latest = {r["url_sha256"]: r for r in receipts}
    stopped = {
        r["host"]: r["host_stop_reason"] for r in receipts if r.get("host_stop_reason")
    }
    for host in retry_stopped_hosts:
        if not retry_failures:
            raise ValueError("--retry-stopped-host also requires --retry-failures")
        stopped.pop(host, None)
    queues = defaultdict(deque)
    summary = Counter()
    for item in selected:
        previous = latest.get(item["url_sha256"])
        if previous and previous["status"] == "success":
            path = output / previous["image_path"]
            if path.exists() and file_digest(path) == previous["image_sha256"]:
                summary["reused_success"] += 1
                continue
        elif previous and not retry_failures:
            summary["previous_failure_needs_explicit_retry"] += 1
            continue
        if item["host"] in stopped:
            summary["host_stopped"] += 1
            continue
        queues[item["host"]].append(item)
    active = Counter()
    strikes = Counter()
    pending = {}
    hosts = deque(queues)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        while hosts or pending:
            # Round-robin hosts; at most two requests per host and four globally.
            for _ in range(len(hosts)):
                host = hosts.popleft()
                if host in stopped:
                    summary["host_stopped"] += len(queues[host])
                    queues[host].clear()
                while (
                    queues[host] and active[host] < per_host and len(pending) < workers
                ):
                    item = queues[host].popleft()
                    future = pool.submit(
                        fetcher, item, output, timeout=timeout, max_bytes=max_bytes
                    )
                    pending[future] = host
                    active[host] += 1
                if queues[host]:
                    hosts.append(host)
            if not pending:
                continue
            done, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in done:
                host = pending.pop(future)
                active[host] -= 1
                receipt = future.result()
                code = receipt.get("http_status", 0)
                if code in {401, 403, 429}:
                    stopped[host] = f"access_restriction_http_{code}"
                elif code >= 500 or receipt.get("error") == "non_image":
                    strikes[host] += 1
                    if strikes[host] >= 3:
                        stopped[host] = "three_repeated_5xx_or_non_image_responses"
                elif receipt["status"] == "success":
                    strikes[host] = 0
                if host in stopped:
                    receipt["host_stop_reason"] = stopped[host]
                append_jsonl(receipts_path, receipt)
                latest[receipt["url_sha256"]] = receipt
                summary[receipt["status"]] += 1
                completed = summary["success"] + summary["failed"]
                if completed % 25 == 0:
                    print(
                        json.dumps(
                            {"download_progress": dict(summary)}, ensure_ascii=False
                        ),
                        flush=True,
                    )
    report = {
        "schema_version": SCHEMA,
        "completed_at": now(),
        "backlog_sha256": file_digest(backlog),
        "code_sha256": file_digest(Path(__file__)),
        "selected_urls": len(selected),
        "total_urls": len(items),
        "run_counts": dict(summary),
        "stopped_hosts": stopped,
        "receipt_status_counts": dict(Counter(r["status"] for r in latest.values())),
        "unique_successful_images": len(
            {r["image_sha256"] for r in latest.values() if r["status"] == "success"}
        ),
        "configuration": {
            "workers": workers,
            "per_host": per_host,
            "timeout_seconds": timeout,
            "max_bytes": max_bytes,
            "retry_failures": retry_failures,
            "retry_stopped_hosts": list(retry_stopped_hosts),
        },
        "training_eligible": False,
    }
    write_json(output / "download-report.json", report)
    return report


class VisionWorker:
    """One owned subprocess, one request at a time, bounded wait per image."""

    def __init__(self, binary: Path, timeout: float = 90):
        self.binary = binary.resolve()
        self.timeout = timeout
        self.process = None
        self.buffer = b""

    def close(self, *, terminate: bool = False) -> None:
        if self.process is not None:
            if terminate and self.process.poll() is None:
                self.process.terminate()
            if self.process.stdin:
                try:
                    self.process.stdin.close()
                except OSError:
                    pass
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            if self.process.stdout:
                self.process.stdout.close()
            self.process = None
            self.buffer = b""

    def recognize(self, image_path: Path, image_sha256: str) -> dict:
        if self.process is None or self.process.poll() is not None:
            self.close()
            self.process = subprocess.Popen(
                [str(self.binary)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=None,
                bufsize=0,
            )
            os.set_blocking(self.process.stdout.fileno(), False)
        payload = {
            "image_path": str(image_path.resolve()),
            "image_sha256": image_sha256,
        }
        try:
            self.process.stdin.write((json.dumps(payload) + "\n").encode())
            self.process.stdin.flush()
            deadline = time.monotonic() + self.timeout
            with selectors.DefaultSelector() as selector:
                selector.register(self.process.stdout, selectors.EVENT_READ)
                while b"\n" not in self.buffer:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not selector.select(remaining):
                        raise TimeoutError("Vision worker exceeded per-image timeout")
                    try:
                        chunk = os.read(self.process.stdout.fileno(), 65536)
                    except BlockingIOError:
                        continue
                    if not chunk:
                        raise RuntimeError(
                            "Vision worker ended before completing an observation"
                        )
                    self.buffer += chunk
                    if len(self.buffer) > 32 * 1024 * 1024:
                        raise ValueError("Vision worker response exceeds 32 MiB")
            line, self.buffer = self.buffer.split(b"\n", 1)
            result = json.loads(line)
            if not isinstance(result, dict):
                raise TypeError("Vision worker response must be an object")
            if result.get("image_sha256") != image_sha256:
                raise ValueError("Vision worker response image SHA mismatch")
            if result.get("status") not in {"success", "failed"}:
                raise ValueError("invalid Vision worker status")
            return result
        except (OSError, ValueError, TypeError, RuntimeError, TimeoutError) as exc:
            self.close(terminate=True)
            return {
                "image_sha256": image_sha256,
                "status": "failed",
                "error": str(exc),
                "training_eligible": False,
            }


def link_ocr(
    output: Path, result_dir: Path, downloads: dict, results: dict
) -> list[dict]:
    linked = []
    for source in read_jsonl(output / "source-links.jsonl"):
        receipt = downloads.get(source["url_sha256"], {})
        image_hash = (
            receipt.get("image_sha256") if receipt.get("status") == "success" else None
        )
        recognized = results.get(image_hash, {})
        linked.append(
            {
                **source,
                "image_sha256": image_hash,
                "download_status": receipt.get("status", "not_attempted"),
                "ocr_status": recognized.get("status", "not_attempted"),
                "ocr_result_key": image_hash if recognized else None,
                "speaker_id": None,
                "review_status": "unreviewed",
                "training_eligible": False,
                "hold_reasons": [
                    "ocr_not_human_verified",
                    "speaker_and_scene_unverified",
                ],
            }
        )
    write_jsonl(result_dir / "ocr-source-links.jsonl", linked)
    return linked


def ocr(
    output: Path,
    binary: Path,
    *,
    limit: int | None = None,
    result_dir: Path | None = None,
    retry_failures: bool = False,
    timeout: float = 90,
    max_consecutive_failures: int = 3,
    worker=None,
) -> dict:
    if limit is not None and limit < 1:
        raise ValueError("limit must be positive")
    if timeout <= 0 or max_consecutive_failures < 1:
        raise ValueError("positive timeout and failure limit required")
    result_dir = result_dir or output / "ocr-v1"
    result_dir.mkdir(parents=True, exist_ok=True)
    downloads = {
        r["url_sha256"]: r
        for r in read_jsonl(output / "download-receipts.jsonl", append_log=True)
    }
    if not downloads:
        raise ValueError("no download receipts")
    binary_hash = file_digest(binary)
    swift_source = Path(__file__).resolve().parents[1] / "tools" / "vision_ocr.swift"
    manifest = {
        "schema_version": SCHEMA,
        "binary_sha256": binary_hash,
        "swift_source_sha256": file_digest(swift_source),
        "python_code_sha256": file_digest(Path(__file__)),
        "backlog_sha256": json.loads((output / "download-manifest.json").read_text())[
            "backlog_sha256"
        ],
        "languages": ["ko-KR", "en-US"],
        "revision": 3,
        "recognition_level": "accurate",
        "uses_language_correction": False,
        "training_eligible": False,
    }
    manifest_path = result_dir / "ocr-manifest.json"
    if manifest_path.exists():
        prior = json.loads(manifest_path.read_text())
        for field in ("binary_sha256", "swift_source_sha256", "backlog_sha256"):
            if prior[field] != manifest[field]:
                raise ValueError(f"OCR {field} changed; use another --result-dir")
    else:
        write_json(manifest_path, {**manifest, "created_at": now()})
    receipts_path = result_dir / "ocr-results.jsonl"
    results = {r["image_sha256"]: r for r in read_jsonl(receipts_path, append_log=True)}
    images = {}
    for receipt in downloads.values():
        if receipt["status"] == "success":
            images.setdefault(receipt["image_sha256"], receipt)
    selected = (
        sorted(images.items())[:limit] if limit is not None else sorted(images.items())
    )
    summary = Counter()
    recognizer = worker or VisionWorker(binary, timeout)
    consecutive_failures = 0
    stopped_reason = None
    try:
        for image_hash, receipt in selected:
            previous = results.get(image_hash)
            if previous and previous["status"] == "success":
                summary["reused_success"] += 1
                continue
            if previous and not retry_failures:
                summary["previous_failure_needs_explicit_retry"] += 1
                continue
            image = output / receipt["image_path"]
            if not image.exists() or file_digest(image) != image_hash:
                result = {
                    "image_sha256": image_hash,
                    "status": "failed",
                    "error": "downloaded image missing or SHA256 mismatch",
                }
            else:
                result = recognizer.recognize(image, image_hash)
            result.update(
                attempted_at=now(),
                binary_sha256=binary_hash,
                training_eligible=False,
                review_status="unreviewed",
                speaker_id=None,
            )
            append_jsonl(receipts_path, result)
            results[image_hash] = result
            summary[result["status"]] += 1
            consecutive_failures = (
                consecutive_failures + 1 if result["status"] == "failed" else 0
            )
            if consecutive_failures >= max_consecutive_failures:
                stopped_reason = f"{max_consecutive_failures} consecutive OCR failures; inspect before explicit retry"
                break
            completed = summary["success"] + summary["failed"]
            if completed % 25 == 0:
                print(
                    json.dumps({"ocr_progress": dict(summary)}, ensure_ascii=False),
                    flush=True,
                )
    finally:
        recognizer.close()
    linked = link_ocr(output, result_dir, downloads, results)
    successful = [r for r in results.values() if r["status"] == "success"]
    report = {
        "schema_version": SCHEMA,
        "completed_at": now(),
        "selected_images": len(selected),
        "python_code_sha256": file_digest(Path(__file__)),
        "download_receipt_snapshot_count": len(downloads),
        "total_unique_downloaded_images": len(images),
        "run_counts": dict(summary),
        "stopped_reason": stopped_reason,
        "result_status_counts": dict(Counter(r["status"] for r in results.values())),
        "source_link_count": len(linked),
        "source_ocr_status_counts": dict(Counter(r["ocr_status"] for r in linked)),
        "observation_count": sum(len(r.get("observations", [])) for r in successful),
        "images_without_text": sum(not r.get("observations") for r in successful),
        "multi_frame_images_first_frame_only": sum(
            r.get("frame_count", 1) > 1 for r in successful
        ),
        "training_eligible": False,
        "limitations": [
            "OCR confidence is not a correctness or speaker approval",
            "No dialogue, speaker, recipient or scene is inferred",
            "Only first frame of multi-frame images is recognized",
        ],
    }
    write_json(result_dir / "ocr-report.json", report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    get = sub.add_parser("download")
    get.add_argument("--input", type=Path, required=True)
    get.add_argument("--output", type=Path, required=True)
    get.add_argument("--limit", type=int)
    get.add_argument("--workers", type=int, default=4)
    get.add_argument("--per-host", type=int, default=2)
    get.add_argument("--timeout", type=float, default=20)
    get.add_argument("--max-bytes", type=int, default=20 * 1024 * 1024)
    get.add_argument("--retry-failures", action="store_true")
    get.add_argument("--retry-stopped-host", action="append", default=[])
    recognize = sub.add_parser("recognize")
    recognize.add_argument(
        "--output", type=Path, required=True, help="download output directory"
    )
    recognize.add_argument("--binary", type=Path, required=True)
    recognize.add_argument("--result-dir", type=Path)
    recognize.add_argument("--limit", type=int)
    recognize.add_argument("--timeout", type=float, default=90)
    recognize.add_argument("--max-consecutive-failures", type=int, default=3)
    recognize.add_argument("--retry-failures", action="store_true")
    args = parser.parse_args()
    if args.command == "download":
        result = download(
            args.input,
            args.output,
            limit=args.limit,
            workers=args.workers,
            per_host=args.per_host,
            timeout=args.timeout,
            max_bytes=args.max_bytes,
            retry_failures=args.retry_failures,
            retry_stopped_hosts=tuple(args.retry_stopped_host),
        )
    else:
        result = ocr(
            args.output,
            args.binary,
            limit=args.limit,
            result_dir=args.result_dir,
            retry_failures=args.retry_failures,
            timeout=args.timeout,
            max_consecutive_failures=args.max_consecutive_failures,
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
