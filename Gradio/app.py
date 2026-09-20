import gradio as gr
from modules.refcontrol_depth import depth_to_image


def refcontrol_tab():
    gr.Markdown("## Depth Map + Reference Image")
    gr.Markdown(
        "Fuses a **reference image** (identity/style) with a **depth map** (pose/structure) "
        "using the [thedeoxen/refcontrol-FLUX.2-klein-4B-reference-depth-lora](https://huggingface.co/thedeoxen/refcontrol-FLUX.2-klein-4B-reference-depth-lora) LoRA."
    )

    with gr.Row():
        with gr.Column():
            depth_map_input = gr.Image(label="Depth Map", type="pil")
            reference_input = gr.Image(label="Reference Image", type="pil")
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
            generate_btn = gr.Button("Generate", variant="primary")

        with gr.Column():
            output_image = gr.Image(label="Output Image", type="pil")

    generate_btn.click(
        fn=depth_to_image,
        inputs=[depth_map_input, reference_input, prompt_input, seed_input],
        outputs=output_image,
    )


with gr.Blocks(title="TextureGen3D Gradio", delete_cache=(60, 60)) as app:
    gr.Markdown("# TextureGen3D — Gradio Image Generation")
    gr.Markdown("Uses **black-forest-labs/FLUX.2-klein-base-4B** as the base model.")

    with gr.Tab("Depth To Image"):
        refcontrol_tab()


if __name__ == "__main__":
    app.launch()
