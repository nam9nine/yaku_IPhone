"""Private Web Push subscriptions and a durable, bounded delivery outbox.

Only completed replies from the owning visitor are eligible. Transport retries
are at-least-once; the service worker deduplicates the stable job notification ID.
Push state and VAPID material never enter the chat export or model history.
"""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import os
import re
import socket
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import VapidException
from pywebpush import WebPushException
from requests.exceptions import RequestException

from .chat_db import SESSION_LIFETIME, private_file, timestamp

PUSH_TTL = 3600
MAX_ATTEMPTS = 3
LEASE_SECONDS = 30
VAPID_SUBJECT = "https://nam9nine.github.io"
PROVIDER_HOSTS = {"fcm.googleapis.com", "updates.push.services.mozilla.com"}
TITLES = {"haruka": "하루카", "majima": "마지마"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at REAL NOT NULL,
    expires_at REAL NOT NULL, scan_at TEXT NOT NULL, scan_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS subscriptions_visitor ON subscriptions(visitor_id);
CREATE TABLE IF NOT EXISTS outbox (
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL, not_before REAL NOT NULL, expires_at REAL NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','sending','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL,
    last_error TEXT,
    PRIMARY KEY(subscription_id, job_id)
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(state,next_attempt);
"""


class SubscriptionConflict(ValueError):
    """An endpoint cannot be reassigned to a different anonymous visitor."""


def reply_delay_seconds(request_id):
    """Match the browser's FNV-1a UUID 10–20 second reply delay."""
    value = 2166136261
    for character in request_id:
        value = ((value ^ ord(character)) * 16777619) & 0xFFFFFFFF
    return (10000 + value % 10001) / 1000


def validate_endpoint(endpoint):
    if (
        not isinstance(endpoint, str)
        or not 1 <= len(endpoint) <= 2048
        or not re.fullmatch(r"[\x21-\x7e]+", endpoint)
        or "\\" in endpoint
    ):
        raise ValueError("Invalid push endpoint")
    try:
        parsed = urlsplit(endpoint)
        host = parsed.hostname or ""
        provider = host in PROVIDER_HOSTS or (
            host.endswith(".push.apple.com")
            and re.fullmatch(r"[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?", host)
        )
        valid = (
            parsed.scheme == "https"
            and provider
            and parsed.port in (None, 443)
            and not parsed.username
            and not parsed.password
            and not parsed.fragment
            and parsed.netloc in {host, host + ":443"}
            and parsed.path.startswith("/")
            and len(parsed.path) > 1
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("Unsupported push endpoint")
    return endpoint


def _decode_key(value, length):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", value):
        raise ValueError("Invalid push key")
    if len(value) > 128:
        raise ValueError("Invalid push key")
    try:
        raw = base64.b64decode(
            value + "=" * (-len(value) % 4), altchars=b"-_", validate=True
        )
    except ValueError:
        raise ValueError("Invalid push key") from None
    if len(raw) != length:
        raise ValueError("Invalid push key")
    return raw


def validate_subscription(subscription):
    if not isinstance(subscription, dict) or set(subscription) - {
        "endpoint",
        "keys",
        "expirationTime",
    }:
        raise ValueError("Invalid push subscription")
    endpoint = validate_endpoint(subscription.get("endpoint"))
    keys = subscription.get("keys")
    if not isinstance(keys, dict) or set(keys) != {"p256dh", "auth"}:
        raise ValueError("Invalid push keys")
    public = _decode_key(keys["p256dh"], 65)
    _decode_key(keys["auth"], 16)
    if public[0] != 4:
        raise ValueError("Invalid push public key")
    ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public)
    return {"endpoint": endpoint, "keys": dict(keys)}


def _vapid_key(path):
    """Create once, without a readable permission window or symlink traversal."""
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Indirect VAPID key path")
    if not path.exists():
        private = ec.generate_private_key(ec.SECP256R1())
        pem = private.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        try:
            descriptor = os.open(
                path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
            )
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, "wb") as output:
                output.write(pem)
                output.flush()
                os.fsync(output.fileno())
    if (
        path.is_symlink()
        or not path.is_file()
        or path.stat().st_mode & 0o077
        or path.stat().st_size > 4096
    ):
        raise ValueError("A private VAPID key is required")
    private = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(private, ec.EllipticCurvePrivateKey) or not isinstance(
        private.curve, ec.SECP256R1
    ):
        raise TypeError("Invalid VAPID key type")
    public = private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return base64.urlsafe_b64encode(public).rstrip(b"=").decode("ascii")


def send_webpush(subscription, payload, private_key, ttl):
    """Encrypt for one browser and post only to its allowed public push service."""
    import requests
    from pywebpush import webpush

    validate_subscription(subscription)
    host = urlsplit(subscription["endpoint"]).hostname
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(
        not ipaddress.ip_address(row[4][0]).is_global for row in addresses
    ):
        raise ValueError("Push service resolved to a nonpublic address")

    class ProviderSession(requests.Session):
        def request(self, method, url, **kwargs):
            validate_endpoint(url)
            kwargs["allow_redirects"] = False
            kwargs["stream"] = True
            response = super().request(method, url, **kwargs)
            # Only status is needed. Do not download/log an unbounded provider
            # diagnostic body, which may also echo endpoint credentials.
            response.close()
            response._content = b""
            response._content_consumed = True
            return response

    headers = {"Urgency": "normal"}
    notification_id = payload.get("notification_id")
    if isinstance(notification_id, str):
        # Provider-side coalescing reduces retries still waiting at the provider.
        # Device-side ID dedupe remains necessary for a delivered/crashed send.
        headers["Topic"] = hashlib.sha256(notification_id.encode()).hexdigest()[:32]
    with ProviderSession() as session:
        session.trust_env = False
        return webpush(
            subscription_info=subscription,
            data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            vapid_private_key=str(private_key),
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=ttl,
            timeout=(3, 5),
            requests_session=session,
            headers=headers,
        )


class ChatPush:
    def __init__(self, directory, chat_db, *, sender=None, clock=time.time):
        self.root = Path(directory)
        if self.root.is_symlink():
            raise ValueError("Indirect push state directory")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root.chmod(0o700)
        self.path = self.root / "push.sqlite3"
        private_file(self.path)
        self.key_path = self.root / "vapid-private.pem"
        self.public_key = _vapid_key(self.key_path)
        self.chat_db = chat_db
        self.sender = sender or send_webpush
        self.clock = clock
        with self.connection() as connection:
            connection.executescript(SCHEMA)

    @contextmanager
    def connection(self):
        if self.path.is_symlink():
            raise ValueError("Indirect push database path")
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA synchronous=FULL")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def subscribe(self, visitor, subscription):
        info = validate_subscription(subscription)
        now = self.clock()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT * FROM subscriptions WHERE endpoint=?", (info["endpoint"],)
            ).fetchone()
            if existing and existing["visitor_id"] != visitor:
                raise SubscriptionConflict("Push endpoint belongs to another session")
            if (
                existing
                and existing["p256dh"] == info["keys"]["p256dh"]
                and existing["auth"] == info["keys"]["auth"]
            ):
                connection.execute(
                    "UPDATE subscriptions SET expires_at=? WHERE id=?",
                    (now + SESSION_LIFETIME, existing["id"]),
                )
                return existing["id"]
            if existing:
                connection.execute(
                    "DELETE FROM subscriptions WHERE id=?", (existing["id"],)
                )
            count = connection.execute(
                "SELECT count(*) FROM subscriptions WHERE visitor_id=?", (visitor,)
            ).fetchone()[0]
            if count >= 4:
                raise ValueError("Too many push subscriptions")
            identifier = uuid4().hex
            connection.execute(
                "INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    identifier,
                    visitor,
                    info["endpoint"],
                    info["keys"]["p256dh"],
                    info["keys"]["auth"],
                    now,
                    now + SESSION_LIFETIME,
                    timestamp(now),
                    "",
                ),
            )
            return identifier

    def unsubscribe(self, visitor, endpoint):
        validate_endpoint(endpoint)
        with self.connection() as connection:
            connection.execute(
                "DELETE FROM subscriptions WHERE visitor_id=? AND endpoint=?",
                (visitor, endpoint),
            )

    def _active_visitor(self, visitor, now):
        with self.chat_db.connection() as connection:
            return (
                connection.execute(
                    "SELECT 1 FROM sessions WHERE visitor_id=? AND revoked=0 AND last_seen_at>? LIMIT 1",
                    (visitor, now - self.chat_db.session_lifetime),
                ).fetchone()
                is not None
            )

    def scan(self):
        """A completion committed before a process crash is found on restart."""
        now = self.clock()
        with self.connection() as connection:
            connection.execute("DELETE FROM subscriptions WHERE expires_at<=?", (now,))
            connection.execute("DELETE FROM outbox WHERE expires_at<=?", (now,))
            subscriptions = connection.execute("SELECT * FROM subscriptions").fetchall()
        for sub in subscriptions:
            if not self._active_visitor(sub["visitor_id"], now):
                self.unsubscribe(sub["visitor_id"], sub["endpoint"])
                continue
            with self.chat_db.connection() as connection:
                jobs = connection.execute(
                    "SELECT job_id,client_request_id,accepted_at,updated_at FROM requests "
                    "WHERE visitor_id=? AND scenario_version='daily-if-v1' AND status='complete' "
                    "AND (updated_at>? OR (updated_at=? AND job_id>?)) "
                    "ORDER BY updated_at,job_id LIMIT 64",
                    (sub["visitor_id"], sub["scan_at"], sub["scan_at"], sub["scan_id"]),
                ).fetchall()
            with self.connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                if not connection.execute(
                    "SELECT 1 FROM subscriptions WHERE id=?", (sub["id"],)
                ).fetchone():
                    continue
                for job in jobs:
                    accepted = datetime.fromisoformat(job["accepted_at"]).timestamp()
                    completed = datetime.fromisoformat(job["updated_at"]).timestamp()
                    if completed >= sub["created_at"] and completed + PUSH_TTL > now:
                        delay = reply_delay_seconds(job["client_request_id"])
                        release = max(completed + delay, accepted + delay + 1.5)
                        connection.execute(
                            "INSERT OR IGNORE INTO outbox VALUES (?,?,?,?, 'pending',0,?,NULL)",
                            (
                                sub["id"],
                                job["job_id"],
                                release,
                                completed + PUSH_TTL,
                                release,
                            ),
                        )
                if jobs:
                    connection.execute(
                        "UPDATE subscriptions SET scan_at=?,scan_id=? WHERE id=?",
                        (jobs[-1]["updated_at"], jobs[-1]["job_id"], sub["id"]),
                    )

    def _claim(self):
        now = self.clock()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "UPDATE outbox SET state='failed',last_error='attempt_limit' WHERE state='sending' AND next_attempt<=? AND attempts>=?",
                (now, MAX_ATTEMPTS),
            )
            row = connection.execute(
                "SELECT o.*,s.visitor_id,s.endpoint,s.p256dh,s.auth FROM outbox o JOIN subscriptions s ON s.id=o.subscription_id "
                "WHERE o.state IN ('pending','sending') AND o.next_attempt<=? AND o.not_before<=? AND o.expires_at>? AND s.expires_at>? AND o.attempts<? "
                "ORDER BY o.next_attempt,o.job_id LIMIT 1",
                (now, now, now, now, MAX_ATTEMPTS),
            ).fetchone()
            if row:
                connection.execute(
                    "UPDATE outbox SET state='sending',attempts=attempts+1,next_attempt=? WHERE subscription_id=? AND job_id=?",
                    (now + LEASE_SECONDS, row["subscription_id"], row["job_id"]),
                )
                return {**dict(row), "attempts": row["attempts"] + 1}
        return None

    def tick(self):
        """Send at most one notification; never block the model queue."""
        self.scan()
        item = self._claim()
        if item is None:
            return False
        now = self.clock()
        if not self._active_visitor(item["visitor_id"], now):
            self.unsubscribe(item["visitor_id"], item["endpoint"])
            return False
        job = self.chat_db.get_request(item["job_id"], visitor=item["visitor_id"])
        if (
            not job
            or job["status"] != "complete"
            or job["character"] not in TITLES
            or not job.get("reply")
        ):
            self._finish(item, "failed", "ineligible")
            return False
        # A subscription can be removed while its job is being read.
        with self.connection() as connection:
            if not connection.execute(
                "SELECT 1 FROM subscriptions WHERE id=? AND visitor_id=?",
                (item["subscription_id"], item["visitor_id"]),
            ).fetchone():
                return False
        payload = {
            "type": "chat.reply",
            "subscription_id": item["subscription_id"],
            "notification_id": item["job_id"],
            "job_id": item["job_id"],
            "character": job["character"],
            "title": TITLES[job["character"]],
            "body": job["reply"].strip()[:180],
            "url": "/yaku_IPhone/?conversation=" + job["character"],
        }
        status = None
        try:
            response = self.sender(
                {
                    "endpoint": item["endpoint"],
                    "keys": {"p256dh": item["p256dh"], "auth": item["auth"]},
                },
                payload,
                self.key_path,
                max(1, min(PUSH_TTL, int(item["expires_at"] - now))),
            )
            status = response.status_code
        except (
            VapidException,
            WebPushException,
            RequestException,
            OSError,
            ValueError,
            TypeError,
        ) as error:
            # Provider diagnostics may contain endpoint credentials; store no text.
            status = getattr(error, "status_code", None)
            if status is None and getattr(error, "response", None) is not None:
                status = error.response.status_code
        if status in (200, 201, 202):
            self._finish(item, "sent", None)
            return True
        if status in (404, 410):
            self.unsubscribe(item["visitor_id"], item["endpoint"])
        elif (
            status is None
            or status == 429
            or isinstance(status, int)
            and 500 <= status < 600
        ) and item["attempts"] < MAX_ATTEMPTS:
            self._finish(item, "pending", "provider_retry", delay=30 * item["attempts"])
        else:
            self._finish(item, "failed", "provider_rejected")
        return False

    def _finish(self, item, state, error, *, delay=0):
        with self.connection() as connection:
            connection.execute(
                "UPDATE outbox SET state=?,last_error=?,next_attempt=? WHERE subscription_id=? AND job_id=?",
                (
                    state,
                    error,
                    self.clock() + delay,
                    item["subscription_id"],
                    item["job_id"],
                ),
            )
