"""Direct Sampler backend. Independent of Checkpoint Profile Manager."""
from __future__ import annotations

import base64
import io
import json
import math
import secrets
import shutil
import threading
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path

DEFAULT = {
    "steps": 28, "cfg": 5.0, "sampler_name": "euler_ancestral", "scheduler": "normal",
    "width": 1024, "height": 1024, "batch_size": 1, "clip_skip": -1, "vae_name": "Internal",
    "clip_source": "Internal", "encoder_loader": "single", "encoder_type": "stable_diffusion",
    "encoder_1": "", "encoder_2": "", "encoder_3": "", "encoder_4": "", "denoise": 1.0, "loras": [], "apply_profile_prefixes": False,
    "positive_prefix": "", "negative_prefix": "",
    "resolution_category": "SDXL", "resolution_preset": "custom",
    "mode": "t2i", "i2i_strength": "Balanced", "i2i_resolution_mode": "source",
    "internal_init_image": None,
    "preview_layout": "studio", "show_sockets": {}, "seed_after_generate": "randomize",
}
PORTS = ("latent", "lora_stack", "model", "clip", "vae", "positive_conditioning", "negative_conditioning", "init_image", "mask", "latent_output", "conditioning_outputs")
MAX_LORAS = 16
_LIMIT = 256
LOCK = threading.RLock()
PREVIEWS = OrderedDict()


def settings(raw):
    try:
        data = raw if isinstance(raw, dict) else json.loads(raw or "{}")
    except (ValueError, TypeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    result = {**DEFAULT, **data}
    result["show_sockets"] = {k: bool(result.get("show_sockets", {}).get(k)) for k in PORTS} if isinstance(result.get("show_sockets"), dict) else {}
    if result.get("seed_after_generate") not in ("fixed", "increment", "decrement", "randomize"):
        result["seed_after_generate"] = "randomize"
    if result.get("vae_name") in ("Embedded", "embedded"):
        result["vae_name"] = "Internal"
    if result.get("clip_source") not in ("Internal", "External", "Manual"):
        result["clip_source"] = "Internal"
    if result.get("encoder_loader") not in ("single", "dual", "triple", "quad"):
        result["encoder_loader"] = "single"
    result["encoder_type"] = str(result.get("encoder_type") or "stable_diffusion")
    for number in range(1, 5):
        result[f"encoder_{number}"] = str(result.get(f"encoder_{number}") or "")
    if result.get("mode") not in ("t2i", "i2i"):
        result["mode"] = "t2i"
    if result.get("i2i_strength") not in ("Preserve", "Near", "Guided", "Balanced", "Creative", "Free"):
        result["i2i_strength"] = "Balanced"
    if result.get("i2i_resolution_mode") not in ("source", "model_safe"):
        result["i2i_resolution_mode"] = "source"
    if not isinstance(result.get("internal_init_image"), dict):
        result["internal_init_image"] = None
    if not isinstance(result.get("loras"), list):
        result["loras"] = []
    return result


def validate_settings(value, *, allowed_loras=None):
    cfg = settings(value)
    for key in ("positive_prefix", "negative_prefix"):
        if not isinstance(cfg[key], str) or len(cfg[key]) > 12000:
            raise ValueError(f"Invalid {key}: expected text up to 12000 characters")
    def integer(key, low, high):
        v = cfg[key]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not float(v).is_integer() or not low <= v <= high:
            raise ValueError(f"Invalid {key}: expected {low}–{high}")
        cfg[key] = int(v)
    for key, low, high in (("steps",1,150), ("width",64,4096), ("height",64,4096), ("batch_size",1,8), ("clip_skip",-12,-1)):
        integer(key, low, high)
    if cfg["width"]%8 or cfg["height"]%8:
        raise ValueError("Resolution must be a multiple of 8")
    for key, low, high in (("cfg",0,30), ("denoise",0,1)):
        v=cfg[key]
        if isinstance(v, bool) or not isinstance(v,(int,float)) or not math.isfinite(float(v)) or not low <= v <= high:
            raise ValueError(f"Invalid {key}: expected {low}–{high}")
        cfg[key] = float(v)
    if len(cfg["loras"]) > MAX_LORAS:
        raise ValueError("Too many LoRAs (maximum 16)")
    entries=[]
    for entry in cfg["loras"]:
        if not isinstance(entry,dict):
            raise ValueError("Invalid LoRA entry")
        name=str(entry.get("name", ""))
        if name and (len(name)>512 or name.startswith(("/","\\")) or ".." in name.replace("\\","/").split("/")):
            raise ValueError("Invalid LoRA name")
        if allowed_loras is not None and name and name not in allowed_loras:
            raise ValueError(f"LoRA not installed: {name}")
        strengths=[]
        for key in ("strength_model", "strength_clip"):
            v=entry.get(key,1.0)
            if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(float(v)) or not -5 <= v <= 5:
                raise ValueError(f"Invalid LoRA {key}")
            strengths.append(float(v))
        trigger=str(entry.get("trigger",""))
        if len(trigger)>1000:
            raise ValueError("LoRA trigger too long")
        entries.append({"name": name, "enabled":entry.get("enabled",True) is not False,
                        "strength_model":strengths[0], "strength_clip":strengths[1],
                        "trigger":trigger, "use_trigger":bool(entry.get("use_trigger",False))})
    cfg["loras"]=entries
    return cfg


I2I_STRENGTHS = {
    "Preserve": 0.15,
    "Near": 0.28,
    "Guided": 0.40,
    "Balanced": 0.55,
    "Creative": 0.72,
    "Free": 0.88,
}

def _safe_subpath(name):
    value=str(name or '').replace('\\','/').strip('/')
    if not value or '..' in value.split('/'):
        raise ValueError('Invalid source image path')
    return value

def resolve_internal_source(ref):
    import folder_paths
    if not isinstance(ref, dict):
        raise ValueError('Invalid internal source image')
    filename=_safe_subpath(ref.get('filename',''))
    subfolder=ref.get('subfolder','direct_sampler_sources') or 'direct_sampler_sources'
    subfolder=_safe_subpath(subfolder)
    root=Path(folder_paths.get_input_directory())
    path=(root/subfolder/filename).resolve()
    if root.resolve() not in path.parents:
        raise ValueError('Source image path escapes input directory')
    if not path.is_file():
        raise ValueError('Source image not found')
    return path

def load_internal_source_image(ref):
    import numpy as np
    import torch
    from PIL import Image, ImageOps
    path=resolve_internal_source(ref)
    image=ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    arr=np.asarray(image).astype(np.float32)/255.0
    tensor=torch.from_numpy(arr)[None,]
    return tensor

def resize_image_tensor(image, width, height):
    import torch
    import torch.nn.functional as F
    if image is None:
        return image
    h=int(image.shape[1]); w=int(image.shape[2])
    if h==int(height) and w==int(width):
        return image
    chw=image.permute(0,3,1,2)
    resized=F.interpolate(chw, size=(int(height), int(width)), mode='bilinear', align_corners=False)
    return resized.permute(0,2,3,1).contiguous()


RESOLUTION_PRESETS = {
    "Standard": [
        {
            "id": "standard_1_1_square",
            "name": "1:1 Square",
            "width": 512,
            "height": 512
        },
        {
            "id": "standard_1_2_tall",
            "name": "1:2 Tall",
            "width": 512,
            "height": 1024
        },
        {
            "id": "standard_1_3_ultra_tall",
            "name": "1:3 Ultra Tall",
            "width": 512,
            "height": 1536
        },
        {
            "id": "standard_2_3_portrait",
            "name": "2:3 Portrait",
            "width": 512,
            "height": 768
        },
        {
            "id": "standard_3_4_portrait",
            "name": "3:4 Portrait",
            "width": 576,
            "height": 768
        },
        {
            "id": "standard_4_5_portrait",
            "name": "4:5 Portrait",
            "width": 512,
            "height": 640
        },
        {
            "id": "standard_4_7_phone",
            "name": "4:7 Phone",
            "width": 512,
            "height": 896
        },
        {
            "id": "standard_5_12_banner",
            "name": "5:12 Banner",
            "width": 512,
            "height": 1228
        },
        {
            "id": "standard_7_9_vertical",
            "name": "7:9 Vertical",
            "width": 512,
            "height": 658
        },
        {
            "id": "standard_9_16_mobile",
            "name": "9:16 Mobile",
            "width": 576,
            "height": 1024
        },
        {
            "id": "standard_9_21_ultra_mobile",
            "name": "9:21 Ultra Mobile",
            "width": 512,
            "height": 1194
        },
        {
            "id": "standard_10_16_monitor",
            "name": "10:16 Monitor",
            "width": 640,
            "height": 1024
        },
        {
            "id": "standard_13_19_tall_screen",
            "name": "13:19 Tall Screen",
            "width": 512,
            "height": 748
        },
        {
            "id": "standard_3_2_landscape",
            "name": "3:2 Landscape",
            "width": 768,
            "height": 512
        },
        {
            "id": "standard_4_3_classic",
            "name": "4:3 Classic",
            "width": 512,
            "height": 384
        },
        {
            "id": "standard_16_9_widescreen",
            "name": "16:9 Widescreen",
            "width": 768,
            "height": 432
        },
        {
            "id": "standard_21_9_ultrawide",
            "name": "21:9 Ultrawide",
            "width": 1024,
            "height": 439
        }
    ],
    "SDXL": [
        {
            "id": "sdxl_1_1_square",
            "name": "1:1 Square",
            "width": 1024,
            "height": 1024
        },
        {
            "id": "sdxl_3_4_portrait",
            "name": "3:4 Portrait",
            "width": 768,
            "height": 1024
        },
        {
            "id": "sdxl_4_5_portrait",
            "name": "4:5 Portrait",
            "width": 915,
            "height": 1144
        },
        {
            "id": "sdxl_5_12_portrait",
            "name": "5:12 Portrait",
            "width": 640,
            "height": 1536
        },
        {
            "id": "sdxl_7_9_portrait",
            "name": "7:9 Portrait",
            "width": 896,
            "height": 1152
        },
        {
            "id": "sdxl_9_16_portrait",
            "name": "9:16 Portrait",
            "width": 768,
            "height": 1344
        },
        {
            "id": "sdxl_13_19_portrait",
            "name": "13:19 Portrait",
            "width": 832,
            "height": 1216
        },
        {
            "id": "sdxl_2_3_portrait",
            "name": "2:3 Portrait",
            "width": 832,
            "height": 1216
        }
    ],
    "Flux": [
        {
            "id": "flux_1_1_square_standard",
            "name": "1:1 Square (Standard)",
            "width": 1024,
            "height": 1024
        },
        {
            "id": "flux_1_1_square_medium",
            "name": "1:1 Square (Medium)",
            "width": 1408,
            "height": 1408
        },
        {
            "id": "flux_1_1_square_high",
            "name": "1:1 Square (High)",
            "width": 1440,
            "height": 1440
        },
        {
            "id": "flux_2_3_portrait",
            "name": "2:3 Portrait",
            "width": 832,
            "height": 1248
        },
        {
            "id": "flux_3_4_portrait",
            "name": "3:4 Portrait",
            "width": 896,
            "height": 1184
        },
        {
            "id": "flux_4_5_portrait",
            "name": "4:5 Portrait",
            "width": 928,
            "height": 1152
        },
        {
            "id": "flux_9_16_portrait",
            "name": "9:16 Portrait",
            "width": 768,
            "height": 1344
        },
        {
            "id": "flux_9_21_portrait",
            "name": "9:21 Portrait",
            "width": 672,
            "height": 1440
        }
    ],
    "Flux.2": [
        {
            "id": "flux_2_1_1_square",
            "name": "1:1 Square",
            "width": 2048,
            "height": 2048
        },
        {
            "id": "flux_2_1_1_square_native",
            "name": "1:1 Square Native",
            "width": 2336,
            "height": 2336
        },
        {
            "id": "flux_2_2_3_portrait",
            "name": "2:3 Portrait",
            "width": 1632,
            "height": 2448
        },
        {
            "id": "flux_2_3_4_portrait",
            "name": "3:4 Portrait",
            "width": 1728,
            "height": 2304
        },
        {
            "id": "flux_2_4_5_portrait",
            "name": "4:5 Portrait",
            "width": 1792,
            "height": 2240
        },
        {
            "id": "flux_2_9_16_portrait",
            "name": "9:16 Portrait",
            "width": 1472,
            "height": 2624
        },
        {
            "id": "flux_2_3_2_landscape",
            "name": "3:2 Landscape",
            "width": 2448,
            "height": 1632
        },
        {
            "id": "flux_2_4_3_landscape",
            "name": "4:3 Landscape",
            "width": 2304,
            "height": 1728
        },
        {
            "id": "flux_2_16_9_landscape",
            "name": "16:9 Landscape",
            "width": 2624,
            "height": 1472
        },
        {
            "id": "flux_2_21_9_ultrawide",
            "name": "21:9 Ultrawide",
            "width": 2912,
            "height": 1248
        }
    ],
    "WAN": [
        {
            "id": "wan_1_1_square_1024_t2i",
            "name": "1:1 Square-1024 (T2I)",
            "width": 1024,
            "height": 1024
        },
        {
            "id": "wan_16_9_landscape_1280",
            "name": "16:9 Landscape-1280",
            "width": 1280,
            "height": 720
        },
        {
            "id": "wan_16_9_landscape_832",
            "name": "16:9 Landscape-832",
            "width": 832,
            "height": 480
        },
        {
            "id": "wan_1_1_square_512",
            "name": "1:1 Square-512",
            "width": 512,
            "height": 512
        },
        {
            "id": "wan_1_1_square_768",
            "name": "1:1 Square-768",
            "width": 768,
            "height": 768
        },
        {
            "id": "wan_1_1_square_720",
            "name": "1:1 Square-720",
            "width": 720,
            "height": 720
        },
        {
            "id": "wan_2_3_portrait",
            "name": "2:3 Portrait",
            "width": 588,
            "height": 882
        },
        {
            "id": "wan_3_4_portrait",
            "name": "3:4 Portrait",
            "width": 624,
            "height": 832
        },
        {
            "id": "wan_9_21_portrait",
            "name": "9:21 Portrait",
            "width": 549,
            "height": 1280
        },
        {
            "id": "wan_3_2_landscape",
            "name": "3:2 Landscape",
            "width": 1080,
            "height": 720
        },
        {
            "id": "wan_4_3_landscape",
            "name": "4:3 Landscape",
            "width": 960,
            "height": 720
        },
        {
            "id": "wan_21_9_landscape",
            "name": "21:9 Landscape",
            "width": 1680,
            "height": 720
        }
    ],
    "HiDream Dev": [
        {
            "id": "hidream_dev_1_1_square_1024",
            "name": "1:1 Square-1024",
            "width": 1024,
            "height": 1024
        },
        {
            "id": "hidream_dev_1_1_square_1280",
            "name": "1:1 Square-1280",
            "width": 1280,
            "height": 1280
        },
        {
            "id": "hidream_dev_1_1_square_1536",
            "name": "1:1 Square-1536",
            "width": 1536,
            "height": 1536
        },
        {
            "id": "hidream_dev_16_9_landscape",
            "name": "16:9 Landscape",
            "width": 1360,
            "height": 768
        },
        {
            "id": "hidream_dev_3_2_landscape",
            "name": "3:2 Landscape",
            "width": 1248,
            "height": 832
        },
        {
            "id": "hidream_dev_4_3_landscape",
            "name": "4:3 Landscape",
            "width": 1168,
            "height": 880
        }
    ],
    "Qwen-Image": [
        {
            "id": "qwen_image_1_1_square_default",
            "name": "1:1 Square (Default)",
            "width": 1328,
            "height": 1328
        },
        {
            "id": "qwen_image_16_9_landscape",
            "name": "16:9 Landscape",
            "width": 1664,
            "height": 928
        },
        {
            "id": "qwen_image_9_16_portrait",
            "name": "9:16 Portrait",
            "width": 928,
            "height": 1664
        },
        {
            "id": "qwen_image_4_3_landscape",
            "name": "4:3 Landscape",
            "width": 1472,
            "height": 1104
        },
        {
            "id": "qwen_image_3_4_portrait_official",
            "name": "3:4 Portrait (Official)",
            "width": 1104,
            "height": 1472
        },
        {
            "id": "qwen_image_3_2_landscape",
            "name": "3:2 Landscape",
            "width": 1584,
            "height": 1056
        },
        {
            "id": "qwen_image_2_3_portrait",
            "name": "2:3 Portrait",
            "width": 1056,
            "height": 1584
        },
        {
            "id": "qwen_image_1_1_square_1024",
            "name": "1:1 Square-1024",
            "width": 1024,
            "height": 1024
        },
        {
            "id": "qwen_image_3_4_portrait",
            "name": "3:4 Portrait",
            "width": 768,
            "height": 1024
        }
    ],
    "ZImageTurbo": [
        {
            "id": "zimageturbo_1_1_square_1024",
            "name": "1:1 Square (1024)",
            "width": 1024,
            "height": 1024
        },
        {
            "id": "zimageturbo_9_7_landscape_1024",
            "name": "9:7 Landscape (1024)",
            "width": 1152,
            "height": 896
        },
        {
            "id": "zimageturbo_7_9_portrait_1024",
            "name": "7:9 Portrait (1024)",
            "width": 896,
            "height": 1152
        },
        {
            "id": "zimageturbo_4_3_landscape_1024",
            "name": "4:3 Landscape (1024)",
            "width": 1152,
            "height": 864
        },
        {
            "id": "zimageturbo_3_4_portrait_1024",
            "name": "3:4 Portrait (1024)",
            "width": 864,
            "height": 1152
        },
        {
            "id": "zimageturbo_3_2_landscape_1024",
            "name": "3:2 Landscape (1024)",
            "width": 1248,
            "height": 832
        },
        {
            "id": "zimageturbo_2_3_portrait_1024",
            "name": "2:3 Portrait (1024)",
            "width": 832,
            "height": 1248
        },
        {
            "id": "zimageturbo_16_9_widescreen_1024",
            "name": "16:9 Widescreen (1024)",
            "width": 1280,
            "height": 720
        },
        {
            "id": "zimageturbo_9_16_portrait_1024",
            "name": "9:16 Portrait (1024)",
            "width": 720,
            "height": 1280
        },
        {
            "id": "zimageturbo_21_9_ultrawide_1024",
            "name": "21:9 Ultrawide (1024)",
            "width": 1344,
            "height": 576
        },
        {
            "id": "zimageturbo_9_21_ultra_portrait_1024",
            "name": "9:21 Ultra Portrait (1024)",
            "width": 576,
            "height": 1344
        },
        {
            "id": "zimageturbo_1_1_square_1280",
            "name": "1:1 Square (1280)",
            "width": 1280,
            "height": 1280
        },
        {
            "id": "zimageturbo_9_7_landscape_1280",
            "name": "9:7 Landscape (1280)",
            "width": 1440,
            "height": 1120
        },
        {
            "id": "zimageturbo_7_9_portrait_1280",
            "name": "7:9 Portrait (1280)",
            "width": 1120,
            "height": 1440
        },
        {
            "id": "zimageturbo_4_3_landscape_1280",
            "name": "4:3 Landscape (1280)",
            "width": 1472,
            "height": 1104
        },
        {
            "id": "zimageturbo_3_4_portrait_1280",
            "name": "3:4 Portrait (1280)",
            "width": 1104,
            "height": 1472
        },
        {
            "id": "zimageturbo_3_2_landscape_1280",
            "name": "3:2 Landscape (1280)",
            "width": 1536,
            "height": 1024
        },
        {
            "id": "zimageturbo_2_3_portrait_1280",
            "name": "2:3 Portrait (1280)",
            "width": 1024,
            "height": 1536
        },
        {
            "id": "zimageturbo_16_9_widescreen_1280",
            "name": "16:9 Widescreen (1280)",
            "width": 1536,
            "height": 864
        },
        {
            "id": "zimageturbo_9_16_portrait_1280",
            "name": "9:16 Portrait (1280)",
            "width": 864,
            "height": 1536
        },
        {
            "id": "zimageturbo_21_9_ultrawide_1280",
            "name": "21:9 Ultrawide (1280)",
            "width": 1680,
            "height": 720
        },
        {
            "id": "zimageturbo_9_21_ultra_portrait_1280",
            "name": "9:21 Ultra Portrait (1280)",
            "width": 720,
            "height": 1680
        },
        {
            "id": "zimageturbo_1_1_square_1536",
            "name": "1:1 Square (1536)",
            "width": 1536,
            "height": 1536
        },
        {
            "id": "zimageturbo_9_7_landscape_1536",
            "name": "9:7 Landscape (1536)",
            "width": 1728,
            "height": 1344
        },
        {
            "id": "zimageturbo_7_9_portrait_1536",
            "name": "7:9 Portrait (1536)",
            "width": 1344,
            "height": 1728
        },
        {
            "id": "zimageturbo_4_3_landscape_1536",
            "name": "4:3 Landscape (1536)",
            "width": 1728,
            "height": 1296
        },
        {
            "id": "zimageturbo_3_4_portrait_1536",
            "name": "3:4 Portrait (1536)",
            "width": 1296,
            "height": 1728
        },
        {
            "id": "zimageturbo_3_2_landscape_1536",
            "name": "3:2 Landscape (1536)",
            "width": 1872,
            "height": 1248
        },
        {
            "id": "zimageturbo_2_3_portrait_1536",
            "name": "2:3 Portrait (1536)",
            "width": 1248,
            "height": 1872
        },
        {
            "id": "zimageturbo_16_9_widescreen_1536",
            "name": "16:9 Widescreen (1536)",
            "width": 2048,
            "height": 1152
        },
        {
            "id": "zimageturbo_9_16_portrait_1536",
            "name": "9:16 Portrait (1536)",
            "width": 1152,
            "height": 2048
        },
        {
            "id": "zimageturbo_21_9_ultrawide_1536",
            "name": "21:9 Ultrawide (1536)",
            "width": 2016,
            "height": 864
        },
        {
            "id": "zimageturbo_9_21_ultra_portrait_1536",
            "name": "9:21 Ultra Portrait (1536)",
            "width": 864,
            "height": 2016
        }
    ],
    "Krea 2 Turbo": [
        {
            "id": "krea_2_turbo_1_1_square_1024",
            "name": "1:1 Square (1024)",
            "width": 1024,
            "height": 1024
        },
        {
            "id": "krea_2_turbo_4_3_landscape_1024",
            "name": "4:3 Landscape (1024)",
            "width": 1184,
            "height": 896
        },
        {
            "id": "krea_2_turbo_3_2_landscape_1024",
            "name": "3:2 Landscape (1024)",
            "width": 1248,
            "height": 832
        },
        {
            "id": "krea_2_turbo_16_9_widescreen_1024",
            "name": "16:9 Widescreen (1024)",
            "width": 1376,
            "height": 768
        },
        {
            "id": "krea_2_turbo_2_35_1_cinematic_1024",
            "name": "2.35:1 Cinematic (1024)",
            "width": 1568,
            "height": 672
        },
        {
            "id": "krea_2_turbo_4_5_portrait_1024",
            "name": "4:5 Portrait (1024)",
            "width": 928,
            "height": 1152
        },
        {
            "id": "krea_2_turbo_3_4_portrait_1024",
            "name": "3:4 Portrait (1024)",
            "width": 896,
            "height": 1184
        },
        {
            "id": "krea_2_turbo_2_3_portrait_1024",
            "name": "2:3 Portrait (1024)",
            "width": 832,
            "height": 1248
        },
        {
            "id": "krea_2_turbo_9_16_portrait_1024",
            "name": "9:16 Portrait (1024)",
            "width": 768,
            "height": 1376
        },
        {
            "id": "krea_2_turbo_1_1_square_1536",
            "name": "1:1 Square (1536)",
            "width": 1536,
            "height": 1536
        },
        {
            "id": "krea_2_turbo_4_3_landscape_1536",
            "name": "4:3 Landscape (1536)",
            "width": 1776,
            "height": 1344
        },
        {
            "id": "krea_2_turbo_3_2_landscape_1536",
            "name": "3:2 Landscape (1536)",
            "width": 1872,
            "height": 1248
        },
        {
            "id": "krea_2_turbo_16_9_widescreen_1536",
            "name": "16:9 Widescreen (1536)",
            "width": 2064,
            "height": 1152
        },
        {
            "id": "krea_2_turbo_2_35_1_cinematic_1536",
            "name": "2.35:1 Cinematic (1536)",
            "width": 2352,
            "height": 1008
        },
        {
            "id": "krea_2_turbo_4_5_portrait_1536",
            "name": "4:5 Portrait (1536)",
            "width": 1392,
            "height": 1728
        },
        {
            "id": "krea_2_turbo_3_4_portrait_1536",
            "name": "3:4 Portrait (1536)",
            "width": 1344,
            "height": 1776
        },
        {
            "id": "krea_2_turbo_2_3_portrait_1536",
            "name": "2:3 Portrait (1536)",
            "width": 1248,
            "height": 1872
        },
        {
            "id": "krea_2_turbo_9_16_portrait_1536",
            "name": "9:16 Portrait (1536)",
            "width": 1152,
            "height": 2064
        },
        {
            "id": "krea_2_turbo_1_1_square_2048",
            "name": "1:1 Square (2048)",
            "width": 2048,
            "height": 2048
        },
        {
            "id": "krea_2_turbo_4_3_landscape_2048",
            "name": "4:3 Landscape (2048)",
            "width": 2368,
            "height": 1792
        },
        {
            "id": "krea_2_turbo_3_2_landscape_2048",
            "name": "3:2 Landscape (2048)",
            "width": 2496,
            "height": 1664
        },
        {
            "id": "krea_2_turbo_16_9_widescreen_2048",
            "name": "16:9 Widescreen (2048)",
            "width": 2752,
            "height": 1536
        },
        {
            "id": "krea_2_turbo_2_35_1_cinematic_2048",
            "name": "2.35:1 Cinematic (2048)",
            "width": 3136,
            "height": 1344
        },
        {
            "id": "krea_2_turbo_4_5_portrait_2048",
            "name": "4:5 Portrait (2048)",
            "width": 1856,
            "height": 2304
        },
        {
            "id": "krea_2_turbo_3_4_portrait_2048",
            "name": "3:4 Portrait (2048)",
            "width": 1792,
            "height": 2368
        },
        {
            "id": "krea_2_turbo_2_3_portrait_2048",
            "name": "2:3 Portrait (2048)",
            "width": 1664,
            "height": 2496
        },
        {
            "id": "krea_2_turbo_9_16_portrait_2048",
            "name": "9:16 Portrait (2048)",
            "width": 1536,
            "height": 2752
        }
    ],
    "Krea 2 RAW": [
        {
            "id": "krea_2_raw_1_1_square",
            "name": "1:1 Square",
            "width": 1024,
            "height": 1024
        },
        {
            "id": "krea_2_raw_4_3_landscape",
            "name": "4:3 Landscape",
            "width": 1184,
            "height": 896
        },
        {
            "id": "krea_2_raw_3_2_landscape",
            "name": "3:2 Landscape",
            "width": 1248,
            "height": 832
        },
        {
            "id": "krea_2_raw_16_9_widescreen",
            "name": "16:9 Widescreen",
            "width": 1376,
            "height": 768
        },
        {
            "id": "krea_2_raw_2_35_1_cinematic",
            "name": "2.35:1 Cinematic",
            "width": 1568,
            "height": 672
        },
        {
            "id": "krea_2_raw_4_5_portrait",
            "name": "4:5 Portrait",
            "width": 928,
            "height": 1152
        },
        {
            "id": "krea_2_raw_3_4_portrait",
            "name": "3:4 Portrait",
            "width": 896,
            "height": 1184
        },
        {
            "id": "krea_2_raw_2_3_portrait",
            "name": "2:3 Portrait",
            "width": 832,
            "height": 1248
        },
        {
            "id": "krea_2_raw_9_16_portrait",
            "name": "9:16 Portrait",
            "width": 768,
            "height": 1376
        }
    ],
    "Social Media": [
        {
            "id": "social_media_instagram_square",
            "name": "Instagram Square",
            "width": 1080,
            "height": 1080
        },
        {
            "id": "social_media_instagram_portrait",
            "name": "Instagram Portrait",
            "width": 1080,
            "height": 1350
        },
        {
            "id": "social_media_instagram_landscape",
            "name": "Instagram Landscape",
            "width": 1080,
            "height": 566
        },
        {
            "id": "social_media_instagram_stories_reels",
            "name": "Instagram Stories/Reels",
            "width": 1080,
            "height": 1920
        },
        {
            "id": "social_media_instagram_profile",
            "name": "Instagram Profile",
            "width": 320,
            "height": 320
        },
        {
            "id": "social_media_facebook_post",
            "name": "Facebook Post",
            "width": 1200,
            "height": 630
        },
        {
            "id": "social_media_facebook_cover_page",
            "name": "Facebook Cover Page",
            "width": 820,
            "height": 312
        },
        {
            "id": "social_media_facebook_cover_event",
            "name": "Facebook Cover Event",
            "width": 1920,
            "height": 1005
        },
        {
            "id": "social_media_facebook_personal_cover",
            "name": "Facebook Personal Cover",
            "width": 1200,
            "height": 445
        },
        {
            "id": "social_media_facebook_profile",
            "name": "Facebook Profile",
            "width": 180,
            "height": 180
        },
        {
            "id": "social_media_facebook_stories",
            "name": "Facebook Stories",
            "width": 1080,
            "height": 1920
        },
        {
            "id": "social_media_twitter_post",
            "name": "Twitter Post",
            "width": 1200,
            "height": 675
        },
        {
            "id": "social_media_twitter_header",
            "name": "Twitter Header",
            "width": 1500,
            "height": 500
        },
        {
            "id": "social_media_twitter_profile",
            "name": "Twitter Profile",
            "width": 400,
            "height": 400
        },
        {
            "id": "social_media_youtube_thumbnail",
            "name": "YouTube Thumbnail",
            "width": 1280,
            "height": 720
        },
        {
            "id": "social_media_youtube_banner",
            "name": "YouTube Banner",
            "width": 2560,
            "height": 1440
        },
        {
            "id": "social_media_youtube_channel_icon",
            "name": "YouTube Channel Icon",
            "width": 800,
            "height": 800
        },
        {
            "id": "social_media_youtube_shorts",
            "name": "YouTube Shorts",
            "width": 1080,
            "height": 1920
        },
        {
            "id": "social_media_linkedin_post",
            "name": "LinkedIn Post",
            "width": 1200,
            "height": 627
        },
        {
            "id": "social_media_linkedin_cover_profile",
            "name": "LinkedIn Cover Profile",
            "width": 1584,
            "height": 396
        },
        {
            "id": "social_media_linkedin_company_logo",
            "name": "LinkedIn Company Logo",
            "width": 300,
            "height": 300
        },
        {
            "id": "social_media_linkedin_company_background",
            "name": "LinkedIn Company Background",
            "width": 1128,
            "height": 191
        },
        {
            "id": "social_media_tiktok_video",
            "name": "TikTok Video",
            "width": 1080,
            "height": 1920
        },
        {
            "id": "social_media_tiktok_profile",
            "name": "TikTok Profile",
            "width": 200,
            "height": 200
        },
        {
            "id": "social_media_pinterest_standard_pin",
            "name": "Pinterest Standard Pin",
            "width": 1000,
            "height": 1500
        },
        {
            "id": "social_media_pinterest_max_pin",
            "name": "Pinterest Max Pin",
            "width": 1000,
            "height": 2100
        },
        {
            "id": "social_media_pinterest_profile",
            "name": "Pinterest Profile",
            "width": 165,
            "height": 165
        },
        {
            "id": "social_media_pinterest_board_cover",
            "name": "Pinterest Board Cover",
            "width": 222,
            "height": 150
        },
        {
            "id": "social_media_snapchat_story_ads",
            "name": "Snapchat Story/Ads",
            "width": 1080,
            "height": 1920
        },
        {
            "id": "social_media_snapchat_profile",
            "name": "Snapchat Profile",
            "width": 1080,
            "height": 1080
        }
    ],
    "Print": [
        {
            "id": "print_a3_portrait",
            "name": "A3 Portrait",
            "width": 3508,
            "height": 4961
        },
        {
            "id": "print_a4_portrait",
            "name": "A4 Portrait",
            "width": 2480,
            "height": 3508
        },
        {
            "id": "print_a4_landscape",
            "name": "A4 Landscape",
            "width": 3508,
            "height": 2480
        },
        {
            "id": "print_a5_portrait",
            "name": "A5 Portrait",
            "width": 1748,
            "height": 2480
        },
        {
            "id": "print_a6_portrait",
            "name": "A6 Portrait",
            "width": 1240,
            "height": 1748
        },
        {
            "id": "print_business_card_eu",
            "name": "Business Card EU",
            "width": 1004,
            "height": 590
        },
        {
            "id": "print_letter_portrait",
            "name": "Letter Portrait",
            "width": 2550,
            "height": 3300
        },
        {
            "id": "print_legal_portrait",
            "name": "Legal Portrait",
            "width": 2550,
            "height": 4200
        },
        {
            "id": "print_tabloid",
            "name": "Tabloid",
            "width": 3300,
            "height": 5100
        },
        {
            "id": "print_4x6_photo",
            "name": "4x6 Photo",
            "width": 1200,
            "height": 1800
        },
        {
            "id": "print_5x7_photo",
            "name": "5x7 Photo",
            "width": 1500,
            "height": 2100
        },
        {
            "id": "print_8x10_photo",
            "name": "8x10 Photo",
            "width": 2400,
            "height": 3000
        },
        {
            "id": "print_11x14_photo",
            "name": "11x14 Photo",
            "width": 3300,
            "height": 4200
        },
        {
            "id": "print_16x20_photo",
            "name": "16x20 Photo",
            "width": 4800,
            "height": 6000
        },
        {
            "id": "print_20x24_photo",
            "name": "20x24 Photo",
            "width": 6000,
            "height": 7200
        }
    ],
    "Cinema": [
        {
            "id": "cinema_dci_2k_flat",
            "name": "DCI 2K Flat",
            "width": 1998,
            "height": 1080
        },
        {
            "id": "cinema_dci_2k_scope",
            "name": "DCI 2K Scope",
            "width": 2048,
            "height": 858
        },
        {
            "id": "cinema_dci_4k_flat",
            "name": "DCI 4K Flat",
            "width": 3996,
            "height": 2160
        },
        {
            "id": "cinema_dci_4k_scope",
            "name": "DCI 4K Scope",
            "width": 4096,
            "height": 1716
        },
        {
            "id": "cinema_dci_full_2k",
            "name": "DCI Full 2K",
            "width": 2048,
            "height": 1080
        },
        {
            "id": "cinema_dci_full_4k",
            "name": "DCI Full 4K",
            "width": 4096,
            "height": 2160
        },
        {
            "id": "cinema_imax_digital",
            "name": "IMAX Digital",
            "width": 4096,
            "height": 3020
        },
        {
            "id": "cinema_imax_1_90_1",
            "name": "IMAX 1.90:1",
            "width": 4096,
            "height": 2160
        },
        {
            "id": "cinema_ultra_panavision_70",
            "name": "Ultra Panavision 70",
            "width": 7680,
            "height": 2782
        },
        {
            "id": "cinema_cinerama",
            "name": "Cinerama",
            "width": 7680,
            "height": 2965
        },
        {
            "id": "cinema_academy_1_375_1",
            "name": "Academy 1.375:1",
            "width": 1378,
            "height": 1000
        },
        {
            "id": "cinema_academy_original",
            "name": "Academy Original",
            "width": 1474,
            "height": 1072
        },
        {
            "id": "cinema_silent_film_1_33_1",
            "name": "Silent Film 1.33:1",
            "width": 1440,
            "height": 1080
        },
        {
            "id": "cinema_silent_film_classic",
            "name": "Silent Film Classic",
            "width": 1334,
            "height": 1000
        },
        {
            "id": "cinema_2_39_1_anamorphic",
            "name": "2.39:1 Anamorphic",
            "width": 2048,
            "height": 858
        },
        {
            "id": "cinema_1_85_1_standard",
            "name": "1.85:1 Standard",
            "width": 1998,
            "height": 1080
        },
        {
            "id": "cinema_2_1_univisium",
            "name": "2:1 Univisium",
            "width": 2048,
            "height": 1024
        },
        {
            "id": "cinema_4_3_academy",
            "name": "4:3 Academy",
            "width": 1440,
            "height": 1080
        },
        {
            "id": "cinema_1_33_1_classic",
            "name": "1.33:1 Classic",
            "width": 1436,
            "height": 1080
        }
    ],
    "Display Resolutions": [
        {
            "id": "display_resolutions_cif",
            "name": "CIF",
            "width": 352,
            "height": 288
        },
        {
            "id": "display_resolutions_svga",
            "name": "SVGA",
            "width": 800,
            "height": 600
        },
        {
            "id": "display_resolutions_xga",
            "name": "XGA",
            "width": 1024,
            "height": 768
        },
        {
            "id": "display_resolutions_sxga",
            "name": "SXGA",
            "width": 1280,
            "height": 1024
        },
        {
            "id": "display_resolutions_wxga",
            "name": "WXGA",
            "width": 1366,
            "height": 768
        },
        {
            "id": "display_resolutions_wsxga",
            "name": "WSXGA+",
            "width": 1680,
            "height": 1050
        },
        {
            "id": "display_resolutions_240p",
            "name": "240p",
            "width": 426,
            "height": 240
        },
        {
            "id": "display_resolutions_360p",
            "name": "360p",
            "width": 640,
            "height": 360
        },
        {
            "id": "display_resolutions_480p_sd",
            "name": "480p SD",
            "width": 854,
            "height": 480
        },
        {
            "id": "display_resolutions_540p_qhd",
            "name": "540p qHD",
            "width": 960,
            "height": 540
        },
        {
            "id": "display_resolutions_720p_hd",
            "name": "720p HD",
            "width": 1280,
            "height": 720
        },
        {
            "id": "display_resolutions_900p_hd",
            "name": "900p HD+",
            "width": 1600,
            "height": 900
        },
        {
            "id": "display_resolutions_1080p_full_hd",
            "name": "1080p Full HD",
            "width": 1920,
            "height": 1080
        },
        {
            "id": "display_resolutions_uwfhd",
            "name": "UWFHD",
            "width": 2560,
            "height": 1080
        },
        {
            "id": "display_resolutions_1200p_wuxga",
            "name": "1200p WUXGA",
            "width": 1920,
            "height": 1200
        },
        {
            "id": "display_resolutions_1440p_qhd",
            "name": "1440p QHD",
            "width": 2560,
            "height": 1440
        },
        {
            "id": "display_resolutions_uwqhd",
            "name": "UWQHD",
            "width": 3440,
            "height": 1440
        },
        {
            "id": "display_resolutions_1600p_uxga",
            "name": "1600p UXGA",
            "width": 2560,
            "height": 1600
        },
        {
            "id": "display_resolutions_1800p_qhd",
            "name": "1800p QHD+",
            "width": 3200,
            "height": 1800
        },
        {
            "id": "display_resolutions_4k_uhd",
            "name": "4K UHD",
            "width": 3840,
            "height": 2160
        },
        {
            "id": "display_resolutions_uw4k_5k2k",
            "name": "UW4K (5K2K)",
            "width": 5120,
            "height": 2160
        },
        {
            "id": "display_resolutions_5k",
            "name": "5K",
            "width": 5120,
            "height": 2880
        },
        {
            "id": "display_resolutions_6k",
            "name": "6K",
            "width": 6016,
            "height": 3384
        },
        {
            "id": "display_resolutions_8k_uhd",
            "name": "8K UHD",
            "width": 7680,
            "height": 4320
        }
    ]
}

# Model selector prefix is intentionally not a real model name. Traditional
# checkpoint values remain byte-for-byte unchanged for existing workflows.
DIFFUSION_PREFIX = "[Diffusion] "


def model_selector_options():
    import folder_paths
    checkpoints = list(folder_paths.get_filename_list("checkpoints") or [])
    diffusion = list(folder_paths.get_filename_list("diffusion_models") or [])
    return checkpoints + [DIFFUSION_PREFIX + name for name in diffusion]


def model_source(selection):
    value = str(selection or "")
    if value.startswith(DIFFUSION_PREFIX):
        return "diffusion_models", value[len(DIFFUSION_PREFIX):]
    return "checkpoints", value


def encoder_loader_options():
    import nodes
    result = {}
    for key, cls_name in (("single", "CLIPLoader"), ("dual", "DualCLIPLoader"),
                          ("triple", "TripleCLIPLoader"), ("quad", "QuadrupleCLIPLoader")):
        cls = getattr(nodes, cls_name, None)
        if cls is None:
            result[key] = []
            continue
        try:
            spec = cls.INPUT_TYPES().get("required", {}).get("type")
            result[key] = list(spec[0]) if spec else []
        except (TypeError, KeyError, IndexError, AttributeError):
            result[key] = []
    return result


def available_options():
    import folder_paths
    from comfy.samplers import KSampler
    def listing(folder):
        try: return list(folder_paths.get_filename_list(folder) or [])
        except Exception: return []
    return {"checkpoints":model_selector_options(), "diffusion_models": listing("diffusion_models"),
            "text_encoders": listing("text_encoders"), "encoder_types": encoder_loader_options(),
            "loras":listing("loras"), "vaes":listing("vae"),
            "samplers":list(KSampler.SAMPLERS), "schedulers":list(KSampler.SCHEDULERS), "defaults":DEFAULT,
            "resolution_presets": RESOLUTION_PRESETS, "i2i_strengths": list(I2I_STRENGTHS.keys())}


def read_profile(checkpoint, mode):
    if not checkpoint or mode not in ('Creator', 'Personal'):
        return None
    from . import sampler_profiles
    return sampler_profiles.get_profile(checkpoint, mode)


def effective_settings(checkpoint, profile_mode, raw, *, reader=read_profile):
    cfg=settings(raw)
    profile=reader(checkpoint, profile_mode) if profile_mode in ("Creator","Personal") else None
    if profile:
        from .sampler_profiles import PROFILE_FIELDS
        values=profile.get('values', {})
        cfg.update({key: values[key] for key in PROFILE_FIELDS
                    if key in values and key not in ('positive_prefix', 'negative_prefix')})
    return cfg, profile


def _validated_external_stack(stack):
    if stack is None: return []
    if isinstance(stack,dict): stack=stack.get("loras", [])
    if not isinstance(stack,(tuple,list)):
        raise ValueError("External LoRA stack must contain a list of LoRAs")
    return list(stack)


def apply_loras(model,clip,entries,external_stack=None):
    import nodes as comfy_nodes
    import folder_paths
    allowed=set(folder_paths.get_filename_list("loras") or [])
    all_entries=list(entries)+_validated_external_stack(external_stack)
    if len(all_entries)>MAX_LORAS*2:
        raise ValueError("Too many combined LoRAs")
    applied=[]
    for i, entry in enumerate(all_entries):
        if isinstance(entry,(tuple,list)) and len(entry)>=3:
            entry={"name":entry[0],"strength_model":entry[1],"strength_clip":entry[2]}
        if not isinstance(entry,dict) or entry.get("enabled",True) is False:continue
        name=entry.get("name","")
        if not name:continue
        if name not in allowed:raise ValueError(f"LoRA not installed: {name}")
        sm=float(entry.get("strength_model",1));sc=float(entry.get("strength_clip",1))
        if not math.isfinite(sm) or not math.isfinite(sc) or not -5<=sm<=5 or not -5<=sc<=5:
            raise ValueError(f"Invalid LoRA strengths: {name}")
        if clip is None:
            if sc:
                raise ValueError(f"LoRA {name!r} requires a CLIP input for its text-encoder strength. "
                                 "Connect an encoder, or set the LoRA CLIP strength to 0.")
            model = comfy_nodes.LoraLoaderModelOnly().load_lora_model_only(model, name, sm)[0]
        else:
            model,clip=comfy_nodes.LoraLoader().load_lora(model,clip,name,sm,sc)
        applied.append(entry)
    return model,clip,applied


@lru_cache(maxsize=1)
def _cached_checkpoint(checkpoint, file_signature):
    """Reuse checkpoint tensors/objects across generations, as core cached nodes do.

    ComfyUI's model manager still controls when resident weights are offloaded
    from VRAM. The one-entry cache prevents re-reading the checkpoint from disk
    on every new seed/prompt while avoiding an unbounded model collection.
    """
    import nodes as comfy_nodes
    return comfy_nodes.CheckpointLoaderSimple().load_checkpoint(checkpoint)


def load_checkpoint_cached(checkpoint):
    import folder_paths
    # Invalidate if the checkpoint file is replaced without changing its name.
    try:
        path = folder_paths.get_full_path("checkpoints", checkpoint)
        info = Path(path).stat() if path else None
        signature = (info.st_mtime_ns, info.st_size) if info else None
    except (OSError, AttributeError, TypeError):
        signature = None
    return _cached_checkpoint(checkpoint, signature)



@lru_cache(maxsize=2)
def _cached_diffusion_model(model_name, file_signature):
    import nodes
    return nodes.UNETLoader().load_unet(model_name, "default")[0]


def load_diffusion_model_cached(model_name):
    import folder_paths
    try:
        path = folder_paths.get_full_path("diffusion_models", model_name)
        info = Path(path).stat() if path else None
        sig = (info.st_mtime_ns, info.st_size) if info else None
    except (OSError, TypeError, AttributeError):
        sig = None
    return _cached_diffusion_model(model_name, sig)


def _installed_file_with_basename(category, *basenames):
    """Resolve only exact companion filenames; subfolders are supported.

    Ambiguous duplicate basenames must be chosen explicitly in the UI instead
    of silently taking a possibly wrong encoder from another model family.
    """
    import folder_paths
    installed = list(folder_paths.get_filename_list(category) or [])
    for basename in basenames:
        matches = [name for name in installed
                   if str(name).replace("\\", "/").rsplit("/", 1)[-1].casefold() == basename.casefold()]
        if len(matches) == 1:
            return matches[0]
    return None


def _model_family(selection):
    """Conservative filename identification, never fallback across families."""
    _, filename = model_source(selection)
    name = filename.replace("\\", "/").casefold()
    if "anima" in name: return "anima"
    if "flux2" in name or "flux_2" in name or "flux-2" in name or "flux.2" in name: return "flux2"
    if "flux" in name: return "flux"
    if "sd3" in name or "stable_diffusion_3" in name or "stable-diffusion-3" in name: return "sd3"
    if "qwen_image" in name or "qwen-image" in name: return "qwen_image"
    if "z_image" in name or "z-image" in name or "zimage" in name: return "z_image"
    if "hidream" in name: return "hidream"
    if "hunyuanimage" in name or "hunyuan_image" in name: return "hunyuan_image"
    if "chroma" in name: return "chroma"
    if "lumina2" in name or "lumina_2" in name: return "lumina2"
    if "omnigen2" in name: return "omnigen2"
    return "unknown"


# Only exact filename recipes verified against official ComfyUI example workflows.
# Automatic resolution is all-or-nothing for encoders. A missing file produces
# an actionable error; it must not accidentally mix another family's encoder.
AUTO_COMPANIONS = {
    "anima": ("single", "stable_diffusion", (("qwen_3_06b_base.safetensors",),), ("qwen_image_vae.safetensors",)),
    "flux": ("dual", "flux", (("clip_l.safetensors",),
             ("t5xxl_fp8_e4m3fn_scaled.safetensors", "t5xxl_fp16.safetensors", "t5xxl_fp8_e4m3fn.safetensors")), ("ae.safetensors",)),
    "flux2": ("single", "flux2", (("mistral_3_small_flux2_fp8.safetensors", "mistral_3_small_flux2.safetensors"),), ("flux2-vae.safetensors",)),
    "sd3": ("triple", None, (("clip_l.safetensors",), ("clip_g.safetensors",),
             ("t5xxl_fp8_e4m3fn_scaled.safetensors", "t5xxl_fp16.safetensors", "t5xxl_fp8_e4m3fn.safetensors")), ("sd3_vae.safetensors",)),
    "qwen_image": ("single", "qwen_image", (("qwen_2.5_vl_7b_fp8_scaled.safetensors", "qwen_2.5_vl_7b.safetensors"),), ("qwen_image_vae.safetensors",)),
    "z_image": ("single", "lumina2", (("qwen_3_4b.safetensors",),), ("ae.safetensors",)),
    "hidream": ("quad", None, (("clip_l_hidream.safetensors",), ("clip_g_hidream.safetensors",),
               ("t5xxl_fp8_e4m3fn_scaled.safetensors", "t5xxl_fp16.safetensors"),
               ("llama_3.1_8b_instruct_fp8_scaled.safetensors",)), ("ae.safetensors",)),
    "hunyuan_image": ("dual", "hunyuan_image", (("qwen_2.5_vl_7b.safetensors",),
                       ("byt5_small_glyphxl_fp16.safetensors",)), ("hunyuan_image_2.1_vae_fp16.safetensors",)),
    "omnigen2": ("single", "omnigen2", (("qwen_2.5_vl_fp16.safetensors",),), ("ae.safetensors",)),
}


@lru_cache(maxsize=3)
def _cached_encoder(layout, kind, names_and_signatures):
    # Names and signatures are immutable hashable tuples.
    return _load_encoder_uncached(layout, kind, [x[0] for x in names_and_signatures])


def _encoder_file_signature(name):
    import folder_paths
    try:
        path = folder_paths.get_full_path("text_encoders", name)
        info = Path(path).stat() if path else None
        return (info.st_mtime_ns, info.st_size) if info else None
    except (OSError, TypeError, AttributeError):
        return None


def _load_encoder(layout, kind, filenames):
    return _cached_encoder(layout, kind, tuple((name, _encoder_file_signature(name)) for name in filenames))


def _load_encoder_uncached(layout, kind, filenames):
    """Use Comfy's native single/dual/triple/quad CLIP loaders."""
    import nodes
    loaders = {"single": ("CLIPLoader", "load_clip"),
               "dual": ("DualCLIPLoader", "load_clip"),
               "triple": ("TripleCLIPLoader", "load_clip"),
               "quad": ("QuadrupleCLIPLoader", "load_clip")}
    cls_name, method = loaders[layout]
    cls = getattr(nodes, cls_name, None)
    if cls is None:
        raise ValueError(f"This ComfyUI version does not provide {cls_name}. Update ComfyUI or connect an external CLIP.")
    inputs = cls.INPUT_TYPES().get("required", {})
    type_field = inputs.get("type")
    if type_field:
        supported = type_field[0]
        if kind not in supported:
            raise ValueError(f"{cls_name} does not support encoder type {kind!r} on this ComfyUI version. "
                             f"Available: {', '.join(supported)}. Update ComfyUI or use External CLIP.")
    expected = {"single": 1, "dual": 2, "triple": 3, "quad": 4}[layout]
    if len(filenames) != expected:
        raise ValueError(f"{cls_name} needs {expected} text encoder files")
    available = set(__import__("folder_paths").get_filename_list("text_encoders") or [])
    absent = [name for name in filenames if name not in available]
    if absent:
        raise ValueError("Missing selected text encoder(s): " + ", ".join(absent))
    # Triple and Quad core nodes use no 'type' argument (fixed SD3/HiDream).
    args = [*filenames]
    if type_field:
        args.append(kind)
    return getattr(cls(), method)(*args)[0]


def _load_manual_encoder(cfg):
    layout = cfg["encoder_loader"]
    count = {"single": 1, "dual": 2, "triple": 3, "quad": 4}[layout]
    names = [cfg[f"encoder_{idx}"] for idx in range(1, count + 1)]
    if not all(names):
        raise ValueError(f"Manual CLIP loading is set to {layout}, but {count} encoder filename(s) "
                         "must be selected in Model & profile > Encoders.")
    return _load_encoder(layout, cfg["encoder_type"], names)


@lru_cache(maxsize=3)
def _cached_vae(filename, signature):
    import nodes
    return nodes.VAELoader().load_vae(filename)[0]


def _load_vae(filename):
    import folder_paths
    try:
        path = folder_paths.get_full_path("vae", filename)
        info = Path(path).stat() if path else None
        sig = (info.st_mtime_ns, info.st_size) if info else None
    except (OSError, TypeError, AttributeError):
        sig = None
    return _cached_vae(filename, sig)


def _recover_known_components(selection, cfg, clip, vae, *, need_clip=True):
    """Complete model-only families with exact official companion files."""
    family = _model_family(selection)
    recipe = AUTO_COMPANIONS.get(family)
    if not recipe:
        return clip, vae
    layout, kind, encoder_groups, vae_names = recipe
    if clip is None and need_clip and cfg.get("clip_source") == "Internal":
        files = [_installed_file_with_basename("text_encoders", *choices) for choices in encoder_groups]
        if all(files):
            clip = _load_encoder(layout, kind, files)
    if vae is None and cfg.get("vae_name", "Internal") == "Internal":
        filename = _installed_file_with_basename("vae", *vae_names)
        if filename:
            vae = _load_vae(filename)
    return clip, vae


def _require_model_components(selection, model, clip, vae, *, positive_conditioning=None, negative_conditioning=None):
    missing = []
    if model is None: missing.append("MODEL")
    if clip is None and (positive_conditioning is None or negative_conditioning is None):
        missing.append("CLIP/text encoder")
    if vae is None: missing.append("VAE")
    if not missing: return
    family = _model_family(selection)
    recipe = AUTO_COMPANIONS.get(family)
    if recipe:
        _, _, groups, vae_names = recipe
        required = ", ".join(" / ".join(group) for group in groups)
        hint = (f"Model family {family!r} requires compatible encoder(s): {required}; "
                f"VAE: {' / '.join(vae_names)}. Install these exact files, or choose "
                "CLIP Manual and select matching encoders / a VAE explicitly (or connect sockets).")
    else:
        hint = ("For model-only files, choose Manual CLIP and matching encoder file(s) "
                "in the node's Encoders settings, plus an installed VAE, or connect "
                "compatible CLIP/VAE sockets. Unknown families are never assigned a guessed encoder.")
    raise ValueError(f"Selected model {selection!r} is missing: {', '.join(missing)}. {hint}")


def _empty_latent_for_model(model, cfg):
    """Create the still-image latent expected by the loaded diffusion model.

    Anima is an image model backed by a Wan21 3D latent format: its one-frame
    still images are [batch, 16, 1, height/8, width/8].  The older blanket
    latent_dimensions == 2 check wrongly rejected it before sampling.
    Other 3D/video model families remain outside this node's T2I scope.
    """
    import nodes as comfy_nodes
    internal_model = getattr(model, "model", None)
    latent_format = getattr(internal_model, "latent_format", None)
    channels = getattr(latent_format, "latent_channels", 4)
    spatial_ratio = getattr(latent_format, "spacial_downscale_ratio",
                            getattr(latent_format, "spatial_downscale_ratio", 8))
    latent_dimensions = getattr(latent_format, "latent_dimensions", 2)
    # Identify Anima by the *loaded model*, not by its filename: community
    # checkpoints may have arbitrary names and MODEL sockets can override it.
    config = getattr(internal_model, "model_config", None)
    is_anima = (type(internal_model).__name__ == "Anima"
                or type(config).__name__ == "Anima")
    if latent_dimensions == 3:
        if not is_anima:
            raise ValueError("Direct Sampler only supports single-frame 3D latents for Anima; "
                             "other 3D/video models need a dedicated workflow")
    elif latent_dimensions != 2:
        raise ValueError("Direct Sampler supports 2D image latents and Anima single-frame 3D latents only")
    if channels == 4 and spatial_ratio == 8 and latent_dimensions == 2:
        return comfy_nodes.EmptyLatentImage().generate(cfg["width"], cfg["height"], cfg["batch_size"])[0]
    if not isinstance(channels, int) or channels < 1 or not isinstance(spatial_ratio, int) or spatial_ratio < 1:
        raise ValueError("Unsupported model latent format: invalid channels/downscale ratio")
    if cfg["width"] % spatial_ratio or cfg["height"] % spatial_ratio:
        raise ValueError(f"The selected model needs an image resolution divisible by {spatial_ratio}")
    import torch
    import comfy.model_management
    shape = (cfg["batch_size"], channels,
             cfg["height"] // spatial_ratio, cfg["width"] // spatial_ratio)
    if latent_dimensions == 3:
        # ComfyUI's sample.fix_empty_latent_channels also expands a 4D empty
        # latent to this shape; creating it directly works with older releases.
        shape = (cfg["batch_size"], channels, 1,
                 cfg["height"] // spatial_ratio, cfg["width"] // spatial_ratio)
    samples = torch.zeros(shape, device=comfy.model_management.intermediate_device())
    return {"samples": samples}


def concat_prompt(prefix, body):
    prefix=(prefix or "").strip();body=(body or "").strip()
    return ", ".join(x for x in (prefix,body) if x)


def apply_prompt_prefixes(cfg, profile, positive, negative):
    """Apply a saved profile's prefixes, or Custom mode's inline prefixes.

    The toggle belongs to the workflow, not the checkpoint preset, so turning
    it off always leaves the connected prompt texts untouched.
    """
    if not cfg.get("apply_profile_prefixes"):
        return positive, negative
    values = profile.get("values", {}) if profile else cfg
    return (concat_prompt(values.get("positive_prefix", ""), positive),
            concat_prompt(values.get("negative_prefix", ""), negative))


def sample_with_direct_preview(model, seed, cfg, positive, negative, latent, unique_id=None):
    """Core ComfyUI sampler path, with progress but without native node previews.

    Standard KSampler uses latent_preview.prepare_callback(), which sends binary
    b_preview frames into ComfyUI's own preview panel.  We keep ComfyUI's sample,
    noise, mask, and progress APIs, but forward light JPEG previews in our own
    Direct Sampler event so they only appear inside the studio DOM widget.
    """
    import comfy.sample
    import comfy.utils
    import latent_preview
    import nodes as comfy_nodes

    samples = latent["samples"]
    ratio_spatial = latent.get("downscale_ratio_spacial")
    ratio_temporal = latent.get("downscale_ratio_temporal")
    try:
        samples = comfy.sample.fix_empty_latent_channels(model, samples, ratio_spatial, ratio_temporal)
    except TypeError:  # older ComfyUI versions have a 2-argument function
        samples = comfy.sample.fix_empty_latent_channels(model, samples)
    noise = comfy.sample.prepare_noise(samples, int(seed), latent.get("batch_index"))
    noise_mask = latent.get("noise_mask")
    steps = int(cfg["steps"])
    pbar = comfy.utils.ProgressBar(steps)
    try:
        previewer = latent_preview.get_previewer(model.load_device, model.model.latent_format)
    except (AttributeError, TypeError):
        previewer = None

    try:
        from server import PromptServer
        server = PromptServer.instance
    except (ImportError, AttributeError):
        server = None
    interval = max(1, steps // 12)

    def callback(step, x0, x, total_steps):
        # No preview_bytes here: this is the critical distinction from core
        # KSampler, which would create ComfyUI's second preview below the node.
        pbar.update_absolute(step + 1, total_steps)
        if (previewer is None or server is None or unique_id is None
                or (step % interval != 0 and step + 1 != total_steps)):
            return
        try:
            if getattr(x0, "is_nested", False):
                x0 = x0.tensors[0]
            image = previewer.decode_latent_to_preview(x0)
            if image is None:
                return
            image.thumbnail((512, 512))
            stream = io.BytesIO()
            image.convert("RGB").save(stream, "JPEG", quality=70)
            server.send_sync("direct_sampler_frame", {
                "node_id": str(unique_id), "step": int(step + 1),
                "total": int(total_steps), "image": base64.b64encode(stream.getvalue()).decode("ascii")
            }, getattr(server, "client_id", None))
        except Exception:
            # Preview encoding/socket problems must never interrupt generation.
            pass

    generated = comfy.sample.sample(
        model, noise, steps, float(cfg["cfg"]), cfg["sampler_name"],
        cfg["scheduler"], positive, negative, samples,
        denoise=float(cfg["denoise"]), noise_mask=noise_mask, callback=callback,
        disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED, seed=int(seed))
    result = latent.copy()
    result.pop("downscale_ratio_spacial", None)
    result.pop("downscale_ratio_temporal", None)
    result["samples"] = generated
    return result


def encode_and_sample(checkpoint,seed,pos,neg,raw,profile_mode="Custom",*,latent=None,lora_stack=None,
                      model=None,clip=None,vae=None,positive_conditioning=None,negative_conditioning=None,
                      init_image=None,mask=None,unique_id=None):
    import nodes as comfy_nodes
    import folder_paths
    from comfy.samplers import KSampler
    cfg,profile=effective_settings(checkpoint,profile_mode,raw)
    cfg=validate_settings(cfg,allowed_loras=set(folder_paths.get_filename_list("loras") or []))
    if cfg["sampler_name"] not in KSampler.SAMPLERS or cfg["scheduler"] not in KSampler.SCHEDULERS:
        raise ValueError("Configured sampler or scheduler not available")
    external_model = model is not None
    source, name = model_source(checkpoint)
    installed = set(folder_paths.get_filename_list(source) or [])
    # Connected MODEL overrides must not force the otherwise selected model to
    # be present on disk. Legacy workflows can still run entirely via sockets.
    if model is None:
        if not name or name not in installed:
            raise ValueError(f"Model not installed in models/{source}: {name or '(none selected)'}")
        if source == "diffusion_models":
            model = load_diffusion_model_cached(name)
            loaded_clip = loaded_vae = None
        else:
            model, loaded_clip, loaded_vae = load_checkpoint_cached(name)
    else:
        loaded_clip = loaded_vae = None
        # A connected MODEL can coexist with a valid checkpoint for embedded
        # CLIP/VAE fallback, preserving existing UI behavior.
        if source == "checkpoints" and name in installed and (clip is None or vae is None):
            _, loaded_clip, loaded_vae = load_checkpoint_cached(name)
    external_vae = vae is not None
    if cfg["clip_source"] == "External" and clip is None:
        if positive_conditioning is None or negative_conditioning is None:
            raise ValueError("CLIP source is External but no CLIP socket is connected")
    if clip is None and cfg["clip_source"] == "Manual" and (positive_conditioning is None or negative_conditioning is None):
        clip = _load_manual_encoder(cfg)
    if clip is None and cfg["clip_source"] == "Internal":
        clip = loaded_clip
    if cfg["vae_name"] == "External" and not external_vae:
        raise ValueError("VAE source is External but no VAE socket is connected")
    if vae is None and cfg["vae_name"] not in ("Internal", "External"):
        if cfg["vae_name"] not in set(folder_paths.get_filename_list("vae") or []):
            raise ValueError(f"VAE not installed: {cfg['vae_name']}")
        vae = _load_vae(cfg["vae_name"])
    elif vae is None:
        vae = loaded_vae
    # Recognized model-only families can recover official companion files.
    # Never override an explicit choice or external socket/conditioning.
    if not external_model:
        clip, vae = _recover_known_components(
            checkpoint, cfg, clip, vae,
            need_clip=positive_conditioning is None or negative_conditioning is None,
        )
    _require_model_components(checkpoint, model, clip, vae,
                              positive_conditioning=positive_conditioning,
                              negative_conditioning=negative_conditioning)
    model,clip,applied=apply_loras(model,clip,cfg["loras"],lora_stack)
    clipped=clip.clone() if clip is not None else None
    # CLIP skip is SD1/2/SDXL specific. Never apply blindly to Qwen/T5/Flux,
    # and do not touch encoders when the default -1 is selected.
    if clipped is not None and int(cfg["clip_skip"]) != -1:
        latent_channels = getattr(getattr(getattr(model, "model", None), "latent_format", None), "latent_channels", None)
        if _model_family(checkpoint) == "unknown" and source == "checkpoints" and latent_channels == 4:
            clipped.clip_layer(int(cfg["clip_skip"]))
    pos, neg = apply_prompt_prefixes(cfg, profile, pos, neg)
    for entry in applied:
        if entry.get("use_trigger") and entry.get("trigger"):
            pos=concat_prompt(pos,entry["trigger"])
    p_cond=positive_conditioning if positive_conditioning is not None else comfy_nodes.CLIPTextEncode().encode(clipped,pos)[0]
    n_cond=negative_conditioning if negative_conditioning is not None else comfy_nodes.CLIPTextEncode().encode(clipped,neg)[0]
    internal_ref = cfg.get("internal_init_image") if cfg.get("mode") == "i2i" else None
    if init_image is None and internal_ref:
        init_image = load_internal_source_image(internal_ref)
    if mask is not None and init_image is None:
        raise ValueError("Mask input requires a connected init_image input")
    if latent is not None and init_image is not None:
        raise ValueError("Connect either latent OR init_image, not both")
    if cfg.get("mode") == "i2i" and latent is None and init_image is None:
        raise ValueError("I2I mode requires a source image (internal or connected init_image)")
    if latent is not None:
        lat=latent
    elif init_image is not None:
        init_image = resize_image_tensor(init_image, cfg["width"], cfg["height"])
        if mask is not None:
            lat=comfy_nodes.VAEEncodeForInpaint().encode(vae,init_image,mask,6)[0]
        else:
            lat=comfy_nodes.VAEEncode().encode(vae,init_image)[0]
    else:
        lat=_empty_latent_for_model(model, cfg)
    sampled=sample_with_direct_preview(model,int(seed),cfg,p_cond,n_cond,lat,unique_id=unique_id)
    image=comfy_nodes.VAEDecode().decode(vae,sampled)[0]
    bundle={"schema":"DIRECT_FINISHER/1","image":image,"model":model,"clip":clipped,"vae":vae,
            "positive":p_cond,"negative":n_cond,"seed":int(seed),"checkpoint":checkpoint,
            "prompts":{"positive_text":pos,"negative_text":neg},
            "metadata":{"steps":cfg["steps"],"cfg":cfg["cfg"],"sampler":cfg["sampler_name"],
                        "scheduler":cfg["scheduler"],"lora_count":len(applied),"width":int(image.shape[2]),
                        "height":int(image.shape[1]),"denoise":cfg["denoise"],"clip_skip":cfg["clip_skip"],
                        "mode":cfg.get("mode","t2i"),"i2i_strength":cfg.get("i2i_strength","Balanced"),
                        "vae_name":cfg.get("vae_name","Internal"),"clip_source":cfg.get("clip_source","Internal"),
                        "model_source":source,"model_family":_model_family(checkpoint)}}
    return image,bundle,sampled,p_cond,n_cond


def record_previews(images, metadata=None):
    import folder_paths
    import numpy as np
    from PIL import Image
    temp=Path(folder_paths.get_temp_directory());temp.mkdir(parents=True,exist_ok=True)
    results=[]
    for sample in images:
        arr=(sample.detach().cpu().numpy().clip(0,1)*255).astype(np.uint8)
        token=secrets.token_urlsafe(25)
        name=f"direct_sampler_{secrets.token_hex(10)}.png"
        path=temp/name
        Image.fromarray(arr).save(path,format="PNG")
        with LOCK:
            PREVIEWS[token]={"path":str(path),"metadata":metadata or {}}
            PREVIEWS.move_to_end(token)
            while len(PREVIEWS)>_LIMIT: PREVIEWS.popitem(last=False)
        results.append({"filename":name,"subfolder":"","type":"temp","ds_token":token,"width":int(arr.shape[1]),"height":int(arr.shape[0])})
    return results


def save_preview(token, prefix="DirectSampler", folder="", image_format="PNG", embed_metadata=True):
    import folder_paths
    if not isinstance(token,str) or len(token)>128:
        raise ValueError("Invalid preview token")
    image_format=str(image_format or "PNG").upper()
    if image_format == "JPG":
        image_format = "JPEG"
    formats={
        "PNG":("png","PNG"),
        "JPEG":("jpg","JPEG"),
        "WEBP":("webp","WEBP"),
        "TIFF":("tiff","TIFF"),
        "BMP":("bmp","BMP"),
        "GIF":("gif","GIF"),
    }
    if image_format not in formats:
        raise ValueError("Unsupported image export format")
    with LOCK:
        entry=PREVIEWS.get(token)
        if not isinstance(entry, dict):
            entry={"path":entry,"metadata":{}}
        path=entry.get("path")
        metadata=entry.get("metadata") or {}
        if not path or not Path(path).is_file():
            raise ValueError("Preview expired. Generate a new image to save it.")
        if prefix not in ("DirectSampler", "DirectSampler_Selected"):
            prefix="DirectSampler"
        from . import output_folders
        out=output_folders.output_directory(folder)
        full,filename,num,subfolder,_=folder_paths.get_save_image_path(prefix,str(out))
        ext,pil_format=formats[image_format]
        destination=Path(full)/f"{filename}_{num:05}_.{ext}"
        from PIL import Image
        from . import image_metadata
        with Image.open(path) as preview:
            image = preview.convert('RGB')
        save_kwargs={"format": pil_format}
        save_kwargs.update(image_metadata.save_kwargs(
            image_format, metadata, namespace='direct_sampler', embed_metadata=embed_metadata))
        image.save(destination, **save_kwargs)
    return {"filename":destination.name,"subfolder":folder,"type":"output","format":image_format}
