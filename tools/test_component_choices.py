"""Run with Python: small fixtures only, no ComfyUI or model weights required."""
import json
import struct
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
package = types.ModuleType('component_test_package')
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
from component_test_package import backend, model_components as components


class ComponentChoices(unittest.TestCase):
    def test_bounded_header_and_payload_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'model.safetensors'
            for descriptor, payload, valid in [
                ({'x': {'dtype': 'F32', 'shape': [2], 'data_offsets': [0, 8]}}, b'\0' * 8, True),
                ({'x': {'dtype': 'F32', 'shape': [2], 'data_offsets': [0, 8]}}, b'\0' * 4, False),
                ({'x': {'dtype': 'F32', 'shape': [2], 'data_offsets': [0, 4]}}, b'\0' * 4, False),
                ({'x': {'dtype': 'F32', 'shape': [1], 'data_offsets': [0, 4]},
                  'y': {'dtype': 'F32', 'shape': [1], 'data_offsets': [0, 4]}}, b'\0' * 4, False),
            ]:
                raw = json.dumps(descriptor).encode()
                path.write_bytes(struct.pack('<Q', len(raw)) + raw + payload)
                components._header.cache_clear()
                self.assertEqual(bool(components.header(path)), valid)
            path.write_bytes(struct.pack('<Q', 17 * 1024 * 1024))
            self.assertEqual(components.header(path), {})

    def test_renamed_encoder_and_vae_identity(self):
        encoder = {'model.embed_tokens.weight': {'shape': [151936, 1024]},
                   'model.layers.27.mlp.up_proj.weight': {'shape': [3072, 1024]}}
        vae = {'conv2.weight': {'shape': [16, 16, 1, 1, 1]},
               'encoder.conv1.weight': {'shape': [96, 3, 3, 3, 3]},
               'decoder.conv1.weight': {'shape': [384, 16, 3, 3, 3]}}
        self.assertEqual(components.identify(encoder, 'text_encoders'), 'qwen3_06b')
        self.assertEqual(components.identify(vae, 'vae'), 'wan16')

    def catalog(self, family, identities, valid=True):
        folders = types.ModuleType('folder_paths')
        folders.get_filename_list = lambda category: [name for cat, name in identities if cat == category]
        folders.get_full_path = lambda category, name: category + '/' + name
        with patch.dict(sys.modules, folder_paths=folders), \
                patch.object(components, 'header', return_value={'tensor': {}} if valid else {}), \
                patch.object(components, 'identify', side_effect=lambda data, cat: None):
            # Classifier gets a path-specific fixture, without file reads.
            with patch.object(components, 'header', side_effect=lambda path: {'identity': identities[tuple(path.split('/', 1))]} if valid else {}), \
                    patch.object(components, 'identify', side_effect=lambda data, cat: data.get('identity')):
                return components.choices(family, backend.AUTO_COMPANIONS)

    def test_renamed_files_are_recommended(self):
        options = self.catalog('anima', {('text_encoders', 'renamed.safetensors'): 'qwen3_06b',
                                          ('vae', 'custom.safetensors'): 'wan16'})
        self.assertEqual(json.loads(options['recommended_clip'])[2], ['renamed.safetensors'])
        self.assertEqual(options['recommended_vae'], 'custom.safetensors')

    def test_misleading_filename_cannot_override_known_architecture(self):
        options = self.catalog('anima', {('text_encoders', 'qwen_3_06b_base.safetensors'): 'qwen3vl_8b'})
        self.assertIsNone(options['recommended_clip'])
        self.assertFalse(options['clips'][0]['compatible'])

    def test_invalid_header_is_never_recommended_by_filename(self):
        options = self.catalog('anima', {('text_encoders', 'qwen_3_06b_base.safetensors'): None}, valid=False)
        self.assertIsNone(options['recommended_clip'])

    def test_required_encoder_group_is_one_choice(self):
        options = self.catalog('sd3', {('text_encoders', 'one'): 'clip_l',
                                      ('text_encoders', 'two'): 'clip_g',
                                      ('text_encoders', 'three'): 't5xxl'})
        layout, _, names = json.loads(options['recommended_clip'])
        self.assertEqual(layout, 'triple')
        self.assertEqual(names, ['one', 'two', 'three'])
        self.assertEqual(len(options['clips']), 1)

    def test_missing_required_group_does_not_auto_select_partial_encoder(self):
        options = self.catalog('flux', {('text_encoders', 'clip_l'): 'clip_l'})
        self.assertIsNone(options['recommended_clip'])

    def test_saved_personal_has_authority_even_when_file_missing(self):
        personal = {'values': {'clip_source': 'Manual', 'encoder_loader': 'single',
                              'encoder_type': 'krea2', 'encoder_1': 'missing.safetensors',
                              'vae_name': 'missing-vae.safetensors'}}
        creator = {'values': {'clip_source': 'Manual', 'encoder_1': 'other', 'vae_name': 'other'}}
        with patch.object(backend, 'read_profile', side_effect=lambda checkpoint, mode: personal if mode == 'Personal' else creator):
            cfg = backend.saved_component_settings('model', backend.settings({}))
            self.assertEqual(cfg['encoder_1'], 'missing.safetensors')
            self.assertEqual(cfg['vae_name'], 'missing-vae.safetensors')
            explicit = backend.saved_component_settings('model', backend.settings({'clip_source': 'External', 'vae_name': 'chosen'}))
            self.assertEqual(explicit['clip_source'], 'External')
            self.assertEqual(explicit['vae_name'], 'chosen')


if __name__ == '__main__':
    unittest.main(verbosity=2)
