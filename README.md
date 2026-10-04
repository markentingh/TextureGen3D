# TextureGen3D

A full-stack platform for generating and painting textures directly onto 3D models. Upload any 3D file, generate AI imagery onto per-mesh UV-mapped layers, refine it with a full suite of in-browser painting tools, and manage it all from an admin dashboard with accounts, subscriptions, and a token-based billing system.

- **Backend** — ASP.NET Core (.NET 9) API, JWT auth, Dapper data layer, PostgreSQL
- **Frontend** — React + Vite + TailwindCSS, Three.js WebGL canvas with custom shaders
- **AI providers** — OpenAI image models, self-hosted **Gradio** pipelines (Qwen 2.1 image-to-image, FLUX.2 Klein RefControl depth+reference LoRA, rembg, AuraSR upscaler, FBCNN cleaner), and ComfyUI

```bash
git clone https://github.com/markentingh/TextureGen3D
```

## Prerequisites

- **.NET 9 SDK** or later — https://dotnet.microsoft.com/download
- **PostgreSQL** — a running server with a login that can create/read/write the app database
- **Node.js LTS + npm**
- **Python 3.10+** — required only if running the self-hosted Gradio image server

## Running the app

1. **Database** — deploy the PostgreSQL schema by running `deploy.bat` from the `TextureGen3D.SQL` folder:

   ```bat
   cd TextureGen3D.SQL
   deploy.bat
   ```

   `deploy.bat` takes an optional database-name argument (default `texturegen3d`). It runs `npx gulp --database <name>` to generate `deploy.sql` from the schema files, then executes it with `psql` against the `template1` database — creating the database and deploying all tables, functions, sequences, and indexes in one shot.

2. **Configure** — set the connection string and provider keys in `TextureGen3D.Web.Server/appsettings.json`:

   ```json
   "ConnectionStrings": { "Database": "Host=localhost;Database=texturegen3d;..." },
   "ImageGeneration": {
     "Models": {
       "openai":  { "ApiKey": "sk-...", "Endpoint": "https://api.openai.com/v1/responses" },
       "comfyui": { "Endpoint": "http://127.0.0.1:8188/api" },
       "gradio":  { "Endpoint": "http://127.0.0.1:7860/" }
     }
   },
   "Tokens": { "Cost": 0.008 },
   "SendGrid": { "UseSendGrid": true, "SendGridApiKey": "..." }
   ```

3. **Run** — start `TextureGen3D.Web.Server` in Visual Studio or `dotnet run`; it serves the API plus the built client (SPA proxy). For frontend development, run `npm run dev` inside `TextureGen3D.Web.Client`.

4. **Sign up** — the first account created becomes the admin.

## Setting up the Gradio image server

The `Gradio` folder is a self-hosted Python pipeline that provides local image generation (Qwen 2.1 image-to-image, FLUX.2 Klein RefControl, background removal, upscaling, cleaning). Run its setup script **from the `Gradio` folder**:

```bat
cd Gradio
setup.bat
```

The script asks whether you have an **NVIDIA** or **AMD** GPU:

- **`nvidia`** — installs PyTorch with CUDA 11.8 support into your system Python, then verifies/installs the remaining dependencies: `gradio`, `accelerate`, `safetensors`, `sentencepiece`, `peft`, `ninja`, `pybind11`, `einops`, `omegaconf`, `huggingface_hub`, `rembg`, `onnxruntime`, `protobuf`, `opencv-python`, `aura-sr`, `transformers >= 5.17`, and `diffusers` (installed from git for `QwenImage21Pipeline` support).
- **`amd`** — creates a `venv` with **Python 3.12** (auto-installed via winget if missing), then installs the native **ROCm 7.2.1 SDK** and ROCm PyTorch wheels, followed by the same dependency list inside the venv.

Then start the server:

```bat
run.bat
```

`run.bat` first runs `preload.py`, which pre-downloads all required HuggingFace weights — the FLUX.2 Klein 4B base model + FP8 transformer checkpoint, the RefControl reference+depth LoRA, and the supporting assets — then launches `app.py` on `http://127.0.0.1:7860`. Point `ImageGeneration:Models:gradio:Endpoint` in `appsettings.json` at that URL.


## Projects

| Project | Description |
|---|---|
| `TextureGen3D.API` | ASP.NET Core API — projects, meshes, layers, references, generations, subscriptions, admin controllers |
| `TextureGen3D.Auth` | Authentication, JWT, account controller |
| `TextureGen3D.Data` | Dapper repositories and entities |
| `TextureGen3D.SQL` | PostgreSQL schema (tables, indexes, functions, sequences) |
| `TextureGen3D.AI` | Shared AI/LLM model definitions |
| `TextureGen3D.Upscaler` | Background worker for image upscaling |
| `TextureGen3D.Web.Server` | ASP.NET host — serves the API + SPA fallback |
| `TextureGen3D.Web.Client` | React + Vite + TailwindCSS frontend |
| `Gradio` | Self-hosted Python image-generation server (see below) |

## Features

### Projects

- **Projects dashboard** — create and manage texture projects, each with a name, thumbnail, uploaded 3D model, reference images, generated images, and saved camera angles.
- **Project thumbnails** — auto-captured from the 3D canvas.

### 3D model uploads

- Upload models in any common format — **OBJ, FBX, STL, PLY, ABC, USD/USDA/USDC/USDZ** — loaded via Three.js loaders.
- **Multi-mesh support** — files containing many meshes are parsed into individual mesh records; each mesh's position, rotation, and scale (parsed from the source file) is persisted so the authored layout is restored exactly.
- **Per-mesh editing + multi-mesh viewing** — one mesh is selected for editing while all other meshes can be toggled visible as auxiliary meshes (eye icon). Aux meshes render with live lighting and shadows, composited UV-map layers, and are hidden automatically during inpaint/stamp capture.
- **Upload & re-upload** — re-uploading replaces the model while preserving mesh records, transforms, and world-space alignment.

### AI image generation onto layers

- Every mesh layer is backed by a **UV map**. Image generations render directly onto a layer and re-render onto the mesh in real time via a custom WebGL shader.
- **Prompt-driven generation** — text prompts, plus optional reference images (per-layer, per-mesh, or per-project), camera-angle projection, and inpainting regions.
- **Multiple providers** — OpenAI image models, self-hosted Gradio (Qwen 2.1 image-to-image, FLUX.2 Klein RefControl depth+reference fusion), and ComfyUI; selectable per generation.
- **Inpainting** — paint a mask over an area, generate a depth-guided image, and project the result back onto the UV map.
- **Built-in post-processing** — background removal (rembg), AuraSR upscaling, and FBCNN artifact cleaning, all callable per layer.

### Layer tools

All tools paint directly onto the mesh surface through the UV map:

- **Brush** — paint color with size, hardness, and opacity sliders.
- **Eraser** — remove painted content.
- **Mask** — paint a visibility mask on the layer.
- **Blur** — soften regions with adjustable spread and strength.
- **Inpaint** — mark regions for AI inpainting.
- **Stamp** — clone/stamp regions of the layer.
- **Eyedropper** — pick a color from any visible mesh (selected or auxiliary) into the brush color.
- **Pen pressure** — every drawing tool supports pressure-sensitive styluses; the Pen Pressure checkbox + multi-select checklist lets pressure modulate **Brush Size** and/or **Opacity** relative to the slider values.
- **Layer operations** — flatten, duplicate, mirror, remove background, reproject, and clean each layer from the sidebar.
- **Camera angles** — save named viewpoints per project; used as generation reference views and for one-click camera recall.

### Canvas

- **Navigation gizmo** — bottom-right axis gizmo: free-drag to tumble, click a labeled axis (X/Y/Z) to snap to that face, drag the orbit ring to spin. Stays in sync during OrbitControls drags.
- **Lighting** — drag the light-bulb gizmo to move the directional light around the scene; light position persists per project. **Unlit mode** toggle for evaluating flat texture color.
- **Real shadows** — renderer shadow maps with a rotated 5×5 PCF soft-shadow kernel sampled inside the custom layer shader; all meshes (selected + auxiliary) cast and receive soft shadows.
- **Touch & stylus** — 1 finger draws/orbits, 2-finger pinch zooms, 2-finger drag rotates, 3-finger drag pans; drawing tools are suppressed whenever 2+ fingers touch. On-screen blue touch hints appear automatically on touch-capable devices (including pen-forwarded displays like Samsung Second Screen).
- **Persistence** — tool settings, active tool, light position, visible aux meshes, and the selected mesh all persist per project in localStorage.
- **Optimizations** — ETag/304 HTTP caching for all thumbnails, in-memory blob caches for UV maps/masks, debounced localStorage writes (2s), debounced GPU texture saves (5s), and cached composite UV maps for auxiliary meshes.

### Admin dashboard

- **Image generation settings** — configure model providers (OpenAI, Gradio, ComfyUI endpoints + keys) and browse the full generation history.
- **LLM models** — manage registered LLM model records.
- **User management** — list users, view/edit user details, assign roles.

### Accounts & security

- JWT authentication with rolling refresh tokens and per-IP token tracking.
- Role-based access (`AppRoles`/`AppUserRoles`); the first registered account is promoted to admin automatically.
- SendGrid email integration for transactional mail (optional — controlled by `SendGrid:UseSendGrid`).

### Billing, subscriptions & tokens

- **Products** — purchasable items with a price and a token allotment.
- **Subscriptions** — plans linking a monthly and yearly product, with a JSON feature list, featured flag, and sort order.
- **User subscriptions & invoices** — tracked in the billing dashboard (Subscriptions, Products, User Subscriptions, Invoices tabs).
- **AI token system** — each account receives a monthly token balance (`AppUserAITokens`); every image generation is priced in platform tokens (calculated from provider text/image input & output token costs × `Tokens:Cost`), and usage is debited automatically.

## License

See [LICENSE](LICENSE).
