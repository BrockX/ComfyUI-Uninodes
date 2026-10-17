"""Single-pass Direct Sampler -> Image Finisher, reusing both production pipelines.

Separate configuration payloads prevent settings collisions and preserve existing
Direct Sampler and Image Finisher nodes and saved workflows.
"""
from __future__ import annotations

import json
from .sampler_node import DirectSampler
from .finisher_node import ImageFinisher


class DirectImageSamplerFinisherUltraTurboDeluxe:
    CATEGORY = "Uninodes"
    FUNCTION = "generate_and_finish"
    OUTPUT_NODE = True
    RETURN_TYPES = ("IMAGE", "IMAGE", "LATENT", "CONDITIONING", "CONDITIONING")
    RETURN_NAMES = ("image", "original", "latent", "positive_cond", "negative_cond")

    @classmethod
    def INPUT_TYPES(cls):
        sampler = DirectSampler.INPUT_TYPES()
        finisher = ImageFinisher.INPUT_TYPES()
        required = dict(sampler["required"])
        # The two editors must never read/write the same settings_json widget.
        required["finisher_settings_json"] = (
            "STRING", {"default": json.dumps({}), "multiline": False}
        )
        for key in (
            "face", "eyes", "hands", "upscale_using_model", "simple_upscale",
            "mirror", "watermark", "diffusion_refine", "enabled",
        ):
            required[key] = finisher["required"][key]
        return {
            "required": required,
            "optional": dict(sampler["optional"]),
            "hidden": dict(sampler.get("hidden", {})),
        }

    @classmethod
    def IS_CHANGED(cls, checkpoint=None, profile_mode="Custom", seed=0,
                   settings_json="{}", finisher_settings_json="{}", **kwargs):
        sampler_change = DirectSampler.IS_CHANGED(
            checkpoint=checkpoint, profile_mode=profile_mode,
            seed=seed, settings_json=settings_json,
        )
        finisher_change = ImageFinisher.IS_CHANGED(
            settings_json=finisher_settings_json, seed=seed, **kwargs
        )
        return json.dumps([sampler_change, finisher_change], sort_keys=True)

    def generate_and_finish(self, checkpoint, profile_mode, seed, settings_json,
                            finisher_settings_json="{}", positive="", negative="",
                            unique_id=None, face=False, eyes=False, hands=False,
                            upscale_using_model=False, simple_upscale=False,
                            mirror=False, watermark=False, diffusion_refine=False,
                            enabled=True, **kwargs):
        generated = DirectSampler().generate(
            checkpoint=checkpoint, profile_mode=profile_mode, seed=seed,
            settings_json=settings_json, positive=positive, negative=negative,
            unique_id=unique_id, **kwargs,
        )
        original, bundle, latent, positive_cond, negative_cond = generated["result"]
        finished = ImageFinisher().finish(
            image=original, face=face, eyes=eyes, hands=hands,
            upscale_using_model=upscale_using_model,
            simple_upscale=simple_upscale, mirror=mirror, watermark=watermark,
            diffusion_refine=diffusion_refine, enabled=enabled,
            settings_json=finisher_settings_json, seed=seed, finisher=bundle,
        )
        processed, summary = finished["result"]
        ui = {**generated.get("ui", {}), **finished.get("ui", {})}
        return {"ui": ui,
                "result": (processed, original, latent, positive_cond, negative_cond)}


NODE_CLASS_MAPPINGS = {
    "CPMDirectImageSamplerFinisherUltraTurboDeluxe": DirectImageSamplerFinisherUltraTurboDeluxe
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "CPMDirectImageSamplerFinisherUltraTurboDeluxe":
        "Direct Image Sampler Finisher Ultra Turbo Deluxe"
}
