"""Curated Prompt Composer category blocks (not disk folders).

Only selected libraries contribute prompt text. Mode-specific libraries are mutually
exclusive at composition time, including when a user switches modes and back.
"""
from __future__ import annotations

TEMPLATES = [
    {"id":"quality","name":"Quality","common":["quality","negative-bundles","quality-rating","quality-period","quality-year"],"modes":{}},
    {"id":"camera","name":"Camera, Composition & Framing","common":["camera","composition"],"modes":{}},
    {"id":"identity","name":"Character Identity","common":["character","character_archetypes","body-features","creature-features","eyes","face-details","hair-color","hairstyles","hair-extras"],"modes":{}},
    {"id":"outfit","name":"Outfit","common":[],"default_mode":"outfits","modes":{
        "outfits":{"label":"Complete outfits","libraries":["outfits","uniforms","costumes","traditional-clothes","fantasy-scifi-gear","swimwear","beachwear"]},
        "wardrobe":{"label":"Wardrobe — piece by piece","libraries":["clothes-top","clothes-bottom","dresses","outerwear","legwear","clothes-footwear","headwear","neckwear-handwear","accessories","materials_fabrics","clothes-underwear","lingerie","revealing-outfits"]}}},
    {"id":"pose","name":"Pose","common":["attitudes_body_language","expressions","hand-gestures","pose-head-torso","pose-arms","pose-legs","pose-orientation","gaze-direction"],
     "default_mode":"base","modes":{
        "base":{"label":"Base positions","libraries":["pose-standing","pose-sitting","pose-kneeling","pose-lying","pose-balance"]},
        "everyday":{"label":"Everyday / interactions","libraries":["pose-everyday","pose-interactions","pose-motion","pose-together"]},
        "action":{"label":"Action / sports","libraries":["pose-combat","pose-acrobatics","pose-flight","pose-jumping","pose-locomotion","pose-sports"]},
        "stylized":{"label":"Stylized","libraries":["pose-dramatic","pose-fashion","pose-iconic","pose-unnatural"]}},
     "nsfw":["pose-suggestive","sexy-poses","nsfw-sexual-poses"]},
    {"id":"setting","name":"Setting","common":["backgrounds","location-era-themes","occasions"],
     "default_mode":"interior","modes":{
        "interior":{"label":"Interior","libraries":["location-indoor"]},
        "exterior":{"label":"Exterior","libraries":["location-outdoor"]}}},
    {"id":"lighting","name":"Lighting","common":["time_of_day","weather","effects"],
     "default_mode":"bright","modes":{
        "bright":{"label":"Bright","libraries":["lighting-bright"]},
        "dark":{"label":"Dark","libraries":["lighting-dark"]}}},
    {"id":"style","name":"Art Style & Colours","common":["styles","color_palettes"],"modes":{}},
    {"id":"props","name":"Props & Objects","common":["props","props-food","props-instruments","props-companions","props-vehicles","props-weapons"],"modes":{}},
    {"id":"roles","name":"Worlds & Roles","common":["fantasy_races","fantasy_classes","scifi_roles"],"modes":{}},
    {"id":"adult","name":"Adult-only Details","nsfw_only":True,"common":["partner-sexual-acts","solo-sexual-action","sex-act-views","effects-fluids","undressing"],"modes":{}},
]
_BY_ID = {t['id']:t for t in TEMPLATES}


def get_template(category_id):
    if not isinstance(category_id, str) or category_id not in _BY_ID:
        raise ValueError(f'Unknown Composer category: {category_id}')
    return _BY_ID[category_id]


def visible_library_ids(category_id, mode='', nsfw_visible=False):
    item = get_template(category_id)
    if item.get('nsfw_only') and not nsfw_visible:
        return []
    libs = list(item.get('common', []))
    modes = item.get('modes', {})
    if modes:
        chosen = mode if mode in modes else item.get('default_mode', next(iter(modes)))
        libs.extend(modes[chosen]['libraries'])
    if nsfw_visible:
        libs.extend(item.get('nsfw', []))
    return list(dict.fromkeys(libs))


def public_templates():
    # Keep UI and backend category membership in one canonical definition.
    return TEMPLATES
