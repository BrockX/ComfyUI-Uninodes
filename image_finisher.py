from __future__ import annotations

import inspect
import json
from typing import Any, Dict, List, Tuple

import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw, ImageFont, ImageOps
import numpy as np

try:
    import folder_paths
except Exception:  # pragma: no cover
    folder_paths = None


def _folder_list(key: str) -> List[str]:
    if folder_paths is None:
        return []
    try:
        return list(folder_paths.get_filename_list(key) or [])
    except Exception:
        return []


def available_upscale_models() -> List[str]:
    return _folder_list("upscale_models")


def available_sam_models() -> List[str]:
    names: List[str] = []
    for key in ("sams", "sam_models", "sam"):
        for item in _folder_list(key):
            if item not in names:
                names.append(item)
    return names


def available_detector_models() -> List[str]:
    names: List[str] = []
    for key in ("ultralytics_bbox", "ultralytics", "onnx", "bbox"):
        for item in _folder_list(key):
            if item not in names:
                names.append(item)
    return names


DEFAULT_DETAILER_SETTINGS: Dict[str, Any] = {
    "preset": "default",
    "sam_model": "",
    "detector": "",
    "guide_size": 512,
    "guide_size_for": True,
    "max_size": 1024,
    "steps": 18,
    "cfg": 2.0,
    "sampler_name": "euler",
    "scheduler": "normal",
    "denoise": 0.4,
    "feather": 5,
    "bbox_threshold": 0.5,
    "bbox_dilation": 15,
    "bbox_crop_factor": 3.0,
    "drop_size": 10,
    "cycle": 1,
    "prompt_enabled": False,
    "prompt": "",
    "sam_detection_hint": "center-1",
    "sam_dilation": 0,
    "sam_threshold": 0.93,
    "sam_bbox_expansion": 0,
    "sam_mask_hint_threshold": 0.7,
    "sam_mask_hint_use_negative": "False",
}

DETAILER_PRESETS: Dict[str, Dict[str, Dict[str, Any]]] = {
    "face": {
        "default": {"label": "Default", "values": {}},
        "gentle": {"label": "Gentle", "values": {"denoise": 0.28, "cfg": 2.0, "bbox_dilation": 10, "bbox_crop_factor": 2.6, "feather": 4}},
        "strong": {"label": "Strong Repair", "values": {"denoise": 0.5, "steps": 24, "cfg": 2.5, "bbox_dilation": 18, "bbox_crop_factor": 3.4, "feather": 6}},
        "glasses": {"label": "Glasses-friendly", "values": {"denoise": 0.24, "bbox_dilation": 22, "bbox_crop_factor": 3.6, "feather": 5, "sam_threshold": 0.9, "sam_dilation": 4}},
    },
    "eyes": {
        "default": {"label": "Default", "values": {}},
        "subtle": {"label": "Subtle", "values": {"guide_size": 384, "denoise": 0.22, "bbox_dilation": 8, "bbox_crop_factor": 2.1, "feather": 3}},
        "focused": {"label": "Focused Repair", "values": {"guide_size": 448, "denoise": 0.3, "bbox_dilation": 12, "bbox_crop_factor": 2.4, "feather": 4}},
    },
    "hands": {
        "default": {"label": "Default", "values": {}},
        "gentle": {"label": "Gentle", "values": {"guide_size": 448, "denoise": 0.28, "bbox_dilation": 12, "bbox_crop_factor": 2.4}},
        "strong": {"label": "Strong Repair", "values": {"guide_size": 512, "denoise": 0.42, "steps": 22, "bbox_dilation": 18, "bbox_crop_factor": 3.1}},
    },
}

DEFAULT_SETTINGS: Dict[str, Any] = {
    "ui_mode": "simple",
    "active_section": "overview",
    "simple_upscale": {
        "scale": 2.0,
        "method": "lanczos",
    },
    "model_upscale": {
        "model_name": "",
    },
    "diffusion_refine": {
        "steps": 20,
        "cfg": 1.0,
        "sampler_name": "euler",
        "scheduler": "normal",
        "denoise": 0.25,
        "tile_width": 768,
        "tile_height": 768,
        "mode_type": "Linear",
        "mask_blur": 8,
        "tile_padding": 32,
        "seam_fix_mode": "None",
        "seam_fix_denoise": 0.2,
        "seam_fix_mask_blur": 8,
        "seam_fix_width": 64,
        "seam_fix_padding": 16,
        "force_uniform_tiles": True,
        "tiled_decode": False,
        "batch_size": 1,
    },
    "detailer": {
        "provider": "auto",
        "face_detector": "",
        "eye_detector": "",
        "hand_detector": "",
    },
    "face_detailer": DEFAULT_DETAILER_SETTINGS.copy(),
    "eye_detailer": DEFAULT_DETAILER_SETTINGS.copy(),
    "hand_detailer": DEFAULT_DETAILER_SETTINGS.copy(),
    "mirror": {
        "mode": "horizontal",
    },
    "watermark": {
        "mode": "text", "text": "", "image": None,
        "color": "#ffffff", "text_size": 36,
        "opacity": 0.55, "scale": 0.22, "rotation": 0,
        "x": 0.86, "y": 0.90,
        "position": "bottom_right", "padding": 24,
    },
    "export": {"placement": "suffix", "detail_label": "_Detailed"},
}



def _deep_merge(base: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: (v.copy() if isinstance(v, dict) else v) for k, v in base.items()}
    for key, value in (incoming or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def parse_settings(raw: str | Dict[str, Any] | None) -> Dict[str, Any]:
    if isinstance(raw, dict):
        data = raw
    else:
        try:
            data = json.loads(raw or "{}")
        except Exception:
            data = {}
    out = _deep_merge(DEFAULT_SETTINGS, data if isinstance(data, dict) else {})
    # Older watermarks used a five-position selector and had no x/y coordinates.
    old_wm = data.get('watermark', {}) if isinstance(data, dict) else {}
    if isinstance(old_wm, dict) and ('x' not in old_wm or 'y' not in old_wm):
        pos_map = {'top_left': (.15, .15), 'top_right': (.85, .15),
                   'bottom_left': (.15, .85), 'bottom_right': (.85, .85), 'center': (.5, .5)}
        out['watermark']['x'], out['watermark']['y'] = pos_map.get(old_wm.get('position','bottom_right'), (.85, .85))

    # Migrate older shared detailer settings into per-stage settings.
    legacy = out.get("detailer", {}) or {}
    for stage_key, detector_key in (("face_detailer", "face_detector"), ("eye_detailer", "eye_detector"), ("hand_detailer", "hand_detector")):
        stage = _deep_merge(DEFAULT_DETAILER_SETTINGS, out.get(stage_key, {}) or {})
        if not stage.get("detector"):
            stage["detector"] = legacy.get(detector_key, "")
        for key in DEFAULT_DETAILER_SETTINGS.keys():
            if key in stage and stage[key] != DEFAULT_DETAILER_SETTINGS[key]:
                continue
            if key in legacy and key not in ("face_detector", "eye_detector", "hand_detector"):
                stage[key] = legacy[key]
        # Apply preset values if selected and fields are still absent/default.
        preset_key = (stage.get("preset") or "default").lower()
        preset_pool = DETAILER_PRESETS.get(stage_key.split('_')[0], {})
        preset = preset_pool.get(preset_key, {}).get("values", {})
        for k, v in preset.items():
            if k not in stage or stage[k] == DEFAULT_DETAILER_SETTINGS.get(k):
                stage[k] = v
        out[stage_key] = stage
    return out



def _image_to_nchw(image: torch.Tensor) -> torch.Tensor:
    if image.ndim != 4:
        raise ValueError("Expected IMAGE tensor shaped [B,H,W,C]")
    return image.movedim(-1, 1)


def _image_to_bhwc(image: torch.Tensor) -> torch.Tensor:
    return image.movedim(1, -1)


def apply_mirror(image: torch.Tensor, mode: str) -> torch.Tensor:
    mode = (mode or "horizontal").lower()
    if mode == "horizontal":
        return torch.flip(image, dims=[2])
    if mode == "vertical":
        return torch.flip(image, dims=[1])
    if mode == "both":
        return torch.flip(image, dims=[1, 2])
    return image


def resize_to_dimensions(image: torch.Tensor, width: int, height: int, method: str = "lanczos") -> torch.Tensor:
    """Resize BHWC images to an exact output size using ComfyUI's native scaler.

    Prefer comfy.utils.common_upscale for real Lanczos interpolation; the older
    implementation labelled bicubic resampling as Lanczos. The torch fallback
    allows standalone tests to run outside a ComfyUI installation.
    """
    width, height = int(width), int(height)
    if width <= 0 or height <= 0:
        raise ValueError("Upscale target dimensions must be positive")
    if image.shape[1] == height and image.shape[2] == width:
        return image
    method = (method or "lanczos").lower()
    allowed = {"lanczos", "bicubic", "bilinear", "area", "nearest"}
    if method not in allowed:
        raise ValueError(f"Unsupported upscale method: {method}")
    nchw = _image_to_nchw(image)
    try:
        import comfy.utils
    except ImportError:
        # Fallback is used only outside ComfyUI (tests or standalone scripts).
        mode = {"lanczos": "bicubic", "nearest": "nearest"}.get(method, method)
        kwargs = {"size": (height, width), "mode": mode}
        if mode in ("bicubic", "bilinear"):
            kwargs["align_corners"] = False
        output = F.interpolate(nchw, **kwargs)
    else:
        native_method = "nearest-exact" if method == "nearest" else method
        output = comfy.utils.common_upscale(nchw, width, height, native_method, "disabled")
    return _image_to_bhwc(output).clamp(0.0, 1.0)


def scaled_dimensions(image: torch.Tensor, scale: float) -> Tuple[int, int]:
    """Return (width, height) relative to the source image, not an interim 4x."""
    scale = float(scale)
    if not 1.0 <= scale <= 8.0:
        raise ValueError("Target upscale factor must be between 1.0 and 8.0")
    return max(1, int(round(image.shape[2] * scale))), max(1, int(round(image.shape[1] * scale)))


def simple_upscale(image: torch.Tensor, scale: float, method: str) -> torch.Tensor:
    width, height = scaled_dimensions(image, scale)
    return resize_to_dimensions(image, width, height, method)


def apply_text_watermark(image: torch.Tensor, text: str, position: str, opacity: float, scale: float, padding: int) -> torch.Tensor:
    text = (text or "").strip()
    if not text:
        return image
    batch: List[torch.Tensor] = []
    for sample in image:
        arr = (sample.detach().cpu().numpy().clip(0, 1) * 255).astype(np.uint8)
        pil = Image.fromarray(arr)
        draw = ImageDraw.Draw(pil, "RGBA")
        size = max(12, int(round(min(pil.size) * max(0.01, float(scale)))))
        try:
            font = ImageFont.truetype("arial.ttf", size)
        except Exception:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        pad = max(0, int(padding or 0))
        pos = (position or "bottom_right").lower()
        if pos == "top_left":
            x, y = pad, pad
        elif pos == "top_right":
            x, y = pil.width - tw - pad, pad
        elif pos == "bottom_left":
            x, y = pad, pil.height - th - pad
        elif pos == "center":
            x, y = (pil.width - tw) // 2, (pil.height - th) // 2
        else:
            x, y = pil.width - tw - pad, pil.height - th - pad
        alpha = max(0, min(255, int(round(float(opacity or 0) * 255))))
        shadow = (0, 0, 0, min(255, alpha))
        fill = (255, 255, 255, alpha)
        draw.text((x + 1, y + 1), text, fill=shadow, font=font)
        draw.text((x, y), text, fill=fill, font=font)
        batch.append(torch.from_numpy(np.array(pil).astype(np.float32) / 255.0))
    return torch.stack(batch, dim=0).to(image.device)



def _rgba_watermark_overlay(target_size: tuple[int, int], settings: Dict[str, Any]) -> Image.Image | None:
    """Compose a free-positioned RGBA overlay; positions are normalized image coords."""
    import re
    from pathlib import Path
    width, height = target_size
    kind = settings.get('mode', 'text')
    opacity = max(0.0, min(1.0, float(settings.get('opacity', .55))))
    rotation = float(settings.get('rotation', 0))
    if kind == 'image':
        source = settings.get('image')
        if not isinstance(source, dict):
            return None
        import folder_paths
        path_parts = [source.get('subfolder', 'finisher_watermarks'), source.get('filename', '')]
        if not all(isinstance(part, str) and part and '..' not in part.replace('\\','/').split('/') for part in path_parts):
            raise ValueError('Invalid watermark image reference')
        root = Path(folder_paths.get_input_directory()).resolve()
        candidate = (root / path_parts[0] / path_parts[1]).resolve()
        if root not in candidate.parents or not candidate.is_file():
            raise ValueError('Watermark image no longer exists')
        with Image.open(candidate) as im:
            art = ImageOps.exif_transpose(im).convert('RGBA')
        scale = max(.01, min(2, float(settings.get('scale', .22))))
        new_width = max(1, round(width * scale))
        new_height = max(1, round(new_width * art.height / max(1, art.width)))
        art = art.resize((new_width, new_height), Image.Resampling.LANCZOS)
    else:
        text = str(settings.get('text') or '').strip()
        if not text:
            return None
        size = max(6, min(400, int(settings.get('text_size', 36))))
        try:
            font = ImageFont.truetype('arial.ttf', size)
        except OSError:
            try:
                font = ImageFont.truetype('DejaVuSans.ttf', size)
            except OSError:
                font = ImageFont.load_default()
        box = ImageDraw.Draw(Image.new('RGBA', (1,1))).textbbox((0,0), text, font=font)
        art = Image.new('RGBA', (max(1, box[2]-box[0]+8), max(1, box[3]-box[1]+8)), (0,0,0,0))
        color = settings.get('color', '#ffffff')
        if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
            color = '#ffffff'
        ImageDraw.Draw(art).text((4-box[0],4-box[1]), text, font=font, fill=color)
    if rotation:
        art = art.rotate(-rotation, Image.Resampling.BICUBIC, expand=True)
    alpha=art.getchannel('A').point(lambda value: int(round(value*opacity)))
    art.putalpha(alpha)
    return art


def apply_watermark(image: torch.Tensor, settings: Dict[str, Any]) -> torch.Tensor:
    overlay_images=[]
    for sample in image:
        rgb=(sample.detach().cpu().numpy().clip(0,1)*255).astype(np.uint8)
        pil=Image.fromarray(rgb).convert('RGBA')
        art=_rgba_watermark_overlay(pil.size, settings)
        if art is None:
            overlay_images.append(sample)
            continue
        x=max(0,min(1,float(settings.get('x', .86))))
        y=max(0,min(1,float(settings.get('y', .90))))
        origin=(round(x*pil.width-art.width/2),round(y*pil.height-art.height/2))
        layer=Image.new('RGBA',pil.size,(0,0,0,0))
        layer.alpha_composite(art,origin)
        pil=Image.alpha_composite(pil,layer).convert('RGB')
        overlay_images.append(torch.from_numpy(np.asarray(pil).copy().astype(np.float32)/255).to(sample.device))
    return torch.stack(overlay_images)


def detailer_positive(settings, clip, positive):
    if not settings.get('prompt_enabled') or not str(settings.get('prompt','')).strip():
        return positive
    if clip is None:
        raise ValueError('Custom detailer prompts require a connected CLIP or Direct Sampler finisher bundle')
    import nodes as comfy_nodes
    return comfy_nodes.CLIPTextEncode().encode(clip, str(settings['prompt']))[0]


def upscale_with_model(image: torch.Tensor, model_name: str) -> torch.Tensor:
    model_name = (model_name or "").strip()
    if not model_name:
        raise ValueError("Model upscale is enabled but no upscale model is selected")
    try:
        # Built-in model upscale nodes live in comfy_extras, not nodes.py.
        # In ComfyUI's V3 implementation the calls return io.NodeOutput,
        # which supports [0] just like the older tuple-based V1 nodes.
        from comfy_extras.nodes_upscale_model import UpscaleModelLoader, ImageUpscaleWithModel

        up_model = UpscaleModelLoader().load_model(model_name)[0]
        return ImageUpscaleWithModel().upscale(up_model, image)[0]
    except Exception as exc:
        raise RuntimeError(f"Unable to use upscale model '{model_name}': {exc}") from exc


def _get_class(name: str):
    try:
        import nodes as comfy_nodes
        return comfy_nodes.NODE_CLASS_MAPPINGS.get(name)
    except Exception:
        return None


def _call_node(obj: Any, values: Dict[str, Any]) -> Any:
    method = getattr(obj, getattr(obj, "FUNCTION", ""), None)
    if method is None:
        # fall back to a common method name
        for guess in ("doit", "load_model", "load_sam_model", "execute"):
            method = getattr(obj, guess, None)
            if method is not None:
                break
    if method is None:
        raise RuntimeError(f"Unable to find callable function on node {obj.__class__.__name__}")
    sig = inspect.signature(method)
    kwargs: Dict[str, Any] = {}
    missing: List[str] = []
    for pname, param in sig.parameters.items():
        if pname == "self":
            continue
        if pname in values:
            kwargs[pname] = values[pname]
        elif param.default is inspect._empty:
            missing.append(pname)
    if missing:
        raise RuntimeError(f"Node {obj.__class__.__name__} requires unsupported inputs: {', '.join(missing)}")
    return method(**kwargs)


def _load_bbox_detector(model_name: str):
    provider_name = None
    for candidate in ("UltralyticsDetectorProvider", "ONNXDetectorProvider"):
        if _get_class(candidate):
            provider_name = candidate
            break
    if not provider_name:
        raise RuntimeError("No detector provider found. Install Impact Pack + Impact Subpack or ONNX detector support.")
    provider_cls = _get_class(provider_name)
    provider = provider_cls()
    result = _call_node(provider, {
        "model_name": model_name,
        "bbox_model_name": model_name,
        "model": model_name,
    })
    if isinstance(result, tuple):
        return result[0], (result[1] if len(result) > 1 else None)
    return result, None


def _load_sam_model(model_name: str):
    if not model_name:
        return None
    cls = _get_class("SAMLoader")
    if not cls:
        raise RuntimeError("SAMLoader is not available. Install Impact Pack.")
    result = _call_node(cls(), {"model_name": model_name, "sam_model_name": model_name})
    if isinstance(result, tuple):
        return result[0]
    return result



def run_diffusion_refine(image: torch.Tensor, *, settings: Dict[str, Any],
                         model: Any, vae: Any, positive: Any, negative: Any,
                         seed: int = 0) -> torch.Tensor:
    """Refine an already-scaled image in tiles through installed Ultimate SD Upscale.

    The No Upscale variant is intentional: Image Finisher's model/simple upscale
    steps precede this stage, so applying another automatic scale here would
    silently multiply the target dimensions. This variant retains image size.
    """
    stage = "Diffusion Refine"
    detailer_cls = _get_class("UltimateSDUpscaleNoUpscale")
    if detailer_cls is None:
        raise RuntimeError(
            f"{stage} requires Ultimate SD Upscale (No Upscale). "
            "Install or enable ComfyUI_UltimateSDUpscale and restart ComfyUI."
        )
    if any(arg is None for arg in (model, vae, positive, negative)):
        raise RuntimeError(
            f"{stage} needs MODEL, VAE, positive and negative CONDITIONING inputs. "
            "Connect these to Image Finisher before enabling Diffusion Refine."
        )
    settings = settings or {}
    positive_ints = ("steps", "batch_size")
    for key in positive_ints:
        if int(settings.get(key, DEFAULT_SETTINGS["diffusion_refine"][key])) < 1:
            raise ValueError(f"{stage}: {key} must be positive")
    for key in ("tile_width", "tile_height"):
        if int(settings.get(key, DEFAULT_SETTINGS["diffusion_refine"][key])) < 64:
            raise ValueError(f"{stage}: {key} must be at least 64 pixels")
    if not 0 <= float(settings.get("denoise", 0.25)) <= 1:
        raise ValueError(f"{stage}: denoise must be between 0 and 1")
    if int(settings.get("batch_size", 1)) != 1 and not settings.get("force_uniform_tiles", True):
        raise ValueError(f"{stage}: batch_size > 1 requires force_uniform_tiles")
    values = {
        "upscaled_image": image,
        "model": model,
        "positive": positive,
        "negative": negative,
        "vae": vae,
        "seed": int(seed or 0),
        "steps": int(settings.get("steps", 20)),
        "cfg": float(settings.get("cfg", 1.0)),
        "sampler_name": settings.get("sampler_name", "euler"),
        "scheduler": settings.get("scheduler", "normal"),
        "denoise": float(settings.get("denoise", 0.25)),
        "mode_type": settings.get("mode_type", "Linear"),
        "tile_width": int(settings.get("tile_width", 768)),
        "tile_height": int(settings.get("tile_height", 768)),
        "mask_blur": int(settings.get("mask_blur", 8)),
        "tile_padding": int(settings.get("tile_padding", 32)),
        "seam_fix_mode": settings.get("seam_fix_mode", "None"),
        "seam_fix_denoise": float(settings.get("seam_fix_denoise", 0.2)),
        "seam_fix_mask_blur": int(settings.get("seam_fix_mask_blur", 8)),
        "seam_fix_width": int(settings.get("seam_fix_width", 64)),
        "seam_fix_padding": int(settings.get("seam_fix_padding", 16)),
        "force_uniform_tiles": bool(settings.get("force_uniform_tiles", True)),
        "tiled_decode": bool(settings.get("tiled_decode", False)),
        "batch_size": int(settings.get("batch_size", 1)),
    }
    # Filter supported arguments by node signature: recent Ultimate SD Upscale
    # exposes batch_size while older versions do not.
    result = _call_node(detailer_cls(), values)
    if isinstance(result, (tuple, list)):
        if not result:
            raise RuntimeError(f"{stage} returned no images")
        result = result[0]
    elif isinstance(result, dict):
        payload = result.get("result")
        if not payload:
            raise RuntimeError(f"{stage} returned no image data")
        result = payload[0]
    if not isinstance(result, torch.Tensor) or result.ndim != 4:
        raise RuntimeError(f"{stage} returned an invalid IMAGE tensor")
    return result


def run_face_detailer(image: torch.Tensor, *, detector_model: str, settings: Dict[str, Any],
                      model: Any, clip: Any, vae: Any, positive: Any, negative: Any,
                      seed: int = 0, detector_cache=None, sam_cache=None) -> torch.Tensor:
    face_cls = _get_class("FaceDetailer")
    if not face_cls:
        raise RuntimeError("Face detailing requires the Impact Pack FaceDetailer node.")
    if model is None or clip is None or vae is None or positive is None or negative is None:
        raise RuntimeError("Face detailing requires model, clip, vae, positive and negative inputs.")
    detector_model = (detector_model or "").strip()
    if not detector_model:
        raise RuntimeError("A detector model must be selected for the enabled detailer.")
    # Local caches are shared by the face/eye/hand stages of one Finisher run.
    # Never retain these models globally or force ComfyUI to unload its checkpoint.
    if detector_cache is not None and detector_model in detector_cache:
        bbox_detector, segm_detector = detector_cache[detector_model]
    else:
        bbox_detector, segm_detector = _load_bbox_detector(detector_model)
        if detector_cache is not None:
            detector_cache[detector_model] = (bbox_detector, segm_detector)
    sam_name = settings.get("sam_model", "")
    if sam_cache is not None and sam_name in sam_cache:
        sam_model = sam_cache[sam_name]
    else:
        sam_model = _load_sam_model(sam_name)
        if sam_cache is not None:
            sam_cache[sam_name] = sam_model
    detailer = face_cls()
    values = {
        "image": image,
        "model": model,
        "clip": clip,
        "vae": vae,
        "positive": positive,
        "negative": negative,
        "bbox_detector": bbox_detector,
        "sam_model_opt": sam_model,
        "segm_detector_opt": segm_detector,
        "guide_size": int(settings.get("guide_size", 512)),
        "guide_size_for": bool(settings.get("guide_size_for", True)),
        "max_size": int(settings.get("max_size", 1024)),
        "seed": int(seed or 0),
        "steps": int(settings.get("steps", 18)),
        "cfg": float(settings.get("cfg", 2.0)),
        "sampler_name": settings.get("sampler_name", "euler"),
        "scheduler": settings.get("scheduler", "normal"),
        "denoise": float(settings.get("denoise", 0.4)),
        "feather": int(settings.get("feather", 5)),
        "noise_mask": True,
        "force_inpaint": False,
        "bbox_threshold": float(settings.get("bbox_threshold", 0.5)),
        "bbox_dilation": int(settings.get("bbox_dilation", 15)),
        "bbox_crop_factor": float(settings.get("bbox_crop_factor", 3.0)),
        "sam_detection_hint": settings.get("sam_detection_hint", "center-1"),
        "sam_dilation": int(settings.get("sam_dilation", 0)),
        "sam_threshold": float(settings.get("sam_threshold", 0.93)),
        "sam_bbox_expansion": int(settings.get("sam_bbox_expansion", 0)),
        "sam_mask_hint_threshold": float(settings.get("sam_mask_hint_threshold", 0.7)),
        "sam_mask_hint_use_negative": settings.get("sam_mask_hint_use_negative", "False"),
        "drop_size": int(settings.get("drop_size", 10)),
        "wildcard": "",
        "cycle": int(settings.get("cycle", 1)),
    }
    result = _call_node(detailer, values)
    if isinstance(result, tuple):
        return result[0]
    return result


def summarize_settings(settings: Dict[str, Any]) -> str:
    parts: List[str] = []
    mu = settings.get("model_upscale", {})
    dr = settings.get("diffusion_refine", {})
    if mu.get("model_name"):
        parts.append(f"upscale:{mu['model_name']}")
    if dr.get("denoise"):
        parts.append(f"refine:{dr.get('denoise')}")
    if settings.get("watermark", {}).get("text"):
        parts.append("watermark")
    for key in ("face_detailer", "eye_detailer", "hand_detailer"):
        det = settings.get(key, {})
        if det.get("detector"):
            parts.append(f"{key.split('_')[0]}:{det['detector']}")
    return " • ".join(parts) if parts else "Configured"
