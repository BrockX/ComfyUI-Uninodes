"""Uninodes: Direct Sampler + Image Finisher, with legacy workflow-compatible IDs."""
from .sampler_node import NODE_CLASS_MAPPINGS as _SAMPLER_NODES, NODE_DISPLAY_NAME_MAPPINGS as _SAMPLER_NAMES
from .finisher_node import NODE_CLASS_MAPPINGS as _FINISHER_NODES, NODE_DISPLAY_NAME_MAPPINGS as _FINISHER_NAMES

from .composer_node import NODE_CLASS_MAPPINGS as _COMPOSER_NODES, NODE_DISPLAY_NAME_MAPPINGS as _COMPOSER_NAMES
from .deluxe_node import NODE_CLASS_MAPPINGS as _DELUXE_NODES, NODE_DISPLAY_NAME_MAPPINGS as _DELUXE_NAMES

NODE_CLASS_MAPPINGS = {**_SAMPLER_NODES, **_FINISHER_NODES, **_COMPOSER_NODES, **_DELUXE_NODES}
NODE_DISPLAY_NAME_MAPPINGS = {**_SAMPLER_NAMES, **_FINISHER_NAMES, **_COMPOSER_NAMES, **_DELUXE_NAMES}
WEB_DIRECTORY = './web'

# Route registration uses the SAME Uninodes namespace for both nodes.
# Keep the import guard narrow: failures in route registration must not be
# silently swallowed as if the endpoints were available.
try:
    from aiohttp import web
    from server import PromptServer
except ImportError:
    web = None

if web is not None:
    from . import backend, image_finisher, output_folders, finisher_exports, sampler_profiles, lora_triggers


    # Prompt Composer library APIs use the pre-existing CPM disk-backed libraries.
    # The original pack's Library Manager may remain installed independently.
    from . import library_store as composer_libraries

    @PromptServer.instance.routes.get('/uninodes/composer/libraries')
    async def uni_composer_libraries(request):
        return web.json_response({'libraries': composer_libraries.list_libraries()})

    @PromptServer.instance.routes.get('/uninodes/composer/library')
    async def uni_composer_library(request):
        try:
            return web.json_response(composer_libraries.get_library(request.query.get('id','')))
        except ValueError as exc:
            return web.json_response({'error':str(exc)},status=400)

    @PromptServer.instance.routes.post('/uninodes/composer/library')
    async def uni_composer_import_library(request):
        try:
            if request.content_length and request.content_length > 550_000:
                raise ValueError('Library exceeds 500 KB')
            return web.json_response(composer_libraries.import_library(await request.json()))
        except (ValueError,TypeError,KeyError) as exc:
            return web.json_response({'error':str(exc)},status=400)

    @PromptServer.instance.routes.get('/uninodes/composer/library/edit')
    async def uni_composer_get_library_edit(request):
        try:
            return web.json_response(composer_libraries.get_library_for_edit(request.query.get('id','')))
        except ValueError as exc:
            return web.json_response({'error':str(exc)},status=400)

    @PromptServer.instance.routes.put('/uninodes/composer/library/edit')
    async def uni_composer_save_library_edit(request):
        try:
            if request.content_length and request.content_length > 550_000:
                raise ValueError('Library exceeds 500 KB')
            return web.json_response(composer_libraries.save_library_edit(await request.json()))
        except composer_libraries.LibraryConflict as exc:
            return web.json_response({'error':str(exc)},status=409)
        except (ValueError,TypeError,KeyError) as exc:
            return web.json_response({'error':str(exc)},status=400)

    @PromptServer.instance.routes.delete('/uninodes/composer/library')
    async def uni_composer_delete_library(request):
        try:
            return web.json_response(composer_libraries.remove_user_library(request.query.get('id','')))
        except ValueError as exc:
            return web.json_response({'error':str(exc)},status=400)

    @PromptServer.instance.routes.get('/uninodes/composer/preset-editor')
    async def uni_composer_editor_page(request):
        from pathlib import Path
        return web.FileResponse(Path(__file__).resolve().parent/'tools'/'preset_library_editor.html',headers={'Cache-Control':'no-cache'})

    @PromptServer.instance.routes.get('/uninodes/sampler/options')
    async def ds_options(request):
        try:
            return web.json_response(backend.available_options())
        except Exception as exc:
            return web.json_response({'error': str(exc)}, status=400)

    @PromptServer.instance.routes.get('/uninodes/sampler/profile')
    async def ds_profile(request):
        try:
            return web.json_response({'profile': backend.read_profile(request.query.get('checkpoint',''),request.query.get('mode','Creator'))})
        except (ValueError, KeyError) as exc:
            return web.json_response({'error': str(exc)}, status=400)

    @PromptServer.instance.routes.post('/uninodes/sampler/profile')
    async def ds_profile_save(request):
        try:
            if request.content_length and request.content_length > 30_000:
                raise ValueError('Profile payload is too large')
            data = await request.json()
            return web.json_response({'profile': sampler_profiles.save_profile(
                data.get('checkpoint'), data.get('mode'), data.get('values'))})
        except (ValueError, TypeError, KeyError) as exc:
            return web.json_response({'error': str(exc)}, status=400)

    @PromptServer.instance.routes.delete('/uninodes/sampler/profile')
    async def ds_profile_delete(request):
        try:
            return web.json_response({'profile': sampler_profiles.delete_profile(
                request.query.get('checkpoint'), request.query.get('mode'))})
        except (ValueError, TypeError, KeyError) as exc:
            return web.json_response({'error': str(exc)}, status=400)

    @PromptServer.instance.routes.get('/uninodes/sampler/lora-triggers')
    async def ds_lora_triggers(request):
        try:
            return web.json_response({'triggers': lora_triggers.list_triggers()})
        except ValueError as exc:
            return web.json_response({'error': str(exc)}, status=400)

    @PromptServer.instance.routes.post('/uninodes/sampler/lora-trigger')
    async def ds_lora_trigger_save(request):
        try:
            if request.content_length and request.content_length > 4096:
                raise ValueError('LoRA trigger payload is too large')
            data = await request.json()
            return web.json_response(lora_triggers.set_trigger(data.get('name'), data.get('trigger')))
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            return web.json_response({'error': str(exc)}, status=400)

    @PromptServer.instance.routes.post('/uninodes/sampler/upload-source')
    async def ds_upload_source(request):
        import io, secrets
        from pathlib import Path
        import folder_paths
        from PIL import Image, ImageOps
        try:
            fields = await request.post()
            field = fields.get('file')
            if field is None:
                raise ValueError('No source image uploaded')
            raw = field.file.read(12_000_001)
            if not raw or len(raw) > 12_000_000:
                raise ValueError('Source image must be 1–12 MB')
            with Image.open(io.BytesIO(raw)) as source:
                if source.width > 8192 or source.height > 8192:
                    raise ValueError('Source image dimensions exceed 8192px')
                image = ImageOps.exif_transpose(source).convert('RGB')
            raw_name = getattr(field, 'filename', '') or 'source'
            safe_name = ''.join(c for c in raw_name if c.isalnum() or c in ('-','_','.')).strip('.') or 'source'
            stem = safe_name.rsplit('.',1)[0] or 'source'
            subfolder = 'direct_sampler_sources'
            dest = Path(folder_paths.get_input_directory()) / subfolder
            dest.mkdir(parents=True, exist_ok=True)
            name = f'{stem}_{secrets.token_hex(5)}.png'
            image.save(dest / name, format='PNG')
            return web.json_response({'filename':name,'subfolder':subfolder,'type':'input',
                                      'name':raw_name,'width':image.width,'height':image.height})
        except (ValueError, TypeError, OSError) as exc:
            return web.json_response({'error':str(exc)}, status=400)

    @PromptServer.instance.routes.get('/uninodes/sampler/folders')
    async def ds_folders(request):
        return web.json_response({'folders': output_folders.list_folders()})

    @PromptServer.instance.routes.post('/uninodes/sampler/folders')
    async def ds_folder_create(request):
        try:
            data = await request.json()
            folder = data.get('folder','')
            output_folders.output_directory(folder, create=True)
            return web.json_response({'folder':folder,'folders':output_folders.list_folders()})
        except (ValueError, TypeError, KeyError) as exc:
            return web.json_response({'error':str(exc)}, status=400)

    @PromptServer.instance.routes.post('/uninodes/sampler/browse-folder')
    async def ds_browse_folder(request):
        import asyncio
        try:
            return web.json_response(await asyncio.to_thread(output_folders.browse_native_folder))
        except (ValueError, OSError) as exc:
            return web.json_response({'error':str(exc)}, status=400)

    @PromptServer.instance.routes.post('/uninodes/sampler/save')
    async def ds_save(request):
        try:
            data=await request.json()
            return web.json_response(backend.save_preview(data.get('token',''), folder=data.get('folder',''), image_format=data.get('format','PNG')))
        except (ValueError, KeyError, TypeError) as exc:
            return web.json_response({'error':str(exc)},status=400)

    @PromptServer.instance.routes.get('/uninodes/finisher/options')
    async def finisher_options(request):
        try:
            from .image_finisher import DEFAULT_SETTINGS, DETAILER_PRESETS
            try:
                from comfy.samplers import KSampler
                samplers, schedulers=list(KSampler.SAMPLERS),list(KSampler.SCHEDULERS)
            except ImportError:
                samplers, schedulers=['euler_ancestral','euler','dpmpp_2m'], ['normal','karras','simple']
            return web.json_response({
                'upscale_models':image_finisher.available_upscale_models(),
                'detector_models':image_finisher.available_detector_models(),
                'sam_models':image_finisher.available_sam_models(),
                'samplers':samplers,'schedulers':schedulers,
                'defaults':DEFAULT_SETTINGS,'detailer_presets':DETAILER_PRESETS,
            })
        except Exception as exc:
            return web.json_response({'error':str(exc)},status=400)

    @PromptServer.instance.routes.get('/uninodes/finisher/folders')
    async def finisher_folders(request):
        return web.json_response({'folders':finisher_exports.list_folders()})

    @PromptServer.instance.routes.post('/uninodes/finisher/folders')
    async def finisher_create_folder(request):
        try:
            data=await request.json()
            folder=data.get('folder','')
            finisher_exports.output_directory(folder,create=True)
            return web.json_response({'folders':finisher_exports.list_folders(),'folder':folder})
        except (ValueError, KeyError, TypeError) as exc:
            return web.json_response({'error':str(exc)},status=400)

    @PromptServer.instance.routes.post('/uninodes/finisher/browse-folder')
    async def finisher_browse_folder(request):
        import asyncio
        try:
            return web.json_response(await asyncio.to_thread(finisher_exports.browse_native_folder))
        except (ValueError, OSError) as exc:
            return web.json_response({'error':str(exc)},status=400)

    @PromptServer.instance.routes.post('/uninodes/finisher/watermark/upload')
    async def finisher_watermark_upload(request):
        import io, secrets
        from pathlib import Path
        import folder_paths
        from PIL import Image, ImageOps
        try:
            fields=await request.post()
            file=fields.get('file')
            if file is None:
                raise ValueError('Select a watermark image')
            raw=file.file.read(12_000_001)
            if len(raw)>12_000_000 or not raw:
                raise ValueError('Watermark image must be 1–12 MB')
            with Image.open(io.BytesIO(raw)) as source:
                if source.width>8192 or source.height>8192:
                    raise ValueError('Watermark image dimensions exceed 8192px')
                image=ImageOps.exif_transpose(source).convert('RGBA')
            subfolder='finisher_watermarks'
            folder=Path(folder_paths.get_input_directory())/subfolder
            folder.mkdir(parents=True,exist_ok=True)
            name='watermark_'+secrets.token_hex(10)+'.png'
            image.save(folder/name,'PNG')
            return web.json_response({'filename':name,'subfolder':subfolder,'type':'input',
                                      'name':str(file.filename or 'Watermark'),
                                      'width':image.width,'height':image.height})
        except (ValueError,OSError,TypeError) as exc:
            return web.json_response({'error':str(exc)},status=400)

    @PromptServer.instance.routes.post('/uninodes/finisher/save')
    async def finisher_save(request):
        try:
            data=await request.json()
            return web.json_response(finisher_exports.save_preview(
                data.get('token'),data.get('variant'),data.get('folder',''),
                data.get('format','PNG'),data.get('placement','suffix'),data.get('detail_label','_Detailed')))
        except (ValueError,KeyError,TypeError) as exc:
            return web.json_response({'error':str(exc)},status=400)

__all__=['NODE_CLASS_MAPPINGS','NODE_DISPLAY_NAME_MAPPINGS','WEB_DIRECTORY']
