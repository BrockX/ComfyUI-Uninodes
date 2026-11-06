"""Discover local companions from bounded Safetensors headers, without weights."""
from __future__ import annotations

import itertools
import json
import math
import struct
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=256)
def _header(path, mtime, size):
    if size < 10:
        return {}
    try:
        with open(path, 'rb') as stream:
            length = struct.unpack('<Q', stream.read(8))[0]
            if length > min(16 * 1024 * 1024, size - 8):
                return {}
            data = json.loads(stream.read(length))
        if not isinstance(data, dict):
            return {}
        # Validate declared tensor ranges and sizes without reading their payloads.
        ranges = []
        widths = {'F64': 8, 'I64': 8, 'F32': 4, 'I32': 4, 'U32': 4,
                  'F16': 2, 'BF16': 2, 'I16': 2, 'U16': 2, 'BOOL': 1,
                  'U8': 1, 'I8': 1, 'F8_E4M3': 1, 'F8_E5M2': 1, 'F8_E4M3FN': 1}
        for key, tensor in data.items():
            if key == '__metadata__':
                continue
            shape, offsets = tensor['shape'], tensor['data_offsets']
            if not isinstance(shape, list) or any(type(n) is not int or n < 0 for n in shape):
                return {}
            if len(offsets) != 2 or any(type(n) is not int for n in offsets):
                return {}
            start, end = offsets
            if not 0 <= start <= end <= size - 8 - length:
                return {}
            width = widths.get(tensor['dtype'])
            if width is None or math.prod(shape) * width != end - start:
                return {}
            if end > start:
                ranges.append((start, end))
        ranges.sort()
        if any(a[1] > b[0] for a, b in zip(ranges, ranges[1:])):
            return {}
        return data
    except (OSError, ValueError, KeyError, TypeError, AttributeError, struct.error):
        return {}


def header(path):
    try:
        info = Path(path).stat()
        return _header(str(path), info.st_mtime_ns, info.st_size)
    except (OSError, TypeError):
        return {}


def identify(data, category):
    def shape(suffix, dimensions):
        return any(key.endswith(suffix) and value.get('shape') == dimensions
                   for key, value in data.items() if isinstance(value, dict))
    if category == 'vae':
        if (shape('conv2.weight', [16, 16, 1, 1, 1])
                and shape('encoder.conv1.weight', [96, 3, 3, 3, 3])
                and shape('decoder.conv1.weight', [384, 16, 3, 3, 3])):
            return 'wan16'
        if (shape('bn.running_mean', [128]) and shape('bn.running_var', [128])
                and shape('decoder.conv_in.weight', [512, 32, 3, 3])):
            return 'flux2_vae'
        if (shape('decoder.conv_in.weight', [512, 16, 3, 3])
                and shape('encoder.conv_in.weight', [128, 3, 3, 3])):
            return 'flux_vae'
        return None
    if shape('embed_tokens.weight', [151936, 1024]) and shape('layers.27.mlp.up_proj.weight', [3072, 1024]):
        return 'qwen3_06b'
    visual = any('visual.' in key for key in data)
    if shape('embed_tokens.weight', [151936, 2560]) and shape('layers.0.self_attn.q_norm.weight', [128]):
        return 'qwen3vl_4b' if visual else 'qwen3_4b'
    if shape('embed_tokens.weight', [151936, 4096]) and shape('layers.0.self_attn.q_norm.weight', [128]):
        return 'qwen3vl_8b' if visual else 'qwen3_8b'
    if shape('token_embedding.weight', [49408, 768]):
        return 'clip_l'
    if shape('token_embedding.weight', [49408, 1280]):
        return 'clip_g'
    if shape('shared.weight', [32128, 4096]) and shape('encoder.block.23.layer.0.SelfAttention.k.weight', [4096, 4096]):
        return 't5xxl'
    if shape('embed_tokens.weight', [256000, 2304]):
        return 'gemma2_2b'
    return None


# Requirements are separate from filenames: fine-tuned and renamed files can match.
REQUIREMENTS = {
    'anima': (['qwen3_06b'], 'wan16'),
    'krea2': (['qwen3vl_4b'], 'wan16'),
    'flux': (['clip_l', 't5xxl'], 'flux_vae'),
    'flux2_klein_4b': (['qwen3_4b'], 'flux2_vae'),
    'flux2_klein_9b': (['qwen3_8b'], 'flux2_vae'),
    'flux2': ([None], 'flux2_vae'),
    'sd3': (['clip_l', 'clip_g', 't5xxl'], 'flux_vae'),
    'hidream': (['clip_l', 'clip_g', 't5xxl', None], 'flux_vae'),
    'hunyuan_image': ([None, None], None),
    'omnigen2': ([None], 'flux_vae'),
    'chroma': (['t5xxl'], 'flux_vae'),
    'lumina2': (['gemma2_2b'], 'flux_vae'),
    'z_image': (['qwen3_4b'], 'flux_vae'),
    'qwen_image': ([None], 'wan16'),
}


def selected_family(selection, fallback):
    import folder_paths
    category = 'diffusion_models' if selection.startswith('[Diffusion] ') else 'checkpoints'
    name = selection[len('[Diffusion] '):] if category == 'diffusion_models' else selection
    path = folder_paths.get_full_path(category, name) if name else None
    data = header(path) if path else {}
    keys = [key.replace('_', '.').lower() for key in data]
    if any('llm.adapter.' in key for key in keys):
        return 'anima'
    if any('txtfusion.projector' in key for key in keys):
        return 'krea2'
    if any('double.stream.modulation.img.lin.weight' in key for key in keys):
        dims = next((value.get('shape', []) for key, value in data.items()
                     if key.endswith('txt_in.weight') and isinstance(value, dict)), [])
        return {7680: 'flux2_klein_4b', 12288: 'flux2_klein_9b', 15360: 'flux2'}.get(dims[-1] if dims else None, 'unknown')
    return fallback


def choices(family, recipes):
    import folder_paths
    recipe = recipes.get(family)
    detected = {}
    valid = {}
    files = {}
    for category in ('text_encoders', 'vae'):
        files[category] = sorted(folder_paths.get_filename_list(category) or [], key=str.casefold)
        for name in files[category]:
            path = folder_paths.get_full_path(category, name)
            data = header(path) if path else {}
            valid[category, name] = bool(data)
            detected[category, name] = identify(data, category)
    clips = []
    compatible_vaes = []
    if recipe:
        layout, kind, encoder_groups, vae_names = recipe
        required_encoders, required_vae = REQUIREMENTS.get(family, ([None] * len(encoder_groups), None))
        groups = []
        for identity, basenames in zip(required_encoders, encoder_groups):
            names = [name for name in files['text_encoders']
                     if valid['text_encoders', name] and ((identity and detected['text_encoders', name] == identity)
                         or ((identity is None or detected['text_encoders', name] is None)
                             and Path(name.replace('\\', '/')).name.casefold() in {x.casefold() for x in basenames}))]
            # Exact recipe names rank ahead of otherwise compatible architectures.
            groups.append(sorted(names, key=lambda name: (Path(name.replace('\\', '/')).name.casefold() not in {x.casefold() for x in basenames}, name.casefold())))
        for names in itertools.islice(itertools.product(*groups), 64):
            clips.append({'value': json.dumps([layout, kind or 'stable_diffusion', list(names)], separators=(',', ':')),
                          'label': ' + '.join(names), 'compatible': True})
        compatible_vaes = [name for name in files['vae']
                           if valid['vae', name] and ((required_vae and detected['vae', name] == required_vae)
                               or ((required_vae is None or detected['vae', name] is None) and Path(name.replace('\\', '/')).name.casefold() in {x.casefold() for x in vae_names}))]
        compatible_vaes.sort(key=lambda name: (Path(name.replace('\\', '/')).name.casefold() not in {x.casefold() for x in vae_names}, name.casefold()))
    covered = {name for choice in clips for name in json.loads(choice['value'])[2]}
    for name in files['text_encoders']:
        if name not in covered:
            kind = recipe[1] if recipe and recipe[0] == 'single' else 'stable_diffusion'
            clips.append({'value': json.dumps(['single', kind, [name]], separators=(',', ':')),
                          'label': name, 'compatible': False})
    ordered_vaes = compatible_vaes + [name for name in files['vae'] if name not in compatible_vaes]
    vaes = [{'value': name, 'label': name, 'compatible': name in compatible_vaes} for name in ordered_vaes]
    return {'family': family, 'clips': clips, 'vaes': vaes,
            'recommended_clip': next((item['value'] for item in clips if item['compatible']), None),
            'recommended_vae': compatible_vaes[0] if compatible_vaes else None}
