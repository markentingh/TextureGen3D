import os
import importlib.util
import gradio as gr
from modules.refcontrol_depth import depth_to_image

# modules/qwen-2.1-image-to-image.py can't be imported by name (dashes/dots
# in the filename), so load it by path instead.
_spec = importlib.util.spec_from_file_location(
    "qwen_21_image_to_image",
    os.path.join(os.path.dirname(__file__), "modules", "qwen-2.1-image-to-image.py"),
)
_qwen21 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_qwen21)
qwen_image_to_image = _qwen21.image_to_image

# modules/remove-background.py has the same unimportable-name problem — load by path.
_spec_rembg = importlib.util.spec_from_file_location(
    "remove_background",
    os.path.join(os.path.dirname(__file__), "modules", "remove-background.py"),
)
_rembg = importlib.util.module_from_spec(_spec_rembg)
_spec_rembg.loader.exec_module(_rembg)
remove_background = _rembg.remove_background

from modules.upscale import upscale
from modules.fbcnn_clean import clean_image


def refcontrol_tab():
    gr.Markdown("## Depth Map + Reference Image")
    gr.Markdown(
        "Fuses a **reference image** (identity/style) with a **depth map** (pose/structure) "
        "using the [thedeoxen/refcontrol-FLUX.2-klein-4B-reference-depth-lora](https://huggingface.co/thedeoxen/refcontrol-FLUX.2-klein-4B-reference-depth-lora) LoRA."
    )

    with gr.Row():
        with gr.Column():
            depth_map_input = gr.Image(label="Depth Map", type="pil", format="png")
            reference_input = gr.Image(label="Reference Image", type="pil", format="png")
            prompt_input = gr.Textbox(
                label="Prompt",
                value="",
                placeholder="Optional text prompt (trigger word 'refcontrol' is added automatically)",
            )
            seed_input = gr.Number(
                label="Seed",
                value=-1,
                precision=0,
                info="-1 for random",
            )
            resolution_input = gr.Number(
                label="Texture Resolution",
                value=1024,
                precision=0,
                info="Target output size in px (1024/2048/4096)",
            )
            generate_btn = gr.Button("Generate", variant="primary")

        with gr.Column():
            output_image = gr.Image(label="Output Image", type="pil", format="png")

    generate_btn.click(
        fn=depth_to_image,
        inputs=[depth_map_input, reference_input, prompt_input, seed_input, resolution_input],
        outputs=output_image,
    )


def qwen21_i2i_tab():
    gr.Markdown("## Qwen-Image-2.1 — Image To Image")
    gr.Markdown(
        "Edits an **input image** using a text prompt with "
        "[Qwen/Qwen-Image-2.1](https://huggingface.co/Qwen/Qwen-Image-2.1) "
        "(unified T2I + editing, native RGBA support)."
    )

    with gr.Row():
        with gr.Column():
            image_input = gr.Image(label="Input Image", type="pil", format="png")
            prompt_input = gr.Textbox(
                label="Prompt",
                value="",
                placeholder='Editing instruction, e.g. "Change the background to a sunset beach"',
            )
            seed_input = gr.Number(
                label="Seed",
                value=-1,
                precision=0,
                info="-1 for random",
            )
            resolution_input = gr.Number(
                label="Texture Resolution",
                value=1024,
                precision=0,
                info="Target output size in px (1024/2048/4096)",
            )
            generate_btn = gr.Button("Generate", variant="primary")

        with gr.Column():
            output_image = gr.Image(label="Output Image", type="pil", format="png")

    generate_btn.click(
        fn=qwen_image_to_image,
        inputs=[image_input, prompt_input, seed_input, resolution_input],
        outputs=output_image,
    )


def remove_background_tab():
    gr.Markdown("## Background Removal — U2NET")
    gr.Markdown(
        "Removes the background from an image using "
        "[rembg](https://github.com/danielgatis/rembg) "
        "(U2NET salient-object segmentation). Returns an RGBA image with a transparent background."
    )

    with gr.Row():
        with gr.Column():
            image_input = gr.Image(label="Input Image", type="pil", format="png")
            remove_btn = gr.Button("Remove Background", variant="primary")

        with gr.Column():
            output_image = gr.Image(label="Output Image", type="pil", format="png")

    remove_btn.click(
        fn=remove_background,
        inputs=[image_input],
        outputs=output_image,
    )


def upscale_tab():
    gr.Markdown("## Upscale — AuraSR")
    gr.Markdown(
        "Upscales an image 4x using "
        "[AuraSR-v2](https://huggingface.co/fal-ai/AuraSR-v2) "
        "(GAN super-resolution). RGBA inputs keep their alpha channel."
    )

    with gr.Row():
        with gr.Column():
            image_input = gr.Image(label="Input Image", type="pil", format="png")
            upscale_btn = gr.Button("Upscale", variant="primary")

        with gr.Column():
            output_image = gr.Image(label="Output Image", type="pil", format="png")

    upscale_btn.click(
        fn=upscale,
        inputs=[image_input],
        outputs=output_image,
    )


def clean_image_tab():
    gr.Markdown("## Clean Image — FBCNN")
    gr.Markdown(
        "Removes JPEG/compression artifacts and light noise from an image using "
        "[FBCNN](https://github.com/jiaxi-jiang/FBCNN) "
        "(flexible blind artifact removal, ICCV 2021). Output is the same size as the input; "
        "RGBA inputs keep their alpha channel."
    )

    with gr.Row():
        with gr.Column():
            image_input = gr.Image(label="Input Image", type="pil", format="png")
            quality_factor_input = gr.Slider(
                label="Quality Factor",
                minimum=5,
                maximum=100,
                step=5,
                value=10,
                info="Assumed JPEG quality of the input — lower = more aggressive cleaning",
            )
            clean_btn = gr.Button("Clean Image", variant="primary")

        with gr.Column():
            output_image = gr.Image(label="Output Image", type="pil", format="png")

    clean_btn.click(
        fn=clean_image,
        inputs=[image_input, quality_factor_input],
        outputs=output_image,
    )


with gr.Blocks(title="TextureGen3D Gradio", delete_cache=(60, 60)) as app:
    gr.Markdown("# TextureGen3D — Gradio Image Generation")

    with gr.Tab("Depth To Image"):
        refcontrol_tab()

    with gr.Tab("Qwen 2.1 Image To Image"):
        qwen21_i2i_tab()

    with gr.Tab("Remove Background"):
        remove_background_tab()

    with gr.Tab("Upscale"):
        upscale_tab()

    with gr.Tab("Clean Image"):
        clean_image_tab()


if __name__ == "__main__":
    app.launch()
