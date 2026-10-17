"""Shared, local preset libraries for camera/composition/lighting/styles/custom packs.

Library JSON is data, never evaluated. Bundled files are read-only; imported packs
live under data/libraries. The Style library remains available without a separate Style Prefix node.
"""
from __future__ import annotations

import json
import re
import hashlib
import shutil
from datetime import datetime, timezone
from pathlib import Path

from . import store

LIBRARY_ROOT = store.ROOT / 'libraries'
USER_LIBRARIES = store.DATA / 'libraries'
ID_RE = re.compile(r'^[a-z][a-z0-9_-]{0,63}$')
MAX_ENTRIES = 300
MAX_BYTES = 500_000
MAX_TAGS = 12_000
FORMAT = 'cpm-preset-library'
SLOT_RE = re.compile(r'^[a-z][a-z0-9_]{0,31}$')
MAX_VARIABLES = 8
MAX_FREE_TEXT = 2000  # Per-block user text, not stored inside shared libraries.

def _slug(text):
    slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')[:60]
    return slug or 'preset'


def _valid_id(value):
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ValueError('Library/preset id must be lowercase a-z, numbers, underscores or dashes (start with a letter)')
    return value


def validate_library(obj):
    if not isinstance(obj, dict) or obj.get('format') != FORMAT or obj.get('schema_version') != 1:
        raise ValueError('Expected cpm-preset-library schema_version 1 JSON')
    lib_id = _valid_id(obj.get('id'))
    title = obj.get('name')
    if not isinstance(title, str) or not title.strip() or len(title) > 120:
        raise ValueError('Invalid library name')
    raw_entries = obj.get('entries')
    if not isinstance(raw_entries, list) or len(raw_entries) > MAX_ENTRIES:
        raise ValueError(f'Entries must be a list of at most {MAX_ENTRIES}')
    kind = obj.get('kind', 'preset')
    if kind not in ('preset', 'modifier'):
        raise ValueError('Library kind must be preset or modifier')
    entries, ids = [], set()
    for row in raw_entries:
        if not isinstance(row, dict):
            raise ValueError('Each preset must be an object')
        name = row.get('name')
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            raise ValueError('Invalid preset name')
        item_id = _valid_id(row.get('id') or _slug(name))
        if item_id in ids:
            raise ValueError(f'Duplicate preset id: {item_id}')
        ids.add(item_id)
        for field in ('positive', 'negative', 'notes'):
            txt = row.get(field, '')
            if not isinstance(txt, str) or len(txt) > MAX_TAGS:
                raise ValueError(f'Invalid {field} in {name}')
        # Optional, per-entry placeholders. Unmodified v1 libraries remain valid.
        raw_variables = row.get('variables', {})
        if not isinstance(raw_variables, dict) or len(raw_variables) > MAX_VARIABLES:
            raise ValueError(f'Invalid variables in {name}; maximum {MAX_VARIABLES}')
        variables = {}
        for slot, config in raw_variables.items():
            if not isinstance(slot, str) or not SLOT_RE.fullmatch(slot):
                raise ValueError(f'Invalid variable slot in {name}: {slot}')
            if not isinstance(config, dict):
                raise ValueError(f'Invalid configuration for <{slot}>')
            kind = config.get('type', 'library')
            if kind not in ('library', 'text'):
                raise ValueError(f'Unknown variable type for <{slot}>')
            label = config.get('label', slot.replace('_', ' ').title())
            if not isinstance(label, str) or not label.strip() or len(label) > 50:
                raise ValueError(f'Invalid label for <{slot}>')
            if f'<{slot}>' not in row.get('positive', '') and f'<{slot}>' not in row.get('negative', ''):
                raise ValueError(f'Variable <{slot}> is not used in the preset text for {name}')
            if kind == 'text':
                placeholder = config.get('placeholder', '')
                if not isinstance(placeholder, str) or len(placeholder) > 100:
                    raise ValueError(f'Invalid placeholder for <{slot}>')
                variables[slot] = {'type': 'text', 'label': label.strip(), 'placeholder': placeholder}
            else:
                # Old schema remains byte-for-byte equivalent after validation.
                variables[slot] = {'label': label.strip(), 'library': _valid_id(config.get('library'))}
        clean_entry = {'id': item_id, 'name': name.strip(), 'positive': row.get('positive', ''),
                       'negative': row.get('negative', ''), 'notes': row.get('notes', '')}
        if variables:
            clean_entry['variables'] = variables
        entries.append(clean_entry)
    cleaned = {'format': FORMAT, 'schema_version': 1, 'id': lib_id,
               'name': title.strip(), 'entries': entries}
    if kind == 'modifier':
        cleaned['kind'] = 'modifier'
    if len(json.dumps(cleaned, ensure_ascii=False).encode('utf-8')) > MAX_BYTES:
        raise ValueError('Library exceeds 500 KB')
    return cleaned


def _paths_below(root):
    """Find JSON recursively, without following links outside the library root.

    An entry's JSON id is its identity. Folder and filename changes must never
    break a Composer block referencing that id. We intentionally do not require
    the filename to match the id: older packs used underscores in filenames.
    """
    root = Path(root)
    if not root.is_dir():
        return []
    safe_root = root.resolve()
    paths = []
    for path in root.rglob('*.json'):
        if not path.is_file() or not path.resolve().is_relative_to(safe_root):
            continue
        relative = path.relative_to(root)
        paths.append((relative, path))
    # Prefer files directly in libraries/ if a library has duplicate IDs.
    # Import writes to an existing personal file, avoiding new duplicates.
    paths.sort(key=lambda pair: (len(pair[0].parts), pair[0].as_posix().casefold()))
    return [p for _, p in paths]


def _records():
    records = {}
    for root, source in ((LIBRARY_ROOT, 'Bundled'), (USER_LIBRARIES, 'Personal')):
        seen_here = set()
        for path in _paths_below(root):
            try:
                content = validate_library(store._read_json(path, {}))
            except (ValueError, OSError):
                continue
            key = content['id']
            if key in seen_here:
                # Never silently replace one file with another in the same
                # folder tree. Root-level files win over deeper duplicates.
                continue
            seen_here.add(key)
            rel_folder = path.relative_to(root).parent
            folder = '' if rel_folder == Path('.') else rel_folder.as_posix()
            records[key] = {'library': content, 'path': path, 'folder': folder, 'source': source}
    return records


def _files():
    return {key: row['library'] for key, row in _records().items()}

def _style_library():
    entries = []
    existing = set()
    for style in store.list_styles():
        slug = _slug(style['name'])
        while slug in existing:
            slug += '-2'
        existing.add(slug)
        entries.append({'id': slug, 'name': style['name'], 'positive': style['positive_prefix'],
                        'negative': style['negative_prefix'], 'notes': style.get('notes', '')})
    return {'format': FORMAT, 'schema_version': 1, 'id': 'style', 'name': 'Style', 'entries': entries}


def list_libraries():
    records = _records()
    order = ['style', 'camera', 'composition', 'lighting']
    keys = [k for k in order if k == 'style' or k in records] + sorted(
        (k for k in records if k not in order),
        key=lambda k: (records[k]['folder'].casefold(), records[k]['library']['name'].casefold()))
    result = [{'id': 'style', 'name': 'Style', 'count': len(_style_library()['entries']),
               'source': 'Built-in / Personal', 'folder': '', 'kind': 'preset'}]
    result.extend({'id': k, 'name': records[k]['library']['name'],
                   'kind': records[k]['library'].get('kind', 'preset'),
                   'count': len(records[k]['library']['entries']),
                   'source': records[k]['source'], 'folder': records[k]['folder']}
                  for k in keys if k != 'style')
    return result

def get_library(lib_id):
    _valid_id(lib_id)
    if lib_id == 'style':
        return _style_library()
    value = _files().get(lib_id)
    if value is None:
        raise ValueError(f'Preset library "{lib_id}" is missing. Import its JSON or change the block.')
    return value


def get_preset(lib_id, preset_id):
    lib = get_library(lib_id)
    for p in lib['entries']:
        if p['id'] == preset_id:
            return p
    raise ValueError(f'Preset "{preset_id}" is missing from library "{lib_id}"')


def resolve_preset(entry, selections):
    """Replace declared <slots> with selected reusable modifier text.

    Unknown angle-bracket text is preserved; only explicit named variables are
    processed. An empty choice removes its token. No arbitrary template eval.
    """
    slots = entry.get('variables') or {}
    choices = selections if isinstance(selections, dict) else {}
    output = {polarity: entry.get(polarity, '') for polarity in ('positive', 'negative')}
    for slot, config in slots.items():
        chosen = choices.get(slot, '')
        if not isinstance(chosen, str):
            raise ValueError(f'Invalid value for variable <{slot}>')
        if config.get('type') == 'text':
            if len(chosen) > MAX_FREE_TEXT:
                raise ValueError(f'Free text for <{slot}> exceeds {MAX_FREE_TEXT} characters')
            replacements = {'positive': chosen.strip(), 'negative': chosen.strip()}
        elif chosen:
            # Reusable library selections remain IDs, not arbitrary text.
            _valid_id(chosen)
            modifier = get_preset(config['library'], chosen)
            # Positive is the modifier's shared value; a modifier-specific
            # negative text can be used in negative templates when supplied.
            replacements = {'positive': modifier['positive'],
                            'negative': modifier['negative'] or modifier['positive']}
        else:
            replacements = {'positive': '', 'negative': ''}
        for polarity in output:
            output[polarity] = output[polarity].replace(f'<{slot}>', replacements[polarity])
    if slots:
        for polarity, value in output.items():
            # Only normalize texts with declared variables; old presets retain
            # their literal spacing and punctuation.
            value = re.sub(r'[ \t]+', ' ', value)
            value = re.sub(r'\s+,', ',', value)
            value = re.sub(r',\s*,+', ', ', value)
            output[polarity] = value.strip(' ,\t\r\n')
    return output

def fingerprint(lib_id, preset_id):
    # Prompt output now comes exclusively from the preset text (including
    # per-preset negative tags), not from folder-based classifications.
    entry = get_preset(lib_id, preset_id)
    return json.dumps({'preset': entry}, sort_keys=True, ensure_ascii=False)


def import_library(payload):
    """Import an entire pack; bundled versions are never overwritten on disk.

    Style imports merge into the existing style collection, keeping past user
    styles available to Prompt Composer and the universal Preset Library node.
    """
    obj = validate_library(payload)
    if obj['id'] == 'style':
        for entry in obj['entries']:
            store.save_style({'name': entry['name'], 'positive_prefix': entry['positive'],
                              'negative_prefix': entry['negative'], 'notes': entry['notes']})
        return {'id': 'style', 'name': 'Style', 'imported': len(obj['entries']), 'source': 'Personal styles'}
    with store.LOCK:
        # Preserve a user's physical folder organization when re-importing.
        existing = next((p for p in _paths_below(USER_LIBRARIES)
                         if store._read_json(p, {}).get('id') == obj['id']), None)
        destination = existing or USER_LIBRARIES / (obj['id'] + '.json')
        store._write_json(destination, obj)
    return {'id': obj['id'], 'name': obj['name'], 'imported': len(obj['entries']), 'source': 'Personal library'}


def remove_user_library(lib_id):
    _valid_id(lib_id)
    if lib_id == 'style':
        raise ValueError('Built-in Style cannot be removed as a whole; edit its entries via imported style presets or the library editor')
    matches = []
    for path in _paths_below(USER_LIBRARIES):
        try:
            if store._read_json(path, {}).get('id') == lib_id:
                matches.append(path)
        except (ValueError, OSError):
            continue
    if not matches:
        raise ValueError('No imported library override exists for this ID')
    if len(matches) > 1:
        raise ValueError(f'Multiple personal files use library id "{lib_id}"; remove duplicates manually before deleting')
    with store.LOCK:
        matches[0].unlink()
    return {'id': lib_id, 'removed': True}


class LibraryConflict(ValueError):
    """The library changed after the editor loaded its original revision."""


def _revision(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def get_library_for_edit(lib_id):
    """Return library + ETag-like revision; never expose filesystem paths."""
    _valid_id(lib_id)
    if lib_id == 'style':
        return {'library': get_library('style'), 'revision': None,
                'editable': False, 'source': 'Built-in / Personal', 'folder': ''}
    record = _records().get(lib_id)
    if record is None:
        raise ValueError('Library not found: ' + lib_id)
    return {'library': record['library'], 'revision': _revision(record['path']),
            'editable': True, 'source': record['source'], 'folder': record['folder']}


def _folder_path(value):
    """An optional new-library location under data/libraries; no traversal."""
    if not isinstance(value, str) or len(value) > 220:
        raise ValueError('Invalid library folder')
    if not value:
        return Path('.')
    parts = value.replace('\\', '/').split('/')
    if len(parts) > 4 or any(not re.fullmatch(r'[\w &().-]{1,64}', part, re.UNICODE)
                           or part in ('.', '..') for part in parts):
        raise ValueError('Invalid folder path')
    return Path(*parts)


def save_library_edit(payload):
    """Explicit save for installed libraries, with revision checks and backup.

    Bundled sources remain untouched; saving one creates a user override.
    Editing an existing personal library preserves its physical folder/filename.
    """
    if not isinstance(payload, dict):
        raise ValueError('Expected an editor save request')
    lib = validate_library(payload.get('library'))
    lib_id = lib['id']
    if lib_id == 'style':
        raise ValueError('Style is managed through style presets; its aggregated library cannot be edited here')
    expected = payload.get('expected_revision')
    if expected is not None and (not isinstance(expected, str) or
                                 not re.fullmatch('[a-f0-9]{64}', expected)):
        raise ValueError('Invalid library revision')
    requested_folder = _folder_path(payload.get('folder', ''))
    with store.LOCK:
        records = _records()
        existing = records.get(lib_id)
        if existing:
            if expected != _revision(existing['path']):
                raise LibraryConflict('Library changed on disk. Reload it before saving so nothing is overwritten.')
        elif expected is not None:
            raise LibraryConflict('Library was removed or renamed. Reload the library browser.')
        personal_files = []
        for candidate in _paths_below(USER_LIBRARIES):
            try:
                if store._read_json(candidate, {}).get('id') == lib_id:
                    personal_files.append(candidate)
            except (ValueError, TypeError, OSError):
                # An invalid file must not make the editor overwrite it.
                continue
        if len(personal_files) > 1:
            raise LibraryConflict('Duplicate personal library IDs found. Resolve duplicates before saving.')
        destination = (personal_files[0] if personal_files else
                       USER_LIBRARIES / requested_folder / (lib_id + '.json'))
        # Do not permit a supplied folder to escape the personal root.
        if not destination.resolve().is_relative_to(USER_LIBRARIES.resolve()):
            raise ValueError('Invalid library location')
        if destination.exists() and not personal_files:
            raise LibraryConflict('A file with this library filename already exists. No files were overwritten.')
        if destination.exists():
            # Preserve the *actual* original bytes, even if formatting differs.
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            backup = store.DATA / 'library_backups' / lib_id / f'{stamp}-{_revision(destination)[:12]}.json'
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destination, backup)
        store._write_json(destination, lib)
        return {'id': lib_id, 'name': lib['name'], 'saved': len(lib['entries']),
                'revision': _revision(destination), 'source': 'Personal',
                'folder': '' if destination.parent == USER_LIBRARIES else destination.parent.relative_to(USER_LIBRARIES).as_posix(),
                'backup_created': bool(personal_files)}
