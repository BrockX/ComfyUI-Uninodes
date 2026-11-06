import os, sys, types, unittest, tempfile, json, re
sys.dont_write_bytecode = True
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parent.parent
COMFY = Path(os.environ['COMFYUI_PATH'])
sys.path.insert(0, str(COMFY))
import nodes, folder_paths, torch, comfy.sd, comfy.latent_formats as lf, comfy.sample
package = types.ModuleType('audit_uninodes')
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
from audit_uninodes import backend as b, sampler_profiles as profiles

def model(config_name, latent, **unet):
    config = type(config_name, (), {'unet_config': unet})()
    internal = types.SimpleNamespace(model_config=config, latent_format=latent)
    return types.SimpleNamespace(model=internal, get_model_object=lambda key: getattr(internal, key))

class CompatibilityTests(unittest.TestCase):
    def test_native_latent_shapes_and_noise(self):
        cases = [('SD15', lf.SD15(), (2,4,64,64)), ('SDXL',lf.SDXL(),(2,4,64,64)),
                 ('SD3',lf.SD3(),(2,16,64,64)), ('Flux',lf.Flux(),(2,16,64,64)),
                 ('Flux2',lf.Flux2(),(2,128,32,32)), ('Anima',lf.Wan21(),(2,16,1,64,64)),
                 ('Krea2',lf.Wan21(),(2,16,1,64,64)), ('QwenImage',lf.Wan21(),(2,16,1,64,64)),
                 ('Lumina2',lf.Flux(),(2,16,64,64)), ('Chroma',lf.Flux(),(2,16,64,64)),
                 ('ZImage',lf.Flux(),(2,16,64,64)), ('HunyuanImage21',lf.HunyuanImage21(),(2,64,16,16)),
                 ('Omnigen2',lf.Flux(),(2,16,64,64)), ('HiDream',lf.Flux(),(2,16,64,64))]
        for name, latent, shape in cases:
            with self.subTest(model=name):
                m=model(name,latent)
                samples=b._empty_latent_for_model(m,dict(width=512,height=512,batch_size=2))['samples']
                self.assertEqual(tuple(samples.shape),shape)
                samples=comfy.sample.fix_empty_latent_channels(m,samples)
                self.assertEqual(tuple(samples.shape),shape)
                noise=comfy.sample.prepare_noise(samples,42)
                self.assertEqual(tuple(noise.shape),shape)
                self.assertTrue(torch.isfinite(noise).all())
    def test_video_and_refiner_remain_rejected(self):
        for name in ('WAN21','HunyuanImage21Refiner','Unknown'):
            with self.subTest(model=name), self.assertRaisesRegex(ValueError,'dedicated workflow'):
                b._empty_latent_for_model(model(name,lf.Wan21()),dict(width=512,height=512,batch_size=1))
    def test_loaded_architecture_overrides_filename(self):
        for name, family in [('Krea2','krea2'),('QwenImage','qwen_image'),('Anima','anima'),('ZImage','z_image'),('Chroma','chroma'),('Lumina2','lumina2'),('HiDream','hidream'),('HunyuanImage21','hunyuan_image'),('Omnigen2','omnigen2'),('SD3','sd3')]:
            with self.subTest(model=name):
                self.assertEqual(b._model_family('[Diffusion] renamed.safetensors',model(name,lf.Wan21())),family)
        self.assertEqual(b._model_family('flux2-dev.safetensors',model('WAN21',lf.Wan21())),'unknown')
    def test_flux2_architecture_selects_encoder_width(self):
        for width,family in [(7680,'flux2_klein_4b'),(12288,'flux2_klein_9b'),(15360,'flux2'),(999,'unknown')]:
            self.assertEqual(b._model_family('misleading-flux2-dev.safetensors',model('Flux2',lf.Flux2(),context_in_dim=width)),family)
    def test_sd3_and_hidream_native_encoder_api(self):
        for layout,count in [('triple',3),('quad',4)]:
            names=[f'encoder_{i}.safetensors' for i in range(count)]
            with self.subTest(layout=layout), patch.object(folder_paths,'get_filename_list',return_value=names), patch.object(folder_paths,'get_full_path_or_raise',side_effect=lambda category,name: 'resolved/'+name), patch.object(folder_paths,'get_folder_paths',return_value=['embeddings']), patch.object(comfy.sd,'load_clip',return_value='CLIP') as load:
                self.assertEqual(b._load_encoder_uncached(layout,None,names),'CLIP')
                load.assert_called_once_with(ckpt_paths=['resolved/'+name for name in names],embedding_directory=['embeddings'])
    def test_encoder_missing_file_fails_before_loading(self):
        with patch.object(folder_paths,'get_filename_list',return_value=[]), patch.object(comfy.sd,'load_clip') as load:
            with self.assertRaisesRegex(ValueError,'Missing selected'):
                b._load_encoder_uncached('quad',None,['a','b','c','d'])
            load.assert_not_called()
    def test_companion_recovery_uses_actual_model(self):
        cfg=b.settings({})
        files={'text_encoders':['sub/qwen3vl_4b_fp8_scaled.safetensors'],'vae':['qwen_image_vae.safetensors']}
        options={'recommended_clip':json.dumps(['single','krea2',files['text_encoders']]),'recommended_vae':files['vae'][0]}
        with patch.object(b,'component_options',return_value=options), patch.object(b,'_load_encoder',return_value='clip') as enc, patch.object(b,'_load_vae',return_value='vae'):
            self.assertEqual(b._recover_known_components('renamed.safetensors',cfg,None,None,model=model('Krea2',lf.Wan21())),('clip','vae'))
            enc.assert_called_once_with('single','krea2',files['text_encoders'])
    def test_explicit_components_never_overridden(self):
        with patch.object(b,'_load_encoder') as enc,patch.object(b,'_load_vae') as vae:
            self.assertEqual(b._recover_known_components('krea2',b.settings({}),'manual clip','manual vae',model=model('Krea2',lf.Wan21())),('manual clip','manual vae'))
            b._recover_known_components('krea2',b.settings({'clip_source':'External','vae_name':'External'}),None,None,model=model('Krea2',lf.Wan21()))
            enc.assert_not_called(); vae.assert_not_called()
    def test_ambiguous_companion_not_guessed(self):
        with patch.object(folder_paths,'get_filename_list',return_value=['a/ae.safetensors','b/ae.safetensors']):
            self.assertIsNone(b._installed_file_with_basename('vae','ae.safetensors'))
    def test_creator_personal_roundtrip_custom_components(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp,patch.object(profiles,'PROFILE_FILE',Path(tmp)/'profiles.json'),patch.object(profiles,'LEGACY_FILES',()):
            for mode in ('Creator','Personal'):
                original=dict(vae_name='custom-vae.safetensors',clip_source='Manual',encoder_loader='quad',encoder_type='hidream',encoder_1='a',encoder_2='b',encoder_3='c',encoder_4='d')
                profiles.save_profile('renamed.safetensors',mode,original)
                loaded=profiles.get_profile('renamed.safetensors',mode)['values']
                for key,value in original.items(): self.assertEqual(loaded[key],value)
                cfg,_=b.effective_settings('renamed.safetensors',mode,{},reader=profiles.get_profile)
                for key,value in original.items(): self.assertEqual(cfg[key],value)
                self.assertIsNone(profiles.get_profile('another-model.safetensors',mode))
    def test_frontend_backend_profile_contract(self):
        js=(ROOT/'web/direct_sampler.js').read_text(encoding='utf-8')
        fields=re.search(r'const SAMPLER_PROFILE_FIELDS=\[(.*?)\];',js).group(1)
        self.assertEqual(set(re.findall(r"'([^']+)'",fields)),set(profiles.PROFILE_FIELDS))
    def test_recipes_match_installed_encoder_types(self):
        options=b.encoder_loader_options()
        for family,(layout,kind,*_) in b.AUTO_COMPANIONS.items():
            if layout in ('single','dual'):
                with self.subTest(family=family):self.assertIn(kind,options[layout])
    def test_external_models_i2i_mask_and_decode_use_native_nodes(self):
        for name,latent_format in [('SDXL',lf.SDXL()),('Krea2',lf.Wan21())]:
            class VAE:
                def spacial_compression_encode(self):return 8
                def encode(self,pixels):
                    shape=(1,latent_format.latent_channels,64,64)
                    if latent_format.latent_dimensions==3:shape=(1,latent_format.latent_channels,1,64,64)
                    return torch.ones(shape)
                def decode(self,samples):
                    shape=(1,512,512,3) if samples.ndim==4 else (1,1,512,512,3)
                    return torch.full(shape,0.5)
            m=model(name,latent_format)
            for masked in (False,True):
                with self.subTest(model=name,masked=masked),patch.object(folder_paths,'get_filename_list',return_value=[]),patch.object(b,'load_checkpoint_cached') as load,patch.object(b,'sample_with_direct_preview',side_effect=lambda model,seed,cfg,pc,nc,lat,**kwargs:lat) as sample:
                    result=b.encode_and_sample('absent-checkpoint',42,'','',dict(mode='i2i',width=512,height=512,clip_source='External',vae_name='External'),model=m,vae=VAE(),positive_conditioning=['positive'],negative_conditioning=['negative'],init_image=torch.ones((1,512,512,3)),mask=torch.ones((1,512,512)) if masked else None)
                    load.assert_not_called()
                    self.assertEqual(tuple(result[0].shape),(1,512,512,3))
                    self.assertEqual(result[2]['samples'].ndim,5 if name=='Krea2' else 4)
                    self.assertEqual('noise_mask' in sample.call_args.args[5],masked)
                    self.assertEqual(result[3],['positive'])

if __name__=='__main__': unittest.main(verbosity=2)

