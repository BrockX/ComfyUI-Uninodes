"""Disk-backed, versioned profile and style presets. No external Python dependencies."""
from __future__ import annotations

import fnmatch
import json
import math
import os
import tempfile
import threading
from pathlib import Path

# Composer lives in Uninodes, while existing CPM libraries remain in place.
# Never move or overwrite data/libraries on upgrade.
LEGACY_CPM = Path(__file__).resolve().parent.parent / 'checkpoint-profile-manager'
ROOT = LEGACY_CPM if LEGACY_CPM.is_dir() else Path(__file__).resolve().parent
DATA = ROOT / "data"
PRESETS = ROOT / "profiles"
LOCK = threading.RLock()
USER_PROFILES = DATA / "user_profiles.json"
USER_STYLES = DATA / "user_styles.json"
STYLE_LIMIT = 120

FIELDS = (
    "sampler_name", "scheduler", "steps", "cfg", "clip_skip", "width", "height",
    "vae_name", "positive_prefix", "negative_prefix",
)
DEFAULTS = {
    "sampler_name": "euler_ancestral", "scheduler": "normal", "steps": 28, "cfg": 5.0,
    "clip_skip": -1, "width": 1024, "height": 1024, "vae_name": "Embedded",
    "positive_prefix": "", "negative_prefix": "",
}


def _read_json(path: Path, fallback):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return fallback


def _write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".profile_", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def _normalized_ckpt(value):
    return str(value).replace("\\", "/").casefold().strip()


def _checkpoint_key(value):
    # Full relative checkpoint filename, not only basename: avoid collisions.
    key = str(value).strip().replace("\\", "/")
    if not key or len(key) > 512 or key.startswith("/") or ".." in key.split("/"):
        raise ValueError("Invalid checkpoint name")
    return key


def validate_profile(p):
    if not isinstance(p, dict):
        raise ValueError("Profile must be a JSON object")
    merged = {**DEFAULTS, **{k: p[k] for k in FIELDS if k in p}}
    if not isinstance(merged["sampler_name"], str) or len(merged["sampler_name"]) > 64:
        raise ValueError("Invalid sampler")
    if not isinstance(merged["scheduler"], str) or len(merged["scheduler"]) > 64:
        raise ValueError("Invalid scheduler")
    for key, lo, hi in (("steps", 1, 150), ("clip_skip", -12, -1), ("width", 64, 4096), ("height", 64, 4096)):
        value = merged[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not float(value).is_integer():
            raise ValueError("Invalid integer: " + key)
        merged[key] = int(value)
        if not lo <= merged[key] <= hi:
            raise ValueError("Out of range: " + key)
    if merged["width"] % 8 or merged["height"] % 8:
        raise ValueError("Width and height must be multiples of 8")
    cfg = merged["cfg"]
    if isinstance(cfg, bool) or not isinstance(cfg, (int, float)) or not math.isfinite(float(cfg)) or not 0 <= cfg <= 30:
        raise ValueError("Invalid CFG")
    merged["cfg"] = float(cfg)
    for key in ("positive_prefix", "negative_prefix"):
        if not isinstance(merged[key], str) or len(merged[key]) > 12000:
            raise ValueError("Invalid " + key)
    if not isinstance(merged["vae_name"], str) or len(merged["vae_name"]) > 255:
        raise ValueError("Invalid VAE")
    return merged


def checkpoint_preset(checkpoint):
    name = _normalized_ckpt(checkpoint)
    base = name.rsplit("/", 1)[-1]
    catalog = _read_json(PRESETS / "checkpoints.json", {"presets": [], "fallback": {}})
    matches = []
    for entry in catalog["presets"]:
        for glob in entry.get("matches", []):
            if fnmatch.fnmatchcase(base, glob.casefold()) or fnmatch.fnmatchcase(name, glob.casefold()):
                # Stronger/longer filename patterns before generic ones.
                specificity = len(glob.replace("*", "").replace("?", ""))
                matches.append((specificity, entry))
    return max(matches, key=lambda m: m[0])[1] if matches else catalog["fallback"]


def _get_overrides():
    data = _read_json(USER_PROFILES, {"schema_version": 1, "checkpoints": {}})
    return data if isinstance(data, dict) and isinstance(data.get("checkpoints"), dict) else {"schema_version": 1, "checkpoints": {}}


def get_profile(checkpoint, mode="Creator"):
    key = _checkpoint_key(checkpoint)
    preset = checkpoint_preset(key)
    raw = preset.get("creator", DEFAULTS)
    origin = "Bundled reference" if preset.get("source_type") != "suggested" else "Bundled suggestion"
    overrides = _get_overrides().get("checkpoints", {}).get(key, {})
    if mode == "Personal" and isinstance(overrides.get("Personal"), dict):
        raw, origin = overrides["Personal"], "Personal saved profile"
    elif mode == "Creator" and isinstance(overrides.get("Creator"), dict):
        raw, origin = overrides["Creator"], "User-edited reference override (not publisher verified)"
    elif mode == "Personal":
        origin += " (no Personal profile saved; using reference)"
    return {
        "checkpoint": key, "mode": mode, "values": validate_profile(raw),
        "matched": "id" in preset, "preset_id": preset.get("id", "fallback"),
        "label": preset.get("label", "Unknown model"),
        "source_type": preset.get("source_type", "suggested"),
        "origin": origin, "source_url": preset.get("source_url", ""),
        "documented_fields": preset.get("documented_fields", []),
        "note": preset.get("note", ""),
        "has_personal": "Personal" in overrides,
        "has_creator_override": "Creator" in overrides,
    }


def save_profile(checkpoint, mode, values):
    if mode not in ("Personal", "Creator"):
        raise ValueError("You can only save a Personal or Creator override")
    key = _checkpoint_key(checkpoint)
    validated = validate_profile(values)
    with LOCK:
        data = _get_overrides()
        data["checkpoints"].setdefault(key, {})[mode] = validated
        _write_json(USER_PROFILES, data)
    return get_profile(key, mode)


def delete_profile(checkpoint, mode):
    if mode not in ("Personal", "Creator"):
        raise ValueError("Invalid mode")
    key = _checkpoint_key(checkpoint)
    with LOCK:
        data = _get_overrides()
        data["checkpoints"].get(key, {}).pop(mode, None)
        _write_json(USER_PROFILES, data)
    return get_profile(key, mode)


def validate_style(obj):
    if not isinstance(obj, dict):
        raise ValueError("Style must be a JSON object")
    name = obj.get("name", "")
    if not isinstance(name, str) or not name.strip() or len(name) > STYLE_LIMIT:
        raise ValueError("Invalid style name")
    if name.strip().casefold() == "custom":
        raise ValueError("Style name 'Custom' is reserved")
    for key in ("positive_prefix", "negative_prefix", "notes"):
        if not isinstance(obj.get(key, ""), str) or len(obj.get(key, "")) > 12000:
            raise ValueError("Invalid " + key)
    return {"name": name.strip(), "positive_prefix": obj.get("positive_prefix", ""),
            "negative_prefix": obj.get("negative_prefix", ""), "notes": obj.get("notes", "")}


def _get_user_styles():
    data = _read_json(USER_STYLES, {"schema_version": 1, "styles": {}})
    return data if isinstance(data, dict) and isinstance(data.get("styles"), dict) else {"schema_version": 1, "styles": {}}


def list_styles():
    bundled = _read_json(PRESETS / "styles.json", {"presets": []})["presets"]
    styles = {style["name"]: {**style, "source": "Bundled"} for style in bundled}
    for name, style in _get_user_styles()["styles"].items():
        styles[name] = {**style, "source": "Personal"}
    return list(styles.values())


def get_style(name):
    for style in list_styles():
        if style["name"] == name:
            return style
    return {"name": name, "positive_prefix": "", "negative_prefix": "", "notes": "Unknown style: no prefixes added", "source": "Missing"}


def save_style(style):
    validated = validate_style(style)
    with LOCK:
        data = _get_user_styles()
        data["styles"][validated["name"]] = validated
        _write_json(USER_STYLES, data)
    return get_style(validated["name"])


def delete_style(name):
    if not isinstance(name, str) or len(name) > STYLE_LIMIT:
        raise ValueError("Invalid style name")
    with LOCK:
        data = _get_user_styles()
        data["styles"].pop(name, None)
        _write_json(USER_STYLES, data)
    return get_style(name)


def export_user_data():
    # Import lazily: library_store imports store for existing Style compatibility.
    from . import library_store
    custom_libraries = []
    for path in sorted(library_store.USER_LIBRARIES.glob("*.json")):
        try:
            lib = library_store.validate_library(_read_json(path, {}))
            if path.stem == lib["id"]:
                custom_libraries.append(lib)
        except ValueError:
            continue
    return {"format": "Checkpoint Profile Manager", "schema_version": 1,
            "user_profiles": _get_overrides(), "user_styles": _get_user_styles(),
            "user_libraries": custom_libraries}


def import_user_data(blob):
    if not isinstance(blob, dict) or blob.get("schema_version") != 1:
        raise ValueError("Invalid export format/version")
    if not isinstance(blob.get("user_profiles"), dict) or not isinstance(blob.get("user_styles"), dict):
        raise ValueError("Missing profile/style data")
    checkpoints = blob["user_profiles"].get("checkpoints", {})
    styles = blob["user_styles"].get("styles", {})
    if not isinstance(checkpoints, dict) or not isinstance(styles, dict) or len(checkpoints) > 5000 or len(styles) > 5000:
        raise ValueError("Invalid import size")
    cleaned_checkpoints = {}
    for key, modes in checkpoints.items():
        name = _checkpoint_key(key)
        if not isinstance(modes, dict):
            raise ValueError("Invalid profile modes")
        cleaned_checkpoints[name] = {mode: validate_profile(profile) for mode, profile in modes.items() if mode in ("Creator", "Personal")}
    cleaned_styles = {validate_style({**style, "name": name})["name"]: validate_style({**style, "name": name}) for name, style in styles.items()}
    from . import library_store
    libs = blob.get("user_libraries", [])
    if not isinstance(libs, list) or len(libs) > 100:
        raise ValueError("Invalid imported library collection")
    cleaned_libs = [library_store.validate_library(x) for x in libs]
    with LOCK:
        oldp, olds = _get_overrides(), _get_user_styles()
        oldp["checkpoints"].update(cleaned_checkpoints)
        olds["styles"].update(cleaned_styles)
        _write_json(USER_PROFILES, oldp)
        _write_json(USER_STYLES, olds)
        for lib in cleaned_libs:
            library_store.import_library(lib)
    return {"checkpoints_imported": len(cleaned_checkpoints), "styles_imported": len(cleaned_styles),
            "libraries_imported": len(cleaned_libs)}
