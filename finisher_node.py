"""Uninodes Image Finisher, preserving legacy CPMImageFinisher node type."""
from __future__ import annotations
import json
from . import image_finisher
from .preview_guard import suppress_intermediate_previews
class ContainsAnyDict(dict):
    def __contains__(self, key): return True

class ImageFinisher:
    OUTPUT_NODE = True
    CATEGORY = "Uninodes"
    FUNCTION = "finish"
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "summary")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE",),
            "face": ("BOOLEAN", {"default": False}),
            "eyes": ("BOOLEAN", {"default": False}),
            "hands": ("BOOLEAN", {"default": False}),
            "upscale_using_model": ("BOOLEAN", {"default": False}),
            "simple_upscale": ("BOOLEAN", {"default": False}),
            "mirror": ("BOOLEAN", {"default": False}),
            "watermark": ("BOOLEAN", {"default": False}),
            "settings_json": ("STRING", {"default": "{}", "multiline": False}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            # Appended to preserve existing workflow widget positions.
            "diffusion_refine": ("BOOLEAN", {"default": False}),
            # Appended after legacy widgets so older workflow values keep their positions.
            "enabled": ("BOOLEAN", {"default": True}),
        }, "optional": ContainsAnyDict({
            "finisher": ("DIRECT_FINISHER", {"forceInput": True}),
            "model": ("MODEL", {"forceInput": True}),
            "clip": ("CLIP", {"forceInput": True}),
            "vae": ("VAE", {"forceInput": True}),
            "positive": ("CONDITIONING", {"forceInput": True}),
            "negative": ("CONDITIONING", {"forceInput": True}),
        })}

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        settings = image_finisher.parse_settings(kwargs.get("settings_json", "{}"))
        return json.dumps({
            "toggles": {k: kwargs.get(k) for k in ("face", "eyes", "hands", "upscale_using_model", "simple_upscale", "mirror", "watermark", "diffusion_refine", "enabled")},
            "settings": settings,
            "seed": kwargs.get("seed", 0),
        }, sort_keys=True)

    def finish(self, image, face=False, eyes=False, hands=False, upscale_using_model=False, simple_upscale=False,
               mirror=False, watermark=False, settings_json='{}', seed=0, model=None, clip=None, vae=None,
               positive=None, negative=None, diffusion_refine=False, enabled=True, finisher=None):
        from . import finisher_exports
        settings = image_finisher.parse_settings(settings_json)
        if isinstance(finisher, dict) and finisher.get('schema', '').startswith('DIRECT_FINISHER/'):
            model = model if model is not None else finisher.get('model')
            clip = clip if clip is not None else finisher.get('clip')
            vae = vae if vae is not None else finisher.get('vae')
            positive = positive if positive is not None else finisher.get('positive')
            negative = negative if negative is not None else finisher.get('negative')
            if seed == 0 and finisher.get('seed') is not None:
                seed = finisher['seed']
        if not enabled:
            summary = 'Image Finisher • bypassed (original image)'
            previews = finisher_exports.store_preview(image, image, summary=summary, enabled=False)
            return {'ui': {'if_images': previews, 'if_enabled': [False], 'if_summary': [summary]},
                    'result': (image, summary)}
        current = image
        notes = []
        if mirror:
            current = image_finisher.apply_mirror(current, settings.get("mirror", {}).get("mode", "horizontal"))
            notes.append(f"mirror:{settings.get('mirror', {}).get('mode', 'horizontal')}")
        # The target is relative to the original image, not to the intermediate
        # resolution of the selected ESRGAN model (often 4x). Both toggle paths
        # share one target scale. With both enabled, model enhancement takes
        # precedence over simple interpolation; their factors NEVER multiply.
        if simple_upscale or upscale_using_model:
            su = settings.get("simple_upscale", {})
            scale = su.get("scale", 2.0)
            method = su.get("method", "lanczos")
            target_width, target_height = image_finisher.scaled_dimensions(current, scale)
            if upscale_using_model:
                mu = settings.get("model_upscale", {})
                current = image_finisher.upscale_with_model(current, mu.get("model_name", ""))
                current = image_finisher.resize_to_dimensions(current, target_width, target_height, method)
                notes.append(f"model:{mu.get('model_name', '')} → x{float(scale):g}")
            else:
                current = image_finisher.resize_to_dimensions(current, target_width, target_height, method)
                notes.append(f"simple x{float(scale):g}")
        # Nested Ultimate SD Upscale / Impact Pack samplers send their own
        # intermediate tile/detailer preview images. Suppress only those
        # websocket image payloads; leave progress and final Studio images intact.
        with suppress_intermediate_previews():
            if diffusion_refine:
                dr = settings.get("diffusion_refine", {})
                current = image_finisher.run_diffusion_refine(
                    current, settings=dr, model=model, vae=vae,
                    positive=positive, negative=negative, seed=seed,
                )
                notes.append(f"diffusion:{dr.get('denoise', 0.25):.2f}")
            face_cfg = settings.get("face_detailer", {})
            eye_cfg = settings.get("eye_detailer", {})
            hand_cfg = settings.get("hand_detailer", {})
            detector_cache, sam_cache = {}, {}  # Reuse detector/SAM instances within this execution.
            if face:
                current = image_finisher.run_face_detailer(current, detector_model=face_cfg.get("detector", ""), settings=face_cfg, model=model, clip=clip, vae=vae, positive=image_finisher.detailer_positive(face_cfg, clip, positive), negative=negative, seed=seed, detector_cache=detector_cache, sam_cache=sam_cache)
                notes.append(f"face:{face_cfg.get('detector', '')}")
            if eyes:
                current = image_finisher.run_face_detailer(current, detector_model=eye_cfg.get("detector", ""), settings=eye_cfg, model=model, clip=clip, vae=vae, positive=image_finisher.detailer_positive(eye_cfg, clip, positive), negative=negative, seed=seed, detector_cache=detector_cache, sam_cache=sam_cache)
                notes.append(f"eyes:{eye_cfg.get('detector', '')}")
            if hands:
                current = image_finisher.run_face_detailer(current, detector_model=hand_cfg.get("detector", ""), settings=hand_cfg, model=model, clip=clip, vae=vae, positive=image_finisher.detailer_positive(hand_cfg, clip, positive), negative=negative, seed=seed, detector_cache=detector_cache, sam_cache=sam_cache)
                notes.append(f"hands:{hand_cfg.get('detector', '')}")
        if watermark:
            wm = settings.get("watermark", {})
            current = image_finisher.apply_watermark(current, wm)
            if wm.get('text') or wm.get('image'):
                notes.append("watermark")
        summary = "Image Finisher • " + (", ".join(notes) if notes else "no operations enabled")
        previews = finisher_exports.store_preview(image, current, summary=summary, enabled=True)
        return {'ui': {'if_images': previews, 'if_enabled': [True], 'if_summary': [summary]},
                'result': (current, summary)}

NODE_CLASS_MAPPINGS={"CPMImageFinisher":ImageFinisher}
NODE_DISPLAY_NAME_MAPPINGS={"CPMImageFinisher":"Image Finisher"}
