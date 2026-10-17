"""Private, explicit exports for Image Finisher; no automatic output files."""
from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from threading import RLock
import json
import re
import secrets
import os
import subprocess
import sys
import threading

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


def output_directory(folder='', *, create=False):
    """Allow only contained relative subfolders of ComfyUI/output."""
    if not isinstance(folder, str) or len(folder) > 320:
        raise ValueError('Invalid output folder')
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


_NATIVE_FOLDERS = {}  # OS-selected folders; never accept arbitrary paths supplied by browser.
_NATIVE_LOCK = RLock()

def _folder_from_choice(folder):
    if isinstance(folder, str) and folder.startswith('native:'):
        with _NATIVE_LOCK:
            target = _NATIVE_FOLDERS.get(folder)
        if target is None or not target.is_dir():
            raise ValueError('Selected Windows folder is no longer available; Browse again')
        return target
    return output_directory(folder)

def browse_native_folder():
    """Open the *server machine's* native Windows FolderBrowserDialog.

    Windows desktop-only.  A remote browser cannot make ComfyUI write to
    arbitrary local-client folders.  A token authorizes only a folder selected
    through this actual OS dialog during the current server session.
    """
    if sys.platform != 'win32':
        raise ValueError('Native folder selection requires a local Windows ComfyUI desktop session')
    base = str(_root()).replace("'", "''")
    ps = f"""[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose Image Finisher output folder'
$dialog.SelectedPath = '{base}'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::Out.Write($dialog.SelectedPath) }}
"""
    try:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-STA', '-Command', ps],
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except subprocess.TimeoutExpired:
        raise ValueError('Windows folder dialog timed out') from None
    if result.returncode:
        raise ValueError((result.stderr or 'Unable to open Windows folder dialog').strip()[:350])
    chosen = result.stdout.strip()
    if not chosen:
        return {'cancelled': True}
    target = Path(chosen).resolve()
    if not target.is_dir():
        raise ValueError('The selected Windows folder does not exist')
    token = 'native:' + secrets.token_urlsafe(22)
    with _NATIVE_LOCK:
        _NATIVE_FOLDERS[token] = target
    return {'folder': token, 'display': str(target)}

EXPORT_FORMATS = {'PNG': ('png', 'PNG'), 'JPEG': ('jpg', 'JPEG'),
                  'WEBP': ('webp', 'WEBP'), 'TIFF': ('tiff', 'TIFF'),
                  'BMP': ('bmp', 'BMP'), 'GIF': ('gif', 'GIF')}

def _export_image(source, destination, variant, summary, image_format):
    with Image.open(source) as source_image:
        # Use original RGB values and never mutate the preview image in place.
        im = source_image.convert('RGB')
        kwargs = {}
        if image_format == 'PNG':
            meta = PngImagePlugin.PngInfo()
            meta.add_text('image_finisher', json.dumps({'variant': variant, 'summary': summary}, ensure_ascii=False))
            kwargs['pnginfo'] = meta
        elif image_format == 'JPEG':
            kwargs.update(quality=95, subsampling=0, optimize=True)
        elif image_format == 'WEBP':
            kwargs.update(quality=95, method=5)
        elif image_format == 'GIF':
            im = im.quantize(colors=256)
        im.save(destination, format=EXPORT_FORMATS[image_format][1], **kwargs)

def _png_image(sample, path):
    pixels = (sample.detach().cpu().numpy().clip(0, 1) * 255).astype(np.uint8)
    Image.fromarray(pixels).save(path, format='PNG')


def store_preview(original, detailed, summary='', enabled=True):
    import folder_paths
    temp = Path(folder_paths.get_temp_directory())
    temp.mkdir(parents=True, exist_ok=True)
    images = []
    for before, after in zip(original, detailed):
        token = secrets.token_urlsafe(24)
        short = secrets.token_hex(10)
        original_name = f'cpm_finisher_{short}_original.png'
        detailed_name = f'cpm_finisher_{short}_detailed.png'
        before_path, after_path = temp / original_name, temp / detailed_name
        _png_image(before, before_path)
        _png_image(after, after_path)
        with _LOCK:
            _PREVIEWS[token] = {'original': before_path, 'detailed': after_path, 'summary': summary, 'enabled': enabled}
            _PREVIEWS.move_to_end(token)
            while len(_PREVIEWS) > _MAX_PREVIEWS:
                _PREVIEWS.popitem(last=False)
        images.append({'original': {'filename': original_name, 'type': 'temp', 'subfolder': '', 'width': int(before.shape[1]), 'height': int(before.shape[0])},
                       'detailed': {'filename': detailed_name, 'type': 'temp', 'subfolder': '', 'width': int(after.shape[1]), 'height': int(after.shape[0])},
                       'token': token})
    return images


def save_preview(token, variant, folder='', image_format='PNG', placement='suffix', detail_label='_Detailed'):
    if not isinstance(token, str) or len(token) > 128:
        raise ValueError('Invalid preview token')
    if variant not in ('original', 'detailed', 'all'):
        raise ValueError('Choose Original, Detailed or All')
    image_format = str(image_format).upper()
    if image_format == 'JPG':
        image_format = 'JPEG'
    if image_format not in EXPORT_FORMATS:
        raise ValueError('Unsupported image export format')
    if placement not in ('prefix', 'suffix'):
        raise ValueError('Detailed naming must use a prefix or suffix')
    if not isinstance(detail_label, str) or not (1 <= len(detail_label) <= 64):
        raise ValueError('Detailed filename label must contain 1–64 characters')
    if any(ch not in ' -_().0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' for ch in detail_label):
        raise ValueError('Detailed filename label contains invalid characters')
    if not detail_label.strip(' _'):
        raise ValueError('Detailed filename label must contain text')
    dest = _folder_from_choice(folder)
    with _LOCK:
        item = _PREVIEWS.get(token)
        if item is None:
            raise ValueError('Preview expired. Run Image Finisher again.')
        if not item['enabled'] and variant != 'original':
            raise ValueError('Finisher is OFF; only Original can be saved')
        selected = ('original', 'detailed') if variant == 'all' else (variant,)
        stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        stem = f'ImageFinisher_{stamp}_{secrets.token_hex(3)}'
        extension = EXPORT_FORMATS[image_format][0]
        saved = []
        for name in selected:
            source = item[name]
            if not source.is_file():
                raise ValueError(f'{name.capitalize()} preview no longer available')
            decorated = (detail_label + stem) if placement == 'prefix' else (stem + detail_label)
            filename = f'{decorated if name == "detailed" else stem}.{extension}'
            dest_path = dest / filename
            try:
                # Exclusive create, so never overwrite existing images.
                with dest_path.open('xb') as stream:
                    _export_image(source, stream, name, item['summary'], image_format)
            except Exception:
                dest_path.unlink(missing_ok=True)
                raise
            saved.append({'filename': filename, 'subfolder': folder if not folder.startswith('native:') else '', 'type': 'output'})
    return {'images': saved, 'folder': folder, 'destination': str(dest)}
