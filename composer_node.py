"""Original Prompt Composer output signature, now under Uninodes.
Supports chaining and legacy workflows; no user-library files bundled."""
import json
from . import composer_blocks, library_store

class ContainsAnyDict(dict):
    """Comfy's documented pattern for frontend-created optional STRING ports."""
    def __contains__(self, key):
        return True




class PromptComposer:
    CATEGORY = "Uninodes"
    FUNCTION = "encode"
    RETURN_TYPES = ("STRING", "STRING", "CONDITIONING", "CONDITIONING")
    RETURN_NAMES = ("positive_text", "negative_text", "positive", "negative")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}, "optional": ContainsAnyDict({
            # Keep these three sockets in the same relative order as v1.5.10,
            # preserving existing connections when labels are migrated.
            "clip": ("CLIP", {"forceInput": True}),
            "positive": ("STRING", {"forceInput": True}),
            "negative": ("STRING", {"forceInput": True}),
            "blocks_json": ("STRING", {"default": "[]", "multiline": False}),
            # Front-end socket visibility is serialized in this hidden widget.
            "socket_settings": ("STRING", {"default": '{"clip":false,"conditioning":false}', "multiline": False}),
        })}

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, **kwargs):
        return True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        raw = kwargs.get("blocks_json", "[]")
        try:
            used = [library_store.fingerprint(b["library_id"], b["preset_id"])
                    for b in composer_blocks.read_blocks(raw)
                    if b["type"] == "library" and b["enabled"]]
        except ValueError as err:
            used = [str(err)]
        return json.dumps({"inputs": {k: str(v) for k, v in kwargs.items()}, "libraries": used}, sort_keys=True)

    def encode(self, clip=None, positive="", negative="", blocks_json="[]",
               socket_settings='', **kwargs):
        # Every stage always produces both final text strings. Intermediate
        # Composers may omit CLIP and feed the STRING outputs into a later one.
        # Accept legacy API fields invisibly while new nodes have no Main Prompt.
        legacy_pos = kwargs.pop('positive_prompt', '')
        legacy_neg = kwargs.pop('negative_prompt', '')
        pos, neg = composer_blocks.compose(legacy_pos, legacy_neg,
                                           positive, negative, blocks_json, **kwargs)
        if clip is None:
            # Conditioning ports must not be connected on a text-only stage.
            return pos, neg, None, None
        import nodes as comfy_nodes
        cond_positive = comfy_nodes.CLIPTextEncode().encode(clip, pos)[0]
        cond_negative = comfy_nodes.CLIPTextEncode().encode(clip, neg)[0]
        return pos, neg, cond_positive, cond_negative



NODE_CLASS_MAPPINGS = {"CPMPromptComposer": PromptComposer}
NODE_DISPLAY_NAME_MAPPINGS = {"CPMPromptComposer": "Prompt Composer"}
