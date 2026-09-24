"""
Pre-download all HuggingFace models, LoRAs, and assets required by the Gradio modules.
Run this before starting app.py to ensure all weights are cached locally.

Usage:
    python preload.py          # download everything
    python preload.py --check  # just list what would be downloaded
"""

import os
import sys
from pathlib import Path
from huggingface_hub import snapshot_download
from huggingface_hub.constants import HF_HUB_CACHE

# All models/LoRAs used by the modules
MODELS = [
    {
        "repo_id": "black-forest-labs/FLUX.2-klein-4B",
        "description": "Distilled 4-step FLUX.2 Klein 4B model (text encoder + VAE + tokenizers)",
    },
    {
        "repo_id": "black-forest-labs/FLUX.2-klein-4b-fp8",
        "description": "FP8 transformer checkpoint (4GB, flux-2-klein-4b-fp8.safetensors)",
    },
    {
        "repo_id": "thedeoxen/refcontrol-FLUX.2-klein-4B-reference-depth-lora",
        "description": "RefControl LoRA for reference+depth fusion",
    },
    {
        "repo_id": "Qwen/Qwen-Image-2.1",
        "description": "Qwen-Image-2.1 unified T2I + image editing model (7B visual DiT)",
    },
]


def get_cache_dir(repo_id):
    """Get the local HuggingFace cache directory for a repo.
    Cache path pattern: ~/.cache/huggingface/hub/models--{org}--{name}/
    """
    repo_folder = repo_id.replace("/", "--")
    return Path(HF_HUB_CACHE) / f"models--{repo_folder}"


def is_cached(repo_id):
    """Check if a repo has been downloaded to the local HuggingFace cache.
    Verifies the cache dir exists and contains at least one snapshot with files.
    """
    cache_dir = get_cache_dir(repo_id)
    snapshots_dir = cache_dir / "snapshots"
    if not snapshots_dir.exists():
        return False
    # Check that at least one snapshot exists and contains files
    for snapshot in snapshots_dir.iterdir():
        if snapshot.is_dir() and any(snapshot.iterdir()):
            return True
    return False


def main():
    check_only = "--check" in sys.argv

    print("=" * 60)
    print("  TextureGen3D Gradio — Pre-download Models")
    print("=" * 60)
    print()

    all_cached = True

    for i, model in enumerate(MODELS, 1):
        repo_id = model["repo_id"]
        desc = model["description"]
        print(f"[{i}/{len(MODELS)}] {repo_id}")
        print(f"  {desc}")

        cached = is_cached(repo_id)
        cache_dir = get_cache_dir(repo_id)

        if cached:
            print(f"  Already cached at: {cache_dir}")
            if not check_only:
                print("  Skipping download.")
            print()
            continue

        all_cached = False

        if check_only:
            print("  Status: NOT CACHED")
            print()
            continue

        try:
            print("  Downloading...")
            path = snapshot_download(
                repo_id=repo_id,
                local_dir_use_symlinks=False,
            )
            print(f"  Cached at: {path}")
            print()
        except Exception as e:
            print(f"  ERROR: {e}")
            print()
            return 1

    # U2NET (rembg) — not a HF repo; the onnx weights download to ~/.u2net
    # on first session creation. Warm it up here so first use isn't a surprise.
    print(f"[{len(MODELS) + 1}/{len(MODELS) + 1}] u2net (rembg background removal)")
    if check_only:
        u2net_dir = Path.home() / ".u2net"
        cached = u2net_dir.exists() and any(u2net_dir.iterdir())
        print(f"  Status: {'cached at ' + str(u2net_dir) if cached else 'NOT CACHED'}")
        if not cached:
            all_cached = False
    else:
        try:
            from rembg import new_session
            new_session("u2net")
            print("  Cached (session created successfully).")
        except Exception as e:
            print(f"  ERROR: {e}")
            return 1
    print()

    print("=" * 60)
    if check_only:
        if all_cached:
            print("  All models are cached. Nothing to download.")
        else:
            print("  Some models are missing. Run without --check to download.")
    else:
        print("  All models downloaded successfully!")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
