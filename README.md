# Uninodes

**Uninodes** is a collection of custom [ComfyUI](https://github.com/comfyanonymous/ComfyUI) nodes for building prompts, generating images, finishing them, and comparing the results — without needing a large workflow.

**Current version:** 1.0-ish

## Nodes

| Node | What it does |
| --- | --- |
| **Prompt Composer** | Build positive and negative prompts from reusable blocks and preset libraries. Chain composers together; optionally output encoded conditioning when a CLIP is connected. |
| **Direct Sampler** | Generate images in one node. Choose a checkpoint or diffusion model, configure sampling and resolution, add LoRAs, and use text-to-image or image-to-image. Includes image preview and saving controls. |
| **Image Finisher** | Process an existing image with resizing, model upscaling, tiled diffusion refinement, face/eye/hand detailing, mirroring, and text/image watermarks. Compare the original and processed images and save either or both. |
| **Direct Image Sampler Finisher Ultra Turbo Deluxe** | The all-in-one version: **Sampler settings → Finisher settings → Compare & Save**, arranged in three columns. Generates an image, optionally finishes it, and outputs both the final and original images. Yes, that's its full name. |

All four nodes are available under the **Uninodes** category in ComfyUI.

## Tool

You'll find in tools/ a simple html page you can open. It allows you to open/edit or even create your own libraries.
Libraries accepts variables. Variables can be free input or connected libraries (for exemple, for colors).

## Installation

1. Install and run a recent version of **ComfyUI**.
2. Download this repository as a ZIP from GitHub (**Code → Download ZIP**) or clone it.
3. Copy the **Uninodes** folder into `ComfyUI/custom_nodes/` so the resulting path is:

   ```text
   ComfyUI/
   └── custom_nodes/
       └── Uninodes/
           ├── __init__.py
           ├── backend.py
           ├── web/
           └── ...
   ```

4. Restart ComfyUI and refresh the browser (**Ctrl+F5** if the controls don't appear).
5. Right-click on the canvas and find the nodes under **Uninodes**.

## Dependencies

### Basic features

- **ComfyUI** (with its usual Python dependencies, including PyTorch, NumPy, Pillow and aiohttp).
- **Image model weights** (checkpoints or diffusion models). These are **not included** in the repository.

There is no separate `pip install` step for the basic nodes when ComfyUI's normal environment is already set up.

### Optional features

| Feature | Additional requirement |
| --- | --- |
| Face, eye and hand detailing | [**ComfyUI Impact Pack**](https://github.com/ltdrdata/ComfyUI-Impact-Pack), a compatible detector provider (often [**Impact Subpack**](https://github.com/ltdrdata/ComfyUI-Impact-Subpack)), and detector model weights. A SAM model can be used if configured. |
| Tiled diffusion refinement | [**ComfyUI Ultimate SD Upscale**](https://github.com/ssitu/ComfyUI_UltimateSDUpscale) (the `UltimateSDUpscaleNoUpscale` node). |
| AI model upscaling | A compatible upscaler model in `ComfyUI/models/upscale_models/`. |
| Creator / Personal checkpoint profiles | Optional **Checkpoint Profile Manager** installation with its profile data. Custom settings work without it. |

You only need these extras when enabling the corresponding feature. Simple generation, resizing, comparison, and saving do not require Impact Pack or Ultimate SD Upscale.

## Models

Direct Sampler can list models from:

- `ComfyUI/models/checkpoints/`
- `ComfyUI/models/diffusion_models/`

It supports conventional SD/SDXL-family checkpoints (including Pony and Illustrious), and provides loading paths for several model-only architectures such as **Anima, FLUX, SD3/3.5, Qwen Image, Z-Image, HiDream**, and others supported by your ComfyUI installation.

Some architectures need separate text encoders and VAEs in `models/text_encoders/` and `models/vae/`. Use automatic companion loading where available, manually select the matching encoders, or connect external **MODEL / CLIP / VAE** inputs. Uninodes does **not** download model weights.

**Note:** Model loading is not a guarantee that one sampling preset works for every architecture. Some models require different guidance, schedules, or specialized workflows.

## Quick start

For a simple image-generation workflow, add **Direct Sampler**, select a model, enter a prompt, adjust your settings, and queue the prompt.

To process an existing image, connect it to **Image Finisher** and enable only the operations you want.

For the combined workflow, use **Direct Image Sampler Finisher Ultra Turbo Deluxe**: configure generation in column 1, finishing in column 2, and preview/compare/save in column 3. Its **image** output is the processed result (or the original when finishing is disabled); **original** always preserves the generated image.

## Notes

- Extra detailers and specialized model families depend on the versions of the third-party nodes and ComfyUI installed on your system.
- GPU execution and Node 1.0/2.0 rendering can vary by setup; please include your ComfyUI version, model family, and full error log when reporting issues.
