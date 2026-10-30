import http.client
import io
import json
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from kiryu_ai.ocr import (
    SameHostRedirect,
    VisionWorker,
    append_jsonl,
    download,
    fetch_image,
    ocr,
    prepare_backlog,
    read_jsonl,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"synthetic fixture only"


def backlog(path, count=8, host="images.example.org", duplicate=False):
    rows = [
        {
            "source_id": f"source-{i}",
            "source_url": f"https://source.example.org/{i}",
            "index": i,
            "url": f"https://{host}/{0 if duplicate else i}.png",
            "alt": "",
            "training_eligible": False,
        }
        for i in range(count)
    ]
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    return rows


class Response(io.BytesIO):
    def __init__(self, content, content_type="image/png", length=None):
        super().__init__(content)
        self.status = 200
        self.headers = {"Content-Type": content_type}
        if length is not None:
            self.headers["Content-Length"] = str(length)

    def geturl(self):
        return "https://images.example.org/0.png"


class Worker:
    def __init__(self, status="success"):
        self.calls = []
        self.closed = False
        self.status = status

    def recognize(self, path, image_hash):
        self.calls.append((path, image_hash))
        return {
            "image_sha256": image_hash,
            "status": self.status,
            "observations": [
                {"text": "SKIP", "candidates": [{"text": "SKIP", "confidence": 1}]}
            ],
            "frame_count": 1,
            "training_eligible": True,
            "speaker_id": "guessed",
        }

    def close(self):
        self.closed = True


class OCRTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.input = self.base / "input.jsonl"
        self.output = self.base / "output"
        self.binary = self.base / "fake-worker"
        self.binary.write_text("offline test")

    def successful(self, item, output, **kwargs):
        return fetch_image(item, output, **kwargs, opener=lambda *a, **k: Response(PNG))

    def test_exact_url_dedup_retains_all_source_records_and_order(self):
        original = backlog(self.input, duplicate=True)
        items = prepare_backlog(self.input, self.output)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["referer"], original[0]["source_url"])
        links = read_jsonl(self.output / "source-links.jsonl")
        self.assertEqual([x["source_record"] for x in links], original)
        self.assertEqual([x["backlog_ordinal"] for x in links], list(range(8)))

    def test_changed_backlog_cannot_silently_reuse_receipts(self):
        backlog(self.input)
        prepare_backlog(self.input, self.output)
        backlog(self.input, count=9)
        with self.assertRaisesRegex(ValueError, "backlog changed"):
            prepare_backlog(self.input, self.output)

    def test_observed_url_and_source_referer_sent_without_rewriting(self):
        backlog(self.input, count=1)
        item = prepare_backlog(self.input, self.output)[0]
        calls = []

        def opener(request, timeout):
            calls.append((request.full_url, request.get_header("Referer"), timeout))
            return Response(PNG)

        result = fetch_image(
            item, self.output, timeout=20, max_bytes=1000, opener=opener
        )
        self.assertEqual(result["status"], "success")
        self.assertEqual(calls, [(item["url"], item["referer"], 20)])
        self.assertEqual((self.output / result["image_path"]).read_bytes(), PNG)

    def test_magic_rejects_html_even_with_image_content_type(self):
        backlog(self.input, count=1)
        item = prepare_backlog(self.input, self.output)[0]
        result = fetch_image(
            item,
            self.output,
            timeout=20,
            max_bytes=1000,
            opener=lambda *a, **k: Response(b"<html>challenge</html>"),
        )
        self.assertEqual(result["error"], "non_image")
        self.assertEqual(list((self.output / "images").iterdir()), [])
        self.assertEqual(list((self.output / "tmp").iterdir()), [])

    def test_size_limit_covers_declared_and_streamed_bytes(self):
        backlog(self.input, count=1)
        item = prepare_backlog(self.input, self.output)[0]
        for length in (None, 1000):
            with self.subTest(content_length=length):
                result = fetch_image(
                    item,
                    self.output,
                    timeout=20,
                    max_bytes=10,
                    opener=lambda *a, bound_length=length, **k: Response(
                        PNG, length=bound_length
                    ),
                )
                self.assertEqual(result["error"], "too_large")
                self.assertEqual(list((self.output / "tmp").iterdir()), [])

    def test_access_denial_stops_host_and_requires_explicit_host_retry(self):
        backlog(self.input)
        calls = []

        def denied(item, output, **kwargs):
            calls.append(item)
            return {**item, "status": "failed", "http_status": 403, "error": "http_403"}

        report = download(
            self.input, self.output, workers=1, per_host=1, fetcher=denied
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(report["run_counts"]["host_stopped"], 7)
        download(self.input, self.output, retry_failures=True, fetcher=denied)
        self.assertEqual(len(calls), 1)
        download(
            self.input,
            self.output,
            workers=1,
            per_host=1,
            retry_failures=True,
            retry_stopped_hosts=("images.example.org",),
            fetcher=self.successful,
        )
        self.assertEqual(len(read_jsonl(self.output / "download-receipts.jsonl")), 9)

    def test_three_5xx_or_nonimage_responses_stop_host(self):
        for status in (503, 200):
            with self.subTest(status=status):
                self.output = self.base / str(status)
                backlog(self.input)
                calls = []

                def rejected(item, output, calls=calls, status=status, **kwargs):
                    calls.append(item)
                    return {
                        **item,
                        "status": "failed",
                        "http_status": status,
                        "error": "non_image" if status == 200 else "http_503",
                    }

                report = download(
                    self.input, self.output, workers=1, per_host=1, fetcher=rejected
                )
                self.assertEqual(len(calls), 3)
                self.assertEqual(report["run_counts"]["host_stopped"], 5)

    def test_success_resets_transient_failure_streak(self):
        backlog(self.input, count=5)
        count = 0

        def mixed(item, output, **kwargs):
            nonlocal count
            count += 1
            if count == 3:
                return self.successful(item, output, **kwargs)
            return {**item, "status": "failed", "http_status": 503}

        report = download(self.input, self.output, workers=1, per_host=1, fetcher=mixed)
        self.assertEqual(count, 5)
        self.assertEqual(report["stopped_hosts"], {})

    def test_success_resume_hashes_and_redownloads_corrupt_content(self):
        backlog(self.input, count=2)
        download(self.input, self.output, fetcher=self.successful)
        report = download(self.input, self.output, fetcher=self.successful)
        self.assertEqual(report["run_counts"], {"reused_success": 2})
        image = next((self.output / "images").iterdir())
        image.write_bytes(b"corrupt cached file")
        report = download(self.input, self.output, workers=1, fetcher=self.successful)
        self.assertEqual(report["run_counts"]["success"], 2)
        self.assertEqual(len(list((self.output / "images").iterdir())), 1)

    def test_failures_can_be_retried_and_are_not_permanently_dropped(self):
        backlog(self.input, count=1)
        item = prepare_backlog(self.input, self.output)[0]
        append_jsonl(
            self.output / "download-receipts.jsonl",
            {**item, "status": "failed", "error": "timeout"},
        )
        report = download(self.input, self.output, fetcher=self.successful)
        self.assertEqual(
            report["run_counts"]["previous_failure_needs_explicit_retry"], 1
        )
        report = download(
            self.input, self.output, retry_failures=True, fetcher=self.successful
        )
        self.assertEqual(report["run_counts"]["success"], 1)

    def test_cross_host_and_https_downgrade_redirects_require_review(self):
        handler = SameHostRedirect()
        req = urllib.request.Request("https://images.example.org/a")
        for destination in (
            "https://other.example.org/a",
            "http://images.example.org/a",
        ):
            with self.assertRaises(urllib.error.HTTPError):
                handler.redirect_request(req, None, 302, "Found", {}, destination)

    def test_ocr_dedup_resume_and_unapproved_source_linkage(self):
        original = backlog(self.input, count=3)
        download(self.input, self.output, fetcher=self.successful)
        worker = Worker()
        report = ocr(self.output, self.binary, worker=worker)
        self.assertEqual(len(worker.calls), 1)
        self.assertTrue(worker.closed)
        self.assertEqual(report["observation_count"], 1)
        self.assertNotIn("dialogue_count", report)
        results = read_jsonl(self.output / "ocr-v1" / "ocr-results.jsonl")
        self.assertFalse(results[0]["training_eligible"])
        self.assertIsNone(results[0]["speaker_id"])
        links = read_jsonl(self.output / "ocr-v1" / "ocr-source-links.jsonl")
        self.assertEqual([x["source_record"] for x in links], original)
        self.assertTrue(
            all(x["speaker_id"] is None and not x["training_eligible"] for x in links)
        )
        again = Worker()
        report = ocr(self.output, self.binary, worker=again)
        self.assertEqual(again.calls, [])
        self.assertEqual(report["run_counts"], {"reused_success": 1})

    def test_ocr_resume_picks_up_newly_appended_download_receipts(self):
        backlog(self.input, count=2)
        download(self.input, self.output, limit=1, fetcher=self.successful)
        ocr(self.output, self.binary, worker=Worker())

        def second(item, output, **kwargs):
            return fetch_image(
                item, output, **kwargs, opener=lambda *a, **k: Response(PNG + b"second")
            )

        download(self.input, self.output, fetcher=second)
        worker = Worker()
        report = ocr(self.output, self.binary, worker=worker)
        self.assertEqual(len(worker.calls), 1)
        self.assertEqual(report["result_status_counts"], {"success": 2})

    def test_changed_ocr_binary_cannot_silently_mix_engine_results(self):
        backlog(self.input, count=1)
        download(self.input, self.output, fetcher=self.successful)
        ocr(self.output, self.binary, worker=Worker())
        self.binary.write_text("different engine")
        with self.assertRaisesRegex(ValueError, "binary_sha256 changed"):
            ocr(self.output, self.binary, worker=Worker())

    def test_ocr_failure_has_explicit_retry_and_no_training_approval(self):
        backlog(self.input, count=1)
        download(self.input, self.output, fetcher=self.successful)
        ocr(self.output, self.binary, worker=Worker("failed"))
        worker = Worker()
        report = ocr(self.output, self.binary, worker=worker)
        self.assertEqual(worker.calls, [])
        self.assertEqual(
            report["run_counts"]["previous_failure_needs_explicit_retry"], 1
        )
        report = ocr(self.output, self.binary, worker=worker, retry_failures=True)
        self.assertEqual(report["result_status_counts"], {"success": 1})

    def test_ocr_checks_downloaded_file_hash_before_engine(self):
        backlog(self.input, count=1)
        download(self.input, self.output, fetcher=self.successful)
        next((self.output / "images").iterdir()).write_bytes(b"tampered")
        worker = Worker()
        report = ocr(self.output, self.binary, worker=worker)
        self.assertEqual(worker.calls, [])
        self.assertEqual(report["result_status_counts"], {"failed": 1})
        self.assertFalse(report["training_eligible"])

    def test_append_logs_ignore_inflight_tail_and_repair_interrupted_write(self):
        path = self.base / "receipts.jsonl"
        path.write_bytes(b'{"complete":true}\n{"incomplete":')
        self.assertEqual(read_jsonl(path, append_log=True), [{"complete": True}])
        append_jsonl(path, {"new": True})
        self.assertEqual(read_jsonl(path), [{"complete": True}, {"new": True}])

    def test_truncated_http_body_is_a_failure_receipt_and_cleans_partial_file(self):
        class TruncatedResponse(Response):
            def read(self, size=-1):
                raise http.client.IncompleteRead(b"partial", 50)

        backlog(self.input, count=1)
        item = prepare_backlog(self.input, self.output)[0]
        result = fetch_image(
            item,
            self.output,
            timeout=20,
            max_bytes=1000,
            opener=lambda *a, **k: TruncatedResponse(PNG),
        )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"], "transport_or_validation_error")
        self.assertIn("IncompleteRead", result["error_detail"])
        self.assertEqual(list((self.output / "tmp").iterdir()), [])
        self.assertEqual(list((self.output / "images").iterdir()), [])

    def test_silent_truncated_http_body_cannot_become_a_success_receipt(self):
        backlog(self.input, count=1)
        item = prepare_backlog(self.input, self.output)[0]
        result = fetch_image(
            item,
            self.output,
            timeout=20,
            max_bytes=1000,
            opener=lambda *a, **k: Response(PNG, length=len(PNG) + 50),
        )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"], "content_length_mismatch")
        self.assertEqual(list((self.output / "tmp").iterdir()), [])
        self.assertEqual(list((self.output / "images").iterdir()), [])

    def test_partial_worker_json_cannot_escape_per_image_timeout(self):
        self.binary.write_text(
            "#!" + sys.executable + "\n"
            "import sys, time\n"
            "sys.stdin.readline()\n"
            "sys.stdout.write('{')\n"
            "sys.stdout.flush()\n"
            "time.sleep(30)\n"
        )
        self.binary.chmod(0o755)
        worker = VisionWorker(self.binary, timeout=0.15)
        self.addCleanup(worker.close)
        started = time.monotonic()
        result = worker.recognize(self.base / "unused.png", "synthetic-sha")
        elapsed = time.monotonic() - started
        self.assertEqual(result["status"], "failed")
        self.assertIn("per-image timeout", result["error"])
        self.assertLess(elapsed, 3)
        self.assertIsNone(worker.process)

    def test_worker_accumulates_fragmented_json_until_complete(self):
        self.binary.write_text(
            "#!" + sys.executable + "\n"
            "import json, sys, time\n"
            "for line in sys.stdin:\n"
            "    request = json.loads(line)\n"
            "    response = json.dumps({'status': 'success', 'image_sha256': request['image_sha256']}) + '\\n'\n"
            "    sys.stdout.write(response[:5]); sys.stdout.flush()\n"
            "    time.sleep(0.02)\n"
            "    sys.stdout.write(response[5:]); sys.stdout.flush()\n"
        )
        self.binary.chmod(0o755)
        # This case checks fragmented JSON, not Python process startup latency.
        # The separate partial-response test enforces the short timeout path.
        worker = VisionWorker(self.binary, timeout=5)
        self.addCleanup(worker.close)
        for value in ("first", "second"):
            result = worker.recognize(self.base / "unused.png", value)
            self.assertEqual(result, {"status": "success", "image_sha256": value})

    def test_url_credentials_and_non_http_scheme_are_rejected(self):
        for url in ("file:///private/data", "https://secret:pass@images.example.org/a"):
            row = backlog(self.input, count=1)[0]
            row["url"] = url
            self.input.write_text(json.dumps(row) + "\n")
            with self.assertRaises(ValueError):
                prepare_backlog(self.input, self.output)


if __name__ == "__main__":
    unittest.main()
