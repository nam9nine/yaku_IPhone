"""Resolve bounded browser game events from one versioned, checked-in catalog.

Clients send IDs only. These are untrusted reports about the current game's UI,
not canon facts, purchases, dialogue turns, or evidence from another visitor.
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parents[2] / "src/day/phone-events.json"
MAX_PHONE_EVENTS = 4
NO_PHONE_EVENTS = object()


def _hash(value):
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()


@lru_cache(maxsize=1)
def _catalog():
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if data.get("version") not in (
        "phone-events-v2",
        "phone-events-v3",
    ) or not isinstance(data.get("events"), dict):
        raise ValueError("Unsupported phone event catalog")
    for identifier, item in data["events"].items():
        if (
            not isinstance(identifier, str)
            or not isinstance(item, dict)
            or set(item) != {"character", "text"}
            or item["character"] not in ("haruka", "majima")
            or not isinstance(item["text"], str)
            or not item["text"].strip()
            or len(item["text"]) > 250
        ):
            raise ValueError("Invalid canonical phone event")
    return data


def validate_phone_events(character, value):
    """Return a fresh ordered list, rejecting rather than silently trimming input."""
    if (
        character not in ("haruka", "majima")
        or not isinstance(value, list)
        or len(value) > MAX_PHONE_EVENTS
        or not all(isinstance(item, str) for item in value)
        or len(set(value)) != len(value)
    ):
        raise ValueError("Invalid phone event IDs")
    events = _catalog()["events"]
    if any(
        identifier not in events or events[identifier]["character"] != character
        for identifier in value
    ):
        raise ValueError("Phone event belongs to an unsupported contact or ID")
    return list(value)


def resolve_phone_events(character, value):
    identifiers = validate_phone_events(character, value)
    catalog = _catalog()
    resolved = [
        {"id": identifier, **catalog["events"][identifier]}
        for identifier in identifiers
    ]
    snapshot = {"version": catalog["version"], "events": resolved}
    return {
        "events": resolved,
        "metadata": {
            "version": catalog["version"],
            "ids": identifiers,
            "sha256": _hash(snapshot),
            "catalog_sha256": _hash(catalog),
            "applied_to": "renderer-system",
        },
    }


def is_call_events(events):
    return any(event in ("majima-call-live", "haruka-call-live") for event in events)
