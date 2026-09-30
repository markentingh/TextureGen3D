import os
import time
import urllib.request

import numpy as np
import torch
from PIL import Image

_model = None
_debug_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "debug")
os.makedirs(_debug_dir, exist_ok=True)

# FBCNN isn't published to pip/HuggingFace — the vendored network lives in
# modules/fbcnn_net.py and the weights are a GitHub release asset (~281MB).
_MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "model_zoo")
_MODEL_PATH = os.path.join(_MODELS_DIR, "fbcnn_color.pth")
_MODEL_URL = "https://github.com/jiaxi-jiang/FBCNN/releases/download/v1.0/fbcnn_color.pth"

# JPEG quality factor the model assumes for the input (0-100 scale, mapped to
# qf_input = 1 - QF/100). Lower = assumes heavier compression = more aggressive
# cleaning. Auto-prediction tends to under-clean real-world recompressed
# images, so we default to 60 — the author's recommendation for real images.
DEFAULT_QUALITY_FACTOR = 60


def _ensure_weights():
    if os.path.exists(_MODEL_PATH):
        return
    os.makedirs(_MODELS_DIR, exist_ok=True)
    print("[clean_image] downloading fbcnn_color.pth (~281MB)...")
    urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)


def get_cleaner():
    global _model
    if _model is not None:
        return _model

    from modules.fbcnn_net import FBCNN

    _ensure_weights()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    net = FBCNN(in_nc=3, out_nc=3, nc=[64, 128, 256, 512], nb=4, act_mode="R")
    net.load_state_dict(torch.load(_MODEL_PATH, map_location=device), strict=True)
    net.eval()
    for p in net.parameters():
        p.requires_grad = False
    _model = net.to(device)
    print(f"[clean_image] FBCNN loaded on {device}")
    return _model


def clean_image(input_image, quality_factor=DEFAULT_QUALITY_FACTOR):
    """Remove JPEG/compression artifacts and light noise using FBCNN.

    Same-size output (unlike upscale). RGBA inputs keep transparency: RGB goes
    through FBCNN, the alpha channel passes through unchanged.

    Args:
        input_image: PIL Image — the image to clean
        quality_factor: assumed JPEG quality of the input (5-100). Lower values
            apply more aggressive artifact removal; default 60 is the FBCNN
            author's recommendation for real/recompressed images.

    Returns:
        PIL Image — cleaned image, same dimensions (RGBA preserved if input had alpha)
    """
    # API callers (the .NET backend) omit this — the signature default applies.
    quality_factor = int(np.clip(quality_factor or DEFAULT_QUALITY_FACTOR, 5, 100))
    print(f"[clean_image] input_image: {input_image.size if input_image else None} "
          f"mode={input_image.mode if input_image else None}")

    if input_image is None:
        print("[clean_image] Returning None — missing input image")
        return None

    ts = int(time.time())
    input_image.save(os.path.join(_debug_dir, f"clean_image_input_{ts}.png"))

    model = get_cleaner()
    device = next(model.parameters()).device
    has_alpha = input_image.mode in ("RGBA", "LA") or (
        input_image.mode == "P" and "transparency" in input_image.info
    )

    alpha = None
    if has_alpha:
        rgba = input_image.convert("RGBA")
        img, alpha = rgba.convert("RGB"), rgba.getchannel("A")
    else:
        img = input_image.convert("RGB")

    arr = np.asarray(img, dtype=np.float32) / 255.0
    tensor = torch.from_numpy(arr.transpose(2, 0, 1)).unsqueeze(0).to(device)

    qf_input = torch.tensor([[1 - quality_factor / 100]], device=device)
    with torch.no_grad():
        out, qf = model(tensor, qf_input)

    print(f"[clean_image] quality factor: {quality_factor} "
          f"(qf_input={qf_input.item():.2f}, predicted={1 - qf.item():.3f})")

    out = out.squeeze(0).clamp(0, 1).cpu().numpy().transpose(1, 2, 0)
    result = Image.fromarray((out * 255.0).round().astype(np.uint8), "RGB")

    if alpha is not None:
        result = result.convert("RGBA")
        result.putalpha(alpha)

    result.save(os.path.join(_debug_dir, f"clean_image_output_{ts}.png"))
    print(f"[clean_image] output: {result.size} mode={result.mode} "
          f"(saved debug output, timestamp {ts})")

    return result
