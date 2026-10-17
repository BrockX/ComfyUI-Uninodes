"""Independent, checkpoint-scoped Creator/Personal Direct Sampler presets.

No imports from the former Checkpoint Profile Manager. User edits are stored
outside release files and replaced atomically; legacy CPM data is read-only.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / 'data'
PROFILE_FILE = DATA_DIR / 'sampler_profiles.json'
LEGACY_FILES = (
    DATA_DIR / 'user_profiles.json',
    ROOT.parent / 'checkpoint-profile-manager' / 'data' / 'user_profiles.json',
)
LOCK = threading.RLock()
MODES = ('Creator', 'Personal')
# The per-checkpoint defaults, not the seed, prompts, LoRAs, or finisher state.
PROFILE_FIELDS = (
    'steps', 'cfg', 'denoise', 'sampler_name', 'scheduler', 'clip_skip',
    'width', 'height', 'batch_size', 'vae_name', 'clip_source',
    'encoder_loader', 'encoder_type', 'encoder_1', 'encoder_2',
    'encoder_3', 'encoder_4', 'positive_prefix', 'negative_prefix',
)


def _key(checkpoint):
    if not isinstance(checkpoint, str):
        raise ValueError('Invalid checkpoint name')
    name = checkpoint.replace('\\', '/').strip()
    if not name or len(name) > 512 or name.startswith('/') or '\x00' in name or '..' in name.split('/'):
        raise ValueError('Invalid checkpoint name')
    return name


def _mode(mode):
    if mode not in MODES:
        raise ValueError('Profile mode must be Creator or Personal')
    return mode


def _read_file(path):
    try:
        with path.open(encoding='utf-8') as file:
            result = json.load(file)
    except FileNotFoundError:
        return {'schema_version': 1, 'checkpoints': {}}
    if not isinstance(result, dict) or result.get('schema_version') != 1 or not isinstance(result.get('checkpoints'), dict):
        raise ValueError(f'Invalid profile data format in {path}')
    return result


def _validate(values):
    if not isinstance(values, dict):
        raise ValueError('Profile settings must be a JSON object')
    # Validate with the actual sampler contract, not a divergent copy.
    from . import backend
    raw = {key: values[key] for key in PROFILE_FIELDS if key in values and key not in ('positive_prefix', 'negative_prefix')}
    # Accept old CPM VAE spelling while retaining new Internal naming.
    if raw.get('vae_name') == 'Embedded':
        raw['vae_name'] = 'Internal'
    validated = backend.validate_settings(raw)
    saved = {key: validated[key] for key in PROFILE_FIELDS if key in validated}
    for key in ('positive_prefix', 'negative_prefix'):
        prefix = values.get(key, '')
        if not isinstance(prefix, str) or len(prefix) > 12000:
            raise ValueError(f'Invalid {key}')
        saved[key] = prefix
    return saved


def _find(checkpoint, mode, source):
    records = source.get('checkpoints', {})
    exact = records.get(checkpoint)
    if isinstance(exact, dict) and isinstance(exact.get(mode), dict):
        return exact[mode]
    # Old CPM normalized Windows separators/casing differently. Only migrate
    # if the name unambiguously refers to this same relative model path.
    normalized = checkpoint.casefold()
    matches = [modes[mode] for k, modes in records.items()
               if isinstance(k, str) and k.replace('\\', '/').casefold() == normalized
               and isinstance(modes, dict) and isinstance(modes.get(mode), dict)]
    return matches[0] if len(matches) == 1 else None


def get_profile(checkpoint, mode):
    name, mode = _key(checkpoint), _mode(mode)
    with LOCK:
        current = _find(name, mode, _read_file(PROFILE_FILE))
        origin = 'Uninodes'
        if current is None:
            for path in LEGACY_FILES:
                legacy = _find(name, mode, _read_file(path))
                if legacy is not None:
                    current = legacy
                    origin = 'Legacy Checkpoint Profile Manager (read-only)'
                    break
        if current is None:
            return None
        return {'checkpoint': name, 'mode': mode, 'values': _validate(current), 'origin': origin}


def save_profile(checkpoint, mode, values):
    name, mode = _key(checkpoint), _mode(mode)
    saved = _validate(values)
    with LOCK:
        data = _read_file(PROFILE_FILE)
        data['checkpoints'].setdefault(name, {})[mode] = saved
        PROFILE_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=PROFILE_FILE.parent, prefix='.sampler_profile_', suffix='.json')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump(data, stream, indent=2, ensure_ascii=False)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tmp, PROFILE_FILE)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    return get_profile(name, mode)


def delete_profile(checkpoint, mode):
    name, mode = _key(checkpoint), _mode(mode)
    with LOCK:
        data = _read_file(PROFILE_FILE)
        if isinstance(data['checkpoints'].get(name), dict):
            data['checkpoints'][name].pop(mode, None)
            if not data['checkpoints'][name]:
                data['checkpoints'].pop(name, None)
        PROFILE_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=PROFILE_FILE.parent, prefix='.sampler_profile_', suffix='.json')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump(data, stream, indent=2, ensure_ascii=False)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tmp, PROFILE_FILE)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    # Legacy profiles are read-only and may still be discoverable afterwards.
    return get_profile(name, mode)
