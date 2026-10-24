"""Local conversation isolation. This is not authentication for a public service."""

import hashlib
import json
from pathlib import Path


def scope_key(visitor_id, character_id, scenario_version):
    values = [visitor_id, character_id, scenario_version]
    if not all(isinstance(v, str) and v.strip() for v in values):
        raise ValueError(
            "Visitor, character and scenario identifiers must be nonempty strings"
        )
    return tuple(values)


def select_scoped_memory(records, visitor_id, character_id, scenario_version):
    wanted = scope_key(visitor_id, character_id, scenario_version)
    result = []
    for record in records:
        observed = (
            record.get("visitor_id"),
            record.get("character_id"),
            record.get("scenario_version"),
        )
        if observed == wanted:
            result.append(dict(record))
    return result


class SessionStore:
    def __init__(self, directory=None):
        self.directory = Path(directory) if directory is not None else None
        self.sessions = {}

    def _path(self, key):
        encoded = json.dumps(key, ensure_ascii=False, separators=(",", ":")).encode()
        return self.directory / (hashlib.sha256(encoded).hexdigest() + ".json")

    def history(self, visitor_id, character_id, scenario_version):
        key = scope_key(visitor_id, character_id, scenario_version)
        if key not in self.sessions:
            self.sessions[key] = []
            if self.directory is not None and self._path(key).exists():
                saved = json.loads(self._path(key).read_text())
                if saved["scope"] != list(key):
                    raise ValueError("Stored conversation scope does not match")
                self.sessions[key] = saved["messages"]
        # Return a deep copy: callers cannot mutate another request's stored state.
        return [dict(message) for message in self.sessions[key]]

    def append_exchange(self, visitor_id, character_id, scenario_version, user, reply):
        key = scope_key(visitor_id, character_id, scenario_version)
        messages = self.history(*key)
        if not all(isinstance(value, str) and value.strip() for value in [user, reply]):
            raise ValueError("An exchange requires nonempty user and assistant text")
        messages.extend(
            [{"role": "user", "content": user}, {"role": "assistant", "content": reply}]
        )
        self.sessions[key] = messages
        if self.directory is not None:
            self.directory.mkdir(parents=True, exist_ok=True)
            path = self._path(key)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(
                    {"scope": list(key), "messages": messages},
                    ensure_ascii=False,
                    indent=2,
                )
            )
            temporary.replace(path)


def filter_knowledge(facts, character_id, allowed_fact_ids):
    """Only explicitly adopted facts may enter the IF character's prompt."""
    allowed = set(allowed_fact_ids)
    return [
        dict(fact)
        for fact in facts
        if fact.get("id") in allowed and character_id in fact.get("known_by", [])
    ]
