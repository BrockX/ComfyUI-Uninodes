"""Output-folder selector shared in behavior with Image Finisher."""
from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from threading import RLock
import json
import re
import secrets
import sys
import subprocess

from PIL import Image, PngImagePlugin
import numpy as np

_LOCK = RLock()
_PREVIEWS = OrderedDict()
_MAX_PREVIEWS = 80


def _root():
    import folder_paths
    root = Path(folder_paths.get_output_directory()).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


_SELECTED = {}

def browse_native_folder():
    if sys.platform != 'win32':
        raise ValueError('Native folder selection requires a local Windows desktop ComfyUI')
    base = str(_root()).replace("'", "''")
    script = f"""[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose Direct Sampler output folder'
$dialog.SelectedPath = '{base}'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::Out.Write($dialog.SelectedPath) }}
"""
    try:
        proc = subprocess.run(['powershell.exe','-NoProfile','-STA','-Command',script], capture_output=True,
                              text=True, encoding='utf-8', errors='replace', timeout=180, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    except subprocess.TimeoutExpired:
        raise ValueError('Folder picker timed out') from None
    if proc.returncode:
        raise ValueError((proc.stderr or 'Unable to open Windows folder picker').strip()[:350])
    text=proc.stdout.strip()
    if not text:
        return {'cancelled':True}
    selected=Path(text).resolve()
    if not selected.is_dir():
        raise ValueError('Selected folder does not exist')
    key='native:'+secrets.token_urlsafe(22)
    with _LOCK:
        _SELECTED[key]=selected
    return {'folder':key,'display':str(selected)}


def output_directory(folder='', *, create=False):
    """Allow only contained relative subfolders of ComfyUI/output."""
    if not isinstance(folder, str) or len(folder) > 320:
        raise ValueError('Invalid output folder')
    if folder.startswith('native:'):
        with _LOCK:
            chosen=_SELECTED.get(folder)
        if not chosen or not chosen.is_dir():
            raise ValueError('Windows folder selection expired; Browse again')
        return chosen
    path = folder.strip().replace('\\', '/')
    if path in ('', '.'):
        return _root()
    if path.startswith('/') or re.match(r'^[A-Za-z]:', path) or any(c in path for c in '\x00\r\n'):
        raise ValueError('Choose a subfolder of the ComfyUI output directory')
    parts = path.split('/')
    if any(p in ('', '.', '..') or not re.fullmatch(r'[\w.\- ()]+', p, re.UNICODE) for p in parts):
        raise ValueError('Invalid folder name')
    root = _root()
    dest = (root / '/'.join(parts)).resolve()
    if root not in dest.parents:
        raise ValueError('Folder must stay inside ComfyUI/output')
    if create:
        dest.mkdir(parents=True, exist_ok=True)
    if not dest.is_dir():
        raise ValueError('Output folder does not exist')
    return dest


def list_folders():
    """Walk directories only; do not enumerate the user's potentially huge PNG files."""
    root = _root()
    out = ['']
    pending = [(root, 0)]
    while pending and len(out) < 400:
        parent, depth = pending.pop(0)
        if depth >= 5:
            continue
        try:
            children = sorted((child for child in parent.iterdir() if child.is_dir() and not child.is_symlink()), key=lambda x: x.name.casefold())
        except OSError:
            continue
        for child in children:
            try:
                relative = child.relative_to(root).as_posix()
                output_directory(relative)
            except (ValueError, OSError):
                continue
            out.append(relative)
            pending.append((child, depth + 1))
            if len(out) >= 400:
                break
    return out

