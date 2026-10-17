"""Global LoRA trigger-word library shared by Direct Sampler and Deluxe.

Keys retain the full relative LoRA path (not just the basename) to avoid
collisions. The data file is not shipped in release patches and all writes
are atomic. Existing per-workflow trigger strings take precedence.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent / "data" / "lora_triggers.json"
_LOCK = threading.RLock()
_MAX_TRIGGERS = 4096
_MAX_TEXT = 1000  # Same maximum as the Direct Sampler backend.


def _name(name):
    if not isinstance(name, str):
        raise ValueError("LoRA name must be text")
    path = name.replace("\\", "/").strip()
    if (not path or len(path) > 512 or path.startswith("/")
            or "\x00" in path or any(part in ("", "..") for part in path.split("/"))):
        raise ValueError("Invalid LoRA name")
    return path.lower()  # Match JavaScript toLowerCase for frontend lookups.


def _read():
    try:
        with DATA_FILE.open(encoding="utf-8") as stream:
            data = json.load(stream)
    except FileNotFoundError:
        return {"schema_version": 1, "triggers": {}}
    if (not isinstance(data, dict) or data.get("schema_version") != 1
            or not isinstance(data.get("triggers"), dict)):
        raise ValueError("Invalid LoRA trigger library format")
    return data


def list_triggers():
    """Retrieve the entire small library, keyed by case-insensitive LoRA paths."""
    with _LOCK:
        data = _read()["triggers"]
        return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str)}


def set_trigger(name, trigger):
    """Set global trigger words; an empty string deliberately removes the entry."""
    key = _name(name)
    if not isinstance(trigger, str) or len(trigger) > _MAX_TEXT:
        raise ValueError("Trigger words must be text up to 1000 characters")
    with _LOCK:
        data = _read()
        words = data["triggers"]
        if trigger.strip():
            if key not in words and len(words) >= _MAX_TRIGGERS:
                raise ValueError("LoRA trigger library is full")
            words[key] = trigger
        else:
            words.pop(key, None)
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd, filename = tempfile.mkstemp(prefix=".lora_triggers_", suffix=".json", dir=DATA_FILE.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(filename, DATA_FILE)
        finally:
            if os.path.exists(filename):
                os.unlink(filename)
    return {"name": key, "trigger": trigger}
