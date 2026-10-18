"""Write opt-in image metadata for Uninodes' manual/autosave paths.

Use ComfyUI's standard PNG keys (prompt/workflow) when present, plus readable
A1111-style parameters and a structured Uninodes record. Formats with less
portable metadata support get conventional EXIF/comment tags instead.
"""
from __future__ import annotations

import json
from PIL import PngImagePlugin


def compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), default=str)


def generation_parameters(data):
    if not isinstance(data, dict):
        return ''
    prompts = data.get('prompts') or {}
    gen = data.get('metadata') or {}
    positive = str(prompts.get('positive_text') or '').strip()
    negative = str(prompts.get('negative_text') or '').strip()
    result = [positive] if positive else []
    if negative:
        result.append('Negative prompt: ' + negative)
    details = []
    for label, key in [('Steps','steps'), ('Sampler','sampler'), ('Schedule type','scheduler'),
                       ('CFG scale','cfg')]:
        if gen.get(key) is not None:
            details.append(f'{label}: {gen[key]}')
    if data.get('seed') is not None:
        details.append(f'Seed: {data["seed"]}')
    if gen.get('width') and gen.get('height'):
        details.append(f'Size: {gen["width"]}x{gen["height"]}')
    if data.get('checkpoint'):
        details.append(f'Model: {data["checkpoint"]}')
    if gen.get('vae_name') not in (None, '', 'Internal'):
        details.append(f'VAE: {gen["vae_name"]}')
    if details:
        result.append(', '.join(details))
    return '\n'.join(result)


def _metadata_fields(data, namespace):
    payload = dict(data) if isinstance(data, dict) else {}
    graph = payload.pop('workflow', None)
    prompt = payload.pop('prompt', None)
    fields = {namespace: compact_json(payload)}
    params = generation_parameters(data)
    if params:
        fields['parameters'] = params
    if prompt is not None:
        fields['prompt'] = compact_json(prompt)
    if graph is not None:
        fields['workflow'] = compact_json(graph)
    return fields


def save_kwargs(image_format, metadata=None, namespace='uninodes', embed_metadata=True):
    """Return PIL.save kwargs. Never copy EXIF or metadata from source previews."""
    fmt = str(image_format).upper()
    options = {}
    if fmt == 'JPEG':
        options.update(quality=95, subsampling=0, optimize=True)
    elif fmt == 'WEBP':
        options.update(quality=95, method=5)
    if not embed_metadata or not metadata:
        return options

    fields = _metadata_fields(metadata, namespace)
    if fmt == 'PNG':
        info = PngImagePlugin.PngInfo()
        for name, value in fields.items():
            info.add_text(name, value)
        options['pnginfo'] = info
    elif fmt in ('JPEG', 'WEBP'):
        # CivitAI and other apps can inspect standard EXIF image description,
        # while our complete payload is held in UserComment whenever it fits.
        from PIL import Image
        exif = Image.Exif()
        desc = fields.get('parameters') or fields.get(namespace, '')
        # A JPEG APP1 EXIF section tops out around 64 KiB including all tags.
        if fmt == 'JPEG':
            desc = desc[:12_000]
        if desc:
            exif[270] = desc
        encoded = compact_json(fields).encode('utf-8')
        if fmt == 'JPEG' and len(encoded) > 39000:
            # Big graphs exceed JPEG's EXIF limit: retain the generation data
            # rather than making the image save fail. PNG/WebP/TIFF preserve
            # the complete original ComfyUI graph.
            reduced = {k: v for k, v in fields.items() if k not in ('workflow', 'prompt')}
            encoded = compact_json(reduced).encode('utf-8')
        if fmt == 'JPEG' and len(encoded) > 39000:
            encoded = compact_json({'parameters': desc, 'model': (metadata or {}).get('checkpoint'),
                                    'seed': (metadata or {}).get('seed')}).encode('utf-8')
        if len(encoded) <= (39000 if fmt == 'JPEG' else 2_000_000):
            exif[37510] = b'ASCII\x00\x00\x00' + encoded
        options['exif'] = exif.tobytes()
    elif fmt == 'TIFF':
        from PIL import TiffImagePlugin
        ifd = TiffImagePlugin.ImageFileDirectory_v2()
        ifd[270] = fields.get('parameters') or fields.get(namespace, '')
        ifd[305] = 'Uninodes'
        ifd[37510] = compact_json(fields).encode('utf-8')
        options['tiffinfo'] = ifd
    elif fmt == 'GIF':
        options['comment'] = compact_json(fields).encode('utf-8')
    # BMP has no dependable standard image-metadata container.
    return options
