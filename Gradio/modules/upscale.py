import os
import time
from PIL import Image

_aura_sr = None
_debug_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "debug")
os.makedirs(_debug_dir, exist_ok=True)

# AuraSR upscales 4x — the caller downscales back to the original size, so the
# pass acts as an AI detail/denoise cleanup rather than an enlargement.
UPSCALE_FACTOR = 4


def get_upscaler():
    global _aura_sr
    if _aura_sr is not None:
        return _aura_sr

    try:
        from aura_sr import AuraSR
    except ImportError as e:
        raise ImportError(
            "aura-sr is not installed — run setup.bat or: pip install aura-sr"
        ) from e

    _aura_sr = AuraSR.from_pretrained("fal/AuraSR-v2")
    print("[upscale] AuraSR-v2 model loaded")
    return _aura_sr


def upscale(input_image):
    """Upscale an image 4x using AuraSR.

    RGBA inputs keep transparency: RGB channels go through AuraSR, the alpha
    channel is upscaled separately with Lanczos and recombined.

    Args:
        input_image: PIL Image — the image to upscale

    Returns:
        PIL Image — the 4x-upscaled image (RGBA preserved if input had alpha)
    """
    print(f"[upscale] input_image: {input_image.size if input_image else None} "
          f"mode={input_image.mode if input_image else None}")

    if input_image is None:
        print("[upscale] Returning None — missing input image")
        return None

    ts = int(time.time())
    input_image.save(os.path.join(_debug_dir, f"upscale_input_{ts}.png"))

    model = get_upscaler()
    has_alpha = input_image.mode in ("RGBA", "LA") or (
        input_image.mode == "P" and "transparency" in input_image.info
    )

    if has_alpha:
        rgba = input_image.convert("RGBA")
        rgb, alpha = rgba.convert("RGB"), rgba.getchannel("A")
        result_rgb = model.upscale_4x(rgb)
        result_alpha = alpha.resize(result_rgb.size, Image.LANCZOS)
        result = result_rgb.convert("RGBA")
        result.putalpha(result_alpha)
    else:
        img = input_image.convert("RGB")
        result = model.upscale_4x(img)

    result.save(os.path.join(_debug_dir, f"upscale_output_{ts}.png"))
    print(f"[upscale] output: {result.size} mode={result.mode} "
          f"(saved debug output, timestamp {ts})")

    return result
