import torch
import os
import time
from PIL import Image
from diffusers import Flux2KleinPipeline

#BASE_MODEL = "black-forest-labs/FLUX.2-klein-4B"
# Match the ComfyUI workflow: flux-2-klein-base-4b-fp8 is the BASE model,
# not the distilled 4-step variant. The base model supports real CFG guidance
# and produces far more stable output with the RefControl LoRA.
BASE_MODEL = "black-forest-labs/FLUX.2-klein-base-4B"
# FP8 transformer checkpoint (same file ComfyUI loads via UNETLoader) —
# 4GB instead of ~8GB bf16. Loaded as a pipeline component when supported.
TRANSFORMER_FP8 = "https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4b-fp8/resolve/main/flux-2-klein-base-4b-fp8.safetensors"
LORA_MODEL = "thedeoxen/refcontrol-FLUX.2-klein-4B-reference-depth-lora"

# Match the ComfyUI workflow settings:
#   Flux2Scheduler steps=20, CFGGuider cfg=5, empty negative prompt,
#   positive prompt is literally "refcontrol" (the LoRA trigger word).
# NOTE: 4 steps is only correct for the *distilled* klein model — the base
# model is not step-distilled, so 4 steps leaves it under-denoised and the
# output comes out dark/muted.
NUM_STEPS = 20
GUIDANCE_SCALE = 5.0
# RefControl LoRA weight — at full strength (1.0) the depth LoRA can
# over-saturate dark boundaries; 0.8 keeps natural lighting. Passed through
# attention_kwargs -> joint_attention_kwargs on the transformer.
LORA_SCALE = 0.8
TRIGGER_WORD = "refcontrol"

_pipe = None
_debug_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "debug")
os.makedirs(_debug_dir, exist_ok=True)


def get_pipeline():
    global _pipe
    if _pipe is not None:
        return _pipe

    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32

    # Load the text encoder in 8-bit — the Qwen3 text encoder is the largest
    # non-transformer component and can be aggressively quantized without
    # hurting layout performance. Falls back to bf16 if bitsandbytes is
    # unavailable (e.g. unsupported on this ROCm build).
    text_encoder = None
    try:
        from transformers import AutoModel, BitsAndBytesConfig
        text_encoder = AutoModel.from_pretrained(
            BASE_MODEL,
            subfolder="text_encoder",
            quantization_config=BitsAndBytesConfig(load_in_8bit=True),
            torch_dtype=dtype,
        )
        print("[depth_to_image] Text encoder loaded in 8-bit (bitsandbytes)")
    except Exception as e:
        print(f"[depth_to_image] 8-bit text encoder unavailable ({e}); using bf16")

    kwargs = {"torch_dtype": dtype}
    if text_encoder is not None:
        kwargs["text_encoder"] = text_encoder

    # Prefer the fp8 transformer checkpoint (4GB, same file ComfyUI loads)
    # over the bf16 transformer bundled in the diffusers repo (~8GB).
    # Falls back to the repo's bf16 weights if fp8 loading is unsupported.
    try:
        from diffusers import Flux2Transformer2DModel
        transformer = Flux2Transformer2DModel.from_single_file(
            TRANSFORMER_FP8, torch_dtype=dtype
        )
        kwargs["transformer"] = transformer
        print("[depth_to_image] Transformer loaded from fp8 checkpoint")
    except Exception as e:
        print(f"[depth_to_image] fp8 transformer unavailable ({e}); using repo bf16 weights")

    _pipe = Flux2KleinPipeline.from_pretrained(BASE_MODEL, **kwargs)
    _pipe.load_lora_weights(LORA_MODEL)

    # Sequential CPU offload: each submodule (text encoder, transformer, VAE)
    # is moved to the GPU only for its step and back to the 64GB system RAM
    # immediately after — keeps peak VRAM well under 16GB.
    try:
        _pipe.enable_sequential_cpu_offload()
        print("[depth_to_image] Sequential CPU offload enabled")
    except Exception as e:
        print(f"[depth_to_image] Sequential offload unavailable ({e}); using model offload")
        _pipe.enable_model_cpu_offload()

    return _pipe


def scale_to_resolution(img, resolution=1024):
    """Scale an image to ~resolution² total pixels while preserving aspect ratio.

    Matches ComfyUI's ImageScaleToTotalPixels (nearest-exact), where the
    target pixel count is resolution × resolution (1024 → ~1MP, 2048 → ~4MP).
    Dimensions are rounded to multiples of 8 for VAE compatibility.
    """
    w, h = img.size
    target = int(resolution) * int(resolution)
    scale = (target / (w * h)) ** 0.5
    new_w = max(8, int(round(w * scale / 8)) * 8)
    new_h = max(8, int(round(h * scale / 8)) * 8)
    if (new_w, new_h) == (w, h):
        return img
    return img.resize((new_w, new_h), Image.NEAREST)


def depth_to_image(depth_map_image, reference_image, prompt="", seed=-1, resolution=1024):
    """Generate an output image by fusing a reference image with a depth map using the RefControl LoRA.

    The depth map provides pose/structure, the reference image provides identity/style.
    Mirrors the ComfyUI workflow: both images are scaled to resolution² total
    pixels (aspect preserved), VAE-encoded, and attached as reference latents
    to the conditioning.

    Args:
        depth_map_image: PIL Image — depth map (controls pose/structure)
        reference_image: PIL Image — reference image (controls identity/style)
        prompt: str — optional extra prompt text ("refcontrol" trigger word is always included)
        seed: int — random seed for reproducibility (-1 = random)
        resolution: int — target texture resolution in px (1024/2048/4096)

    Returns:
        PIL Image — generated output image
    """
    print(f"[depth_to_image] depth_map_image: {depth_map_image.size if depth_map_image else None} mode={depth_map_image.mode if depth_map_image else None}, "
          f"reference_image: {reference_image.size if reference_image else None} mode={reference_image.mode if reference_image else None}, "
          f"prompt: {prompt!r}, seed: {seed}, resolution: {resolution}")

    if depth_map_image is None or reference_image is None:
        print("[depth_to_image] Returning None — missing depth map or reference image")
        return None

    # Save debug copies of the inputs so we can verify they're correct
    ts = int(time.time())
    depth_map_image.save(os.path.join(_debug_dir, f"depth_{ts}.png"))
    reference_image.save(os.path.join(_debug_dir, f"reference_{ts}.png"))
    print(f"[depth_to_image] Saved debug images to {_debug_dir} (timestamp {ts})")

    pipe = get_pipeline()

    # The RefControl LoRA requires its trigger word — without it the LoRA
    # barely engages and the depth map gets ignored.
    full_prompt = f"{prompt} {TRIGGER_WORD}".strip()

    # Convert both images to RGB — the pipeline expects 3-channel images.
    # Depth maps may arrive as "L" (grayscale) or "RGBA" depending on the upload path.
    depth_rgb = depth_map_image.convert("RGB")
    ref_rgb = reference_image.convert("RGB")

    # Scale to ~resolution² preserving aspect ratio (ComfyUI ImageScaleToTotalPixels).
    # Do NOT stretch to a fixed square — that distorts non-square images.
    depth_scaled = scale_to_resolution(depth_rgb, resolution)
    ref_scaled = scale_to_resolution(ref_rgb, resolution)

    out_w, out_h = depth_scaled.size
    print(f"[depth_to_image] depth_scaled: {depth_scaled.size}, ref_scaled: {ref_scaled.size}")
    print(f"[depth_to_image] full_prompt: {full_prompt!r}")

    generator = None
    if seed is not None and int(seed) >= 0:
        generator = torch.Generator(device="cpu").manual_seed(int(seed))

    # Free any dead VRAM allocations before starting — keeps the 16GB
    # budget clean between generations.
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    with torch.inference_mode():
        result = pipe(
            prompt=full_prompt,
            image=[depth_scaled, ref_scaled],
            height=out_h,
            width=out_w,
            num_inference_steps=NUM_STEPS,
            guidance_scale=GUIDANCE_SCALE,
            attention_kwargs={"scale": LORA_SCALE},
            generator=generator,
        )
    print(f"[depth_to_image] Generated image: {result.images[0].size}")

    # Save debug copy of the output
    result.images[0].save(os.path.join(_debug_dir, f"output_{ts}.png"))
    print(f"[depth_to_image] Saved debug output to {_debug_dir} (timestamp {ts})")

    # Free the input images from memory — the temp files on disk are cleaned
    # up by Gradio's delete_cache=(60, 60) setting on the Blocks app.
    del depth_map_image, reference_image, depth_rgb, ref_rgb, depth_scaled, ref_scaled
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return result.images[0]
