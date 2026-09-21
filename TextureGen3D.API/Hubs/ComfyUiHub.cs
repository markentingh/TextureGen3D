using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Hosting;
using TextureGen3D.API.Services;
using TextureGen3D.Data.Entities;
using TextureGen3D.Data.Interfaces;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Hubs
{
    /// <summary>
    /// SignalR hub for ComfyUI image generation progress tracking.
    /// The client calls GenerateImage with the generation parameters,
    /// and receives ProgressUpdate events as the ComfyUI workflow executes.
    /// </summary>
    public class ComfyUiHub : Hub
    {
        readonly ImageGenerationForComfyUI _comfyUiService;
        readonly IImageGenerationModelRepository _imageGenModelRepo;
        readonly IProjectMeshReferenceRepository _meshRefRepo;
        readonly IProjectReferenceRepository _refRepo;
        readonly IProjectCameraAngleRepository _angleRepo;
        readonly IProjectRepository _projectRepo;
        readonly IImageService _imageService;
        readonly IHostEnvironment _env;

        public ComfyUiHub(
            ImageGenerationForComfyUI comfyUiService,
            IImageGenerationModelRepository imageGenModelRepo,
            IProjectMeshReferenceRepository meshRefRepo,
            IProjectReferenceRepository refRepo,
            IProjectCameraAngleRepository angleRepo,
            IProjectRepository projectRepo,
            IImageService imageService,
            IHostEnvironment env)
        {
            _comfyUiService = comfyUiService;
            _imageGenModelRepo = imageGenModelRepo;
            _meshRefRepo = meshRefRepo;
            _refRepo = refRepo;
            _angleRepo = angleRepo;
            _projectRepo = projectRepo;
            _imageService = imageService;
            _env = env;
        }

        /// <summary>
        /// Called by the client to start a ComfyUI image generation.
        /// Sends ProgressUpdate events back to the caller as the workflow progresses.
        /// Sends GenerationComplete when the output image is ready.
        /// Sends GenerationError if something goes wrong.
        /// </summary>
        public async Task GenerateImage(
            int imageModelId,
            string prompt,
            Guid projectId,
            Guid meshId,
            Guid layerId,
            Guid? cameraAngleId = null,
            int resolution = 1024,
            Guid? inputImageId = null)
        {
            try
            {
                var imageModel = await _imageGenModelRepo.GetByIdAsync(imageModelId);
                if (imageModel == null)
                {
                    await Clients.Caller.SendAsync("GenerationError", "Image model not found.", null);
                    return;
                }

                if (string.IsNullOrWhiteSpace(imageModel.WorkflowJson))
                {
                    await Clients.Caller.SendAsync("GenerationError", "ComfyUI model has no workflow JSON configured.", null);
                    return;
                }

                // Build input images: depth map first, then active mesh references
                var inputImages = new List<byte[]>();

                // Read the depth map from storage (uploaded via API before connecting to hub)
                var depthMapBytes = await _imageService.GetProjectMeshLayerDepthMapAsync(projectId, meshId, layerId);
                if (depthMapBytes != null && depthMapBytes.Length > 0)
                    inputImages.Add(depthMapBytes);

                // A caller-supplied projection image (e.g. an inpainted render,
                // uploaded via API since SignalR caps messages at 32KB) acts as
                // the sole reference — skip angle/mesh reference lookup entirely
                if (inputImageId.HasValue)
                {
                    var projBytes = await _imageService.GetProjectProjectionImageAsync(projectId, inputImageId.Value);
                    if (projBytes != null && projBytes.Length > 0)
                        inputImages.Add(projBytes);
                    // Keep uploads in Development for debugging; clean up elsewhere
                    if (!_env.IsDevelopment())
                        await _imageService.DeleteProjectProjectionImageAsync(projectId, inputImageId.Value);
                }
                // Fetch image references: use camera angle's reference if cameraAngleId is set, otherwise mesh references
                else if (cameraAngleId.HasValue)
                {
                    var angle = await _angleRepo.GetByIdAsync(cameraAngleId.Value, projectId);
                    if (angle != null && angle.ProjectReferenceId.HasValue)
                    {
                        var reference = await _refRepo.GetByIdAsync(angle.ProjectReferenceId.Value, projectId);
                        if (reference != null)
                        {
                            var refBytes = await _imageService.GetProjectReferenceAsync(projectId, reference.Id, reference.Extension);
                            if (refBytes != null && refBytes.Length > 0)
                                inputImages.Add(refBytes);
                        }
                    }
                }
                else
                {
                    // Fetch active image references for this mesh from ProjectMeshReferences
                    var meshRefs = await _meshRefRepo.GetByMeshIdAsync(meshId, projectId);
                    foreach (var meshRef in meshRefs.Where(mr => mr.Active))
                    {
                        var reference = await _refRepo.GetByIdAsync(meshRef.ProjectReferenceId, projectId);
                        if (reference == null) continue;
                        var refBytes = await _imageService.GetProjectReferenceAsync(projectId, reference.Id, reference.Extension);
                        if (refBytes != null && refBytes.Length > 0)
                            inputImages.Add(refBytes);
                    }
                }

                // Prepend the image model's prompt to the user prompt
                var fullPrompt = string.IsNullOrWhiteSpace(imageModel.Prompt)
                    ? prompt
                    : $"{imageModel.Prompt}\n\n{prompt}";

                var genRequest = new ImageGenerationRequest
                {
                    Prompt = fullPrompt,
                    Model = imageModel.Model,
                    Width = resolution,
                    Height = resolution,
                    InputImages = inputImages,
                };

                // Fetch the project seed to inject into the workflow
                var appUserClaim = Context.User?.Claims.FirstOrDefault(c => c.Type == "AppUser");
                var userId = appUserClaim != null && Guid.TryParse(appUserClaim.Value, out var uid) ? uid : Guid.Empty;
                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                int? seed = project?.Seed;
                Console.WriteLine($"[ComfyUiHub] Project {projectId} user {userId} seed: {(seed.HasValue ? seed.Value.ToString() : "none")}");
                await Clients.Caller.SendAsync("SeedUsed", seed);

                var progress = new Progress<(int value, string? message)>(p =>
                {
                    try
                    {
                        _ = Clients.Caller.SendAsync("ProgressUpdate", p.value, p.message);
                    }
                    catch { /* client may have disconnected */ }
                });

                var result = await _comfyUiService.GenerateWithProgressAsync(
                    genRequest,
                    imageModel.WorkflowJson,
                    imageModel.PromptPath ?? "",
                    imageModel.DepthMapPath ?? "",
                    imageModel.InputImagesPath ?? "",
                    imageModel.SeedPath ?? "",
                    seed,
                    layerId.ToString(),
                    progress,
                    (workflowJson) => { _ = Clients.Caller.SendAsync("WorkflowJson", workflowJson); },
                    Context.ConnectionAborted);

                // Send the generated image back as base64
                var base64Image = $"data:image/png;base64,{Convert.ToBase64String(result.ImageBytes)}";
                await Clients.Caller.SendAsync("GenerationComplete", base64Image);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"ComfyUI Generation Error: {ex}");
                Console.Error.WriteLine($"Stack trace:\n{ex.StackTrace}");
                await Clients.Caller.SendAsync("GenerationError", ex.Message, ex.StackTrace);
            }
        }

        /// <summary>
        /// Called by the client to cancel the currently running ComfyUI workflow.
        /// POSTs to ComfyUI's /interrupt endpoint to stop the running job.
        /// </summary>
        public async Task CancelGeneration()
        {
            try
            {
                Console.WriteLine("[ComfyUiHub] CancelGeneration requested");
                await _comfyUiService.InterruptAsync();
                await Clients.Caller.SendAsync("GenerationError", "Generation cancelled by user.", null);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ComfyUiHub] CancelGeneration failed: {ex.Message}");
            }
        }
    }
}
