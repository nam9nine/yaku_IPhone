"""Rebuild the message thread a visitor sees from shared authored content and stored turns.

The browser shows an authored opening, local authored lines (quest followups and
check-ins) and AI exchanges in one thread. The model must read that same thread,
or a reply to a visible line looks like a message out of nowhere. Everything here
comes from checked-in catalogs or the visitor's own stored requests; clients still
send only catalog event IDs.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .phone_events import catalog_events

OPENINGS_PATH = Path(__file__).resolve().parents[2] / "src/day/ai-openings.json"
CHARACTERS = ("haruka", "majima")


@lru_cache(maxsize=1)
def _openings():
    data = json.loads(OPENINGS_PATH.read_text(encoding="utf-8"))
    if data.get("version") != "ai-openings-v1" or set(data.get("threads", {})) != set(
        CHARACTERS
    ):
        raise ValueError("Unsupported opening catalog")
    for character, rows in data["threads"].items():
        if not isinstance(rows, list) or not rows:
            raise ValueError("Opening thread must be a nonempty list")
        identifiers = [row.get("id") for row in rows]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("Opening message IDs must be unique")
        for row in rows:
            if (
                not isinstance(row, dict)
                or not {"id", "speaker", "text", "time"}
                <= set(row)
                <= {"id", "speaker", "text", "time", "noteId", "attachment"}
                or row["speaker"] not in (character, "kiryu")
                or any(
                    not isinstance(row[key], str) or not row[key].strip() for key in row
                )
            ):
                raise ValueError("Invalid opening message")
    return data


def opening_version():
    return _openings()["version"]


def opening_messages(character):
    """Authored opening as model rows; user is Kiryu and assistant is the character."""
    return [
        {
            "id": "opening:" + row["id"],
            "role": "user" if row["speaker"] == "kiryu" else "assistant",
            "content": row["text"],
            "kind": "opening",
        }
        for row in _openings()["threads"][character]
    ]


def opening_attachments(character):
    """Memo text the character attached to opening messages, for the scene block."""
    return [
        row["attachment"]
        for row in _openings()["threads"][character]
        if "attachment" in row
    ]


def event_messages(character, identifiers):
    """Exact authored lines the app showed for these events, oldest first.

    Stored requests were validated when accepted; an ID a later catalog no longer
    has, or another contact's ID, is skipped rather than failing the reply.
    """
    events = catalog_events()
    return [
        {
            "id": "event:" + identifier,
            "role": "assistant",
            "content": events[identifier]["message"],
            "kind": "local",
        }
        for identifier in identifiers
        if identifier in events
        and events[identifier]["character"] == character
        and "message" in events[identifier]
    ]


def visible_timeline(character, history, notices=(), current_events=()):
    """Order stored turns, outbound texts and first-reported local lines as shown.

    History user rows may carry the phone events their request reported. An event
    seen for the first time belongs right before that user message: the app showed
    its line after the previous exchange. Repeated reports are state, not new lines.
    Notices are the character's stored outbound texts and sort by sequence.
    """
    rows = sorted(
        [*history, *notices],
        key=lambda row: (row.get("sequence") is None, row.get("sequence") or 0),
    )
    seen = set()
    timeline = []
    for row in rows:
        events = row.get("phone_events") if row.get("role") == "user" else None
        if events:
            fresh = [event for event in events if event not in seen]
            seen.update(events)
            timeline.extend(event_messages(character, fresh))
        timeline.append(row)
    fresh = [event for event in current_events if event not in seen]
    timeline.extend(event_messages(character, fresh))
    return timeline


def native_turns(rows):
    """Render rows as chat turns; consecutive lines of one speaker become one turn.

    The Gemma 4 template joins consecutive model turns without a separator, so the
    bubbles are joined here with a newline, the way a burst of texts reads.
    """
    turns = []
    for row in rows:
        if turns and turns[-1]["role"] == row["role"]:
            turns[-1]["content"] += "\n" + row["content"]
        else:
            turns.append({"role": row["role"], "content": row["content"]})
    return turns
