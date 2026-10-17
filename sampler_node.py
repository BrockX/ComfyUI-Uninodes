"""ComfyUI node registration for independent Direct Sampler."""
from __future__ import annotations

import json
import folder_paths
from . import backend


def _checkpoints():
    return backend.model_selector_options() or ["(no checkpoint installed)"]

class DirectSampler:
    """All-in-one image generation with independent Prompt Composer text inputs."""
    CATEGORY="Uninodes"
    FUNCTION="generate"
    RETURN_TYPES=("IMAGE", "DIRECT_FINISHER", "LATENT", "CONDITIONING", "CONDITIONING")
    RETURN_NAMES=("image", "finisher", "latent", "positive_cond", "negative_cond")
    OUTPUT_NODE=True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required":{
                "checkpoint":(_checkpoints(),),
                "profile_mode":(["Creator","Personal","Custom"],{"default":"Custom"}),
                "seed":("INT",{"default":0,"min":0,"max":0xffffffffffffffff}),
                "settings_json":("STRING",{"default":json.dumps(backend.DEFAULT),"multiline":False}),
            },
            "optional":{
                "positive":("STRING",{"forceInput":True}),
                "negative":("STRING",{"forceInput":True}),
                "latent":("LATENT",{"forceInput":True}),
                "lora_stack":("DIRECT_LORA_STACK",{"forceInput":True}),
                "model":("MODEL",{"forceInput":True}),
                "clip":("CLIP",{"forceInput":True}),
                "vae":("VAE",{"forceInput":True}),
                "positive_conditioning":("CONDITIONING",{"forceInput":True}),
                "negative_conditioning":("CONDITIONING",{"forceInput":True}),
                "init_image":("IMAGE",{"forceInput":True}),
                "mask":("MASK",{"forceInput":True}),
            },
            "hidden":{"unique_id":"UNIQUE_ID"},
        }

    @classmethod
    def IS_CHANGED(cls, checkpoint=None, profile_mode="Custom",seed=0,settings_json="{}",**kwargs):
        profile=None
        try:
            profile=backend.read_profile(checkpoint,profile_mode)
        except Exception as exc:
            profile={"error":str(exc)}
        return json.dumps({"checkpoint":checkpoint,"profile":profile,"seed":seed,"settings":settings_json},sort_keys=True)

    def generate(self,checkpoint,profile_mode,seed,settings_json,positive="",negative="",unique_id=None,**kwargs):
        image,bundle,lat,pc,nc=backend.encode_and_sample(
            checkpoint,seed,positive or "",negative or "",settings_json,profile_mode,
            unique_id=unique_id,**kwargs)
        metadata={"checkpoint": checkpoint, "seed": int(seed), "profile_mode": profile_mode, "prompts": bundle.get("prompts", {}), "metadata": bundle.get("metadata", {})}
        previews=backend.record_previews(image, metadata)
        return {"ui":{"ds_images":previews,"ds_seed":[str(seed)]},
                "result":(image,bundle,lat,pc,nc)}

NODE_CLASS_MAPPINGS={"CPMDirectSampler":DirectSampler}
NODE_DISPLAY_NAME_MAPPINGS={"CPMDirectSampler":"Direct Sampler"}
