import os
import time
from PIL import Image, ImageFilter

_session = None
_debug_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "debug")
os.makedirs(_debug_dir, exist_ok=True)


def get_session():
    global _session
    if _session is not None:
        return _session

    try:
        from rembg import new_session
    except ImportError as e:
        raise ImportError(
            "rembg is not installed — run setup.bat or: pip install rembg onnxruntime"
        ) from e

    _session = new_session("u2net")
    print("[remove-bg] U2NET session created")
    return _session


def remove_background(input_image):
    """Remove the background from an image using U2NET.
    
    The edge erosion aggressiveness is calculated dynamically based on the
    input image's target resolution.

    Args:
        input_image: PIL Image — the generated image to process

    Returns:
        PIL Image (RGBA) — the subject on a transparent background
    """
    print(f"[remove-bg] input_image: {input_image.size if input_image else None} "
          f"mode={input_image.mode if input_image else None}")

    if input_image is None:
        print("[remove-bg] Returning None — missing input image")
        return None

    ts = int(time.time())
    input_image.save(os.path.join(_debug_dir, f"removebg_input_{ts}.png"))

    img = input_image if input_image.mode in ("RGB", "RGBA") else input_image.convert("RGB")

    from rembg import remove
    # alpha_matting re-estimates the edge ramp AND the foreground colors in
    # it — removes the ~1px white halo that raw U2NET leaves under the
    # antialiased alpha edge.
    result = remove(
        img,
        session=get_session(),
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=15,
    )
    
    if result.mode != "RGBA":
        result = result.convert("RGBA")

    # =========================================================================
    # DYNAMIC RESOLUTION-BASED EDGE CLEANUP PIPELINE
    # =========================================================================
    # Contraction aggressiveness scales with the longest side of the image
    # - Under 1024px: 1 pass
    # - 1024px up to 2048px: 2 passes (Standard)
    # - 2048px up to 3072px: 3 passes
    # - 3072px and above: 4 passes
    max_dim = max(img.size)
    if max_dim < 1024:
        shrink_passes = 1
    elif max_dim <= 2048:
        shrink_passes = 2
    elif max_dim <= 3072:
        shrink_passes = 3
    else:
        shrink_passes = 4

    print(f"[remove-bg] Resolution is {img.size[0]}x{img.size[1]}. "
          f"Applying {shrink_passes} soft contraction passes.")

    # Work on the grayscale alpha so U2NET's antialiased edge ramp survives:
    # 1. Cut faint background residue below a low alpha floor (drops the
    #    near-invisible white bleed gradient without touching real edges).
    # 2. MinFilter(3) contracts the mask ~1px per pass while preserving the
    #    smooth alpha gradient — soft shrink, no jagged binary staircase.
    alpha = result.getchannel('A')
    alpha = alpha.point(lambda p: 0 if p < 16 else p)
    for _ in range(shrink_passes):
        alpha = alpha.filter(ImageFilter.MinFilter(3))

    # Recombine the softened alpha with the original color channels
    r, g, b, _ = result.split()
    result = Image.merge("RGBA", (r, g, b, alpha))
    # =========================================================================

    result.save(os.path.join(_debug_dir, f"removebg_output_{ts}.png"))
    print(f"[remove-bg] output: {result.size} mode={result.mode} "
          f"(saved debug output, timestamp {ts})")

    return result
