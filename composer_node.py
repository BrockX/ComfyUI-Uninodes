"""Original Prompt Composer output signature, now under Uninodes.
Supports chaining and legacy workflows; no user-library files bundled."""
import json
from . import composer_blocks, library_store, composer_categories

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
            used = []
            try:
                opts = json.loads(kwargs.get('socket_settings', '{}'))
            except (ValueError, TypeError):
                opts = {}
            nsfw_visible = opts.get('nsfw_libraries') is True if isinstance(opts, dict) else False
            for b in composer_blocks.read_blocks(raw):
                # Folder rows are organizational only; they have no 'enabled' flag.
                # Accessing it raised KeyError('enabled') in IS_CHANGED, causing
                # ComfyUI to log warnings and bypass ordinary cache comparisons.
                if b['type'] == 'folder' or not b.get('enabled', True):
                    continue
                if b['type'] == 'library':
                    used.extend(library_store.fingerprint(b['library_id'], pid) for pid in b['preset_ids'])
                elif b['type'] == 'category':
                    for lid in composer_categories.visible_library_ids(b['category_id'], b['variant'], nsfw_visible):
                        member = b['members'].get(lid, {})
                        if member.get('enabled'):
                            used.extend(library_store.fingerprint(lid, pid) for pid in member.get('preset_ids', []))
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
        try:
            settings = json.loads(socket_settings or '{}')
        except (ValueError, TypeError):
            settings = {}
        show_nsfw = isinstance(settings, dict) and settings.get('nsfw_libraries') is True
        pos, neg = composer_blocks.compose(legacy_pos, legacy_neg,
                                           positive, negative, blocks_json,
                                           nsfw_categories=show_nsfw, **kwargs)
        if clip is None:
            # Conditioning ports must not be connected on a text-only stage.
            return pos, neg, None, None
        import nodes as comfy_nodes
        cond_positive = comfy_nodes.CLIPTextEncode().encode(clip, pos)[0]
        cond_negative = comfy_nodes.CLIPTextEncode().encode(clip, neg)[0]
        return pos, neg, cond_positive, cond_negative



NODE_CLASS_MAPPINGS = {"CPMPromptComposer": PromptComposer}
NODE_DISPLAY_NAME_MAPPINGS = {"CPMPromptComposer": "Prompt Composer"}
