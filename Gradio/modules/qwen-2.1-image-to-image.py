import torch
import os
import time
from PIL import Image

# Qwen-Image-2.1 — unified text-to-image + image editing model (7B visual DiT,
# 32 single-stream layers). Image editing is driven by passing `image` to the
# same pipeline; up to 10 reference images are supported (we use 1 here).
# Requires transformers>=5.17 and a diffusers new enough to ship
# QwenImage21Pipeline (PR #14804) — the lazy import inside get_pipeline()
# keeps the app bootable on older installs and raises a clear error on use.
BASE_MODEL = "Qwen/Qwen-Image-2.1"
# Model card default for both T2I and editing.
NUM_STEPS = 40

_pipe = None
_debug_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "debug")
os.makedirs(_debug_dir, exist_ok=True)


def get_pipeline():
    global _pipe
    if _pipe is not None:
        return _pipe

    try:
        from diffusers import QwenImage21Pipeline
    except ImportError as e:
        raise ImportError(
            "QwenImage21Pipeline is not available — upgrade diffusers "
            "(pip install git+https://github.com/huggingface/diffusers) "
            "and transformers>=5.17."
        ) from e

    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    # NOTE: no .to("cuda") — sequential CPU offload manages device placement
    # itself; calling .to("cuda") first would defeat it.
    _pipe = QwenImage21Pipeline.from_pretrained(BASE_MODEL, torch_dtype=dtype)

    # Sequential CPU offload: each submodule (text encoder, transformer, VAE)
    # is moved to the GPU only for its step and back to system RAM
    # immediately after — keeps peak VRAM well under 16GB on a 7B model.
    try:
        _pipe.enable_sequential_cpu_offload()
        print("[qwen21_i2i] Sequential CPU offload enabled")
    except Exception as e:
        print(f"[qwen21_i2i] Sequential offload unavailable ({e}); using model offload")
        _pipe.enable_model_cpu_offload()

    # Attention slicing: computes attention in chunks instead of one big
    # matrix multiply — cuts peak VRAM further during the DiT steps at a
    # small speed cost. Guards the 16GB budget on top of CPU offload.
    try:
        _pipe.enable_attention_slicing()
        print("[qwen21_i2i] Attention slicing enabled")
    except Exception as e:
        print(f"[qwen21_i2i] Attention slicing unavailable ({e})")

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


def image_to_image(input_image, prompt="", seed=-1, resolution=1024):
    """Edit an input image with a text prompt using Qwen-Image-2.1.

    Args:
        input_image: PIL Image — the source image to edit
        prompt: str — editing instruction (e.g. "Change the background to a sunset beach")
        seed: int — random seed for reproducibility (-1 = random)
        resolution: int — target texture resolution in px (1024/2048/4096)

    Returns:
        PIL Image — edited output image
    """
    print(f"[qwen21_i2i] input_image: {input_image.size if input_image else None} mode={input_image.mode if input_image else None}, "
          f"prompt: {prompt!r}, seed: {seed}, resolution: {resolution}")

    if input_image is None:
        print("[qwen21_i2i] Returning None — missing input image")
        return None

    # Save a debug copy of the input so we can verify it's correct
    ts = int(time.time())
    input_image.save(os.path.join(_debug_dir, f"qwen21_input_{ts}.png"))
    print(f"[qwen21_i2i] Saved debug input to {_debug_dir} (timestamp {ts})")

    pipe = get_pipeline()

    # Normalize to a supported mode — RGBA is kept as-is so the model's
    # native transparency editing stays available; other modes become RGB.
    img = input_image if input_image.mode == "RGBA" else input_image.convert("RGB")

    # Scale to ~resolution² preserving aspect ratio — the output size follows
    # the input size for image editing.
    img_scaled = scale_to_resolution(img, resolution)
    print(f"[qwen21_i2i] img_scaled: {img_scaled.size}")

    generator = None
    if seed is not None and int(seed) >= 0:
        generator = torch.Generator(device="cpu").manual_seed(int(seed))

    # Free any dead VRAM allocations before starting — keeps the 16GB
    # budget clean between generations.
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    with torch.inference_mode():
        result = pipe(
            prompt=prompt or "",
            image=img_scaled,
            num_inference_steps=NUM_STEPS,
            generator=generator,
        )
    print(f"[qwen21_i2i] Generated image: {result.images[0].size}")

    # Save debug copy of the output
    result.images[0].save(os.path.join(_debug_dir, f"qwen21_output_{ts}.png"))
    print(f"[qwen21_i2i] Saved debug output to {_debug_dir} (timestamp {ts})")

    # Free the input images from memory — the temp files on disk are cleaned
    # up by Gradio's delete_cache=(60, 60) setting on the Blocks app.
    del input_image, img, img_scaled
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return result.images[0]
