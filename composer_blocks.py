"""Checkpoint Profile Manager: ordered, dual-polarity prompt composition.

Libraries and text rows are the complete prompt; there is no dedicated Main Prompt.
Older workflows are migrated in the frontend so their main text is not lost.
"""
from __future__ import annotations
import json
import re

MAX_BLOCKS = 96
MAX_CONFIG_BYTES = 250_000
MAX_TEXT = 12_000
ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
MAIN_ID = "cpm_main"

def _check_text(value, what):
    if not isinstance(value, str) or len(value) > MAX_TEXT:
        raise ValueError(f"{what} must be text up to {MAX_TEXT} characters")
    return value


def read_blocks(raw):
    if not isinstance(raw, str) or len(raw) > MAX_CONFIG_BYTES:
        raise ValueError("Invalid/oversized prompt blocks JSON")
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid prompt blocks JSON") from exc
    if not isinstance(data, list) or len(data) > MAX_BLOCKS:
        raise ValueError(f"Expected at most {MAX_BLOCKS} prompt rows")
    result, seen = [], set()
    for entry in data:
        if not isinstance(entry, dict):
            raise ValueError("Each prompt row must be an object")
        typ = entry.get("type", "text")
        ident = entry.get("id", MAIN_ID if typ == "main" else None)
        if not isinstance(ident, str) or not ID_RE.fullmatch(ident) or ident in seen:
            raise ValueError("Prompt row IDs must be unique URL-safe strings")
        seen.add(ident)
        if typ == "main":
            # Older saved workflows used an anchor. It contributes no content by
            # itself and is removed when the frontend migrates the main text.
            continue
        name = entry.get("name", "Folder" if typ == "folder" else "Block")
        if not isinstance(name, str) or not name.strip() or len(name) > 160:
            raise ValueError("Invalid prompt row name")
        if typ == "folder":
            result.append({"id": ident, "type": "folder", "name": name})
            continue
        enabled = entry.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ValueError("Invalid enabled flag")
        folder_id = entry.get("folder_id")
        if folder_id is not None and (not isinstance(folder_id, str) or not ID_RE.fullmatch(folder_id)):
            raise ValueError("Invalid folder ID")
        common = {"id": ident, "type": typ, "name": name, "enabled": enabled, "folder_id": folder_id}
        if typ == "library":
            expose = entry.get("expose_input", False)
            if not isinstance(expose, bool):
                raise ValueError("Invalid socket setting")
            common["expose_input"] = expose
            lib_id, preset_id = entry.get("library_id"), entry.get("preset_id")
            if not all(isinstance(v, str) and ID_RE.fullmatch(v or "") for v in (lib_id, preset_id)):
                raise ValueError("Library row requires valid library and preset IDs")
            selections = entry.get("variables", {})
            if not isinstance(selections, dict) or len(selections) > 8:
                raise ValueError("Invalid modifier selections")
            for slot, value in selections.items():
                if (not isinstance(slot, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,31}", slot)
                        or not isinstance(value, str) or len(value) > 2000):
                    raise ValueError("Invalid variable slot/value")
                # Text slots may contain spaces and punctuation; library-backed
                # choices are still validated as IDs by resolve_preset().
            common.update(library_id=lib_id, preset_id=preset_id, variables=selections,
                          auto_label=entry.get("auto_label", True) is not False)
        elif typ == "text":
            pos = entry.get("positive_text")
            neg = entry.get("negative_text")
            # Migrate original v1.4 single-polarity text blocks.
            if pos is None and neg is None:
                previous = entry.get("text", "")
                pos = previous if entry.get("target", "positive") == "positive" else ""
                neg = previous if entry.get("target") == "negative" else ""
            common.update(positive_text=_check_text(pos if pos is not None else "", "Positive text"),
                          negative_text=_check_text(neg if neg is not None else "", "Negative text"))
            expose = entry.get("expose_input", False)
            if not isinstance(expose, bool):
                raise ValueError("Invalid socket setting")
            common["expose_input"] = expose
            visible = entry.get("show_text_fields", True)
            if not isinstance(visible, bool):
                raise ValueError("Invalid show_text_fields flag")
            common["show_text_fields"] = visible
            common["legacy_target"] = entry.get("target") if "positive_text" not in entry and "negative_text" not in entry else None
        else:
            raise ValueError("Unknown row type: " + str(typ))
        result.append(common)

    # Legacy V1.4 blocks without a main anchor had prefix/suffix ordering.
    # Preserve their relative order when executing old API prompts.
    if not any(r.get("type") == "main" for r in data):
        placements = {r.get("id"): r.get("placement", "prefix") for r in data}
        result.sort(key=lambda row: placements.get(row["id"]) == "suffix")
    return result


def socket_name(ident, polarity):
    if polarity not in ("positive", "negative"):
        raise ValueError("Expected positive or negative")
    return f"cpm_block_{ident}_{polarity}"


def joined(items):
    return ", ".join(part.strip().strip(", ") for part in items
                     if isinstance(part, str) and part.strip().strip(", "))


def compose(positive_prompt="", negative_prompt="", checkpoint_positive="", checkpoint_negative="",
            blocks_json="[]", **connected):
    sections = {"positive": [], "negative": []}
    # Checkpoint prefixes are first and not part of the ordered library/text list.
    sections["positive"].append(checkpoint_positive)
    sections["negative"].append(checkpoint_negative)
    # Calls from pre-1.5.12 workflows or direct API clients may still pass
    # legacy main fields. Keep their text in the old anchor position; new
    # Composers pass empty values and use ordinary text/library rows only.
    rows = read_blocks(blocks_json)  # also validates the JSON and size
    source = json.loads(blocks_json or '[]')
    anchor = next((i for i, row in enumerate(source)
                   if row.get('type') == 'main'), None)
    if anchor is not None:
        before_main = sum(1 for row in source[:anchor] if row.get('type') != 'main')
    else:
        # V1.4 prefix/suffix rows are sorted by read_blocks().
        before_main = sum(1 for row in source if row.get('placement', 'prefix') != 'suffix')
    for index, b in enumerate(rows):
        if index == before_main:
            sections["positive"].append(positive_prompt)
            sections["negative"].append(negative_prompt)
        typ = b["type"]
        if typ == "folder":
            continue
        if not b["enabled"]:
            continue
        if typ == "library":
            from . import library_store
            raw_entry = library_store.get_preset(b["library_id"], b["preset_id"])
            entry = library_store.resolve_preset(raw_entry, b.get("variables", {}))
        else:
            entry = None
        for polarity in ("positive", "negative"):
            key = socket_name(b["id"], polarity)
            if b["expose_input"] and key in connected:
                val = connected[key]
            elif b["expose_input"] and f"cpm_block_{b['id']}" in connected and b.get("legacy_target") == polarity:
                # Migration path for original single-input v1.4 workflow.
                val = connected[f"cpm_block_{b['id']}"]
            else:
                val = entry[polarity] if entry is not None else b[polarity + "_text"]
            sections[polarity].append(_check_text(val, f"Connected {polarity} text"))
    if before_main >= len(rows):
        sections["positive"].append(positive_prompt)
        sections["negative"].append(negative_prompt)
    return joined(sections["positive"]), joined(sections["negative"])
