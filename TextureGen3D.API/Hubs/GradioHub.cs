using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;
using TextureGen3D.API.Services;
using TextureGen3D.Data.Entities;
using TextureGen3D.Data.Interfaces;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Hubs
{
    /// <summary>
    /// SignalR hub for Gradio image generation progress tracking.
    /// The client calls GenerateImage with the generation parameters,
    /// and receives ProgressUpdate events as the Gradio generation progresses.
    /// Sends GenerationComplete when the output image is ready.
    /// Sends GenerationError if something goes wrong.
    /// </summary>
    public class GradioHub : Hub
    {
        readonly ImageGenerationForGradio _gradioService;
        readonly IImageGenerationModelRepository _imageGenModelRepo;
        readonly IProjectMeshReferenceRepository _meshRefRepo;
        readonly IProjectReferenceRepository _refRepo;
        readonly IProjectCameraAngleRepository _angleRepo;
        readonly IProjectRepository _projectRepo;
        readonly IImageService _imageService;

        // Per-connection cancellation tokens so CancelGeneration can abort the running HTTP requests
        static readonly ConcurrentDictionary<string, CancellationTokenSource> _cancelTokens = new();

        public GradioHub(
            ImageGenerationForGradio gradioService,
            IImageGenerationModelRepository imageGenModelRepo,
            IProjectMeshReferenceRepository meshRefRepo,
            IProjectReferenceRepository refRepo,
            IProjectCameraAngleRepository angleRepo,
            IProjectRepository projectRepo,
            IImageService imageService)
        {
            _gradioService = gradioService;
            _imageGenModelRepo = imageGenModelRepo;
            _meshRefRepo = meshRefRepo;
            _refRepo = refRepo;
            _angleRepo = angleRepo;
            _projectRepo = projectRepo;
            _imageService = imageService;
        }

        /// <summary>
        /// Called by the client to start a Gradio image generation.
        /// Sends ProgressUpdate events back to the caller as the generation progresses.
        /// Sends GenerationComplete when the output image is ready.
        /// Sends GenerationError if something goes wrong.
        /// </summary>
        public async Task GenerateImage(
            int imageModelId,
            string prompt,
            Guid projectId,
            Guid meshId,
            Guid layerId,
            Guid? cameraAngleId = null)
        {
            try
            {
                var imageModel = await _imageGenModelRepo.GetByIdAsync(imageModelId);
                if (imageModel == null)
                {
                    await Clients.Caller.SendAsync("GenerationError", "Image model not found.", null);
                    return;
                }

                if (string.IsNullOrWhiteSpace(imageModel.EndpointUrl))
                {
                    await Clients.Caller.SendAsync("GenerationError", "Gradio model has no endpoint URL configured.", null);
                    return;
                }

                // Build input images: depth map first, then reference image
                var inputImages = new List<byte[]>();

                // Read the depth map from storage (uploaded via API before connecting to hub)
                var depthMapBytes = await _imageService.GetProjectMeshLayerDepthMapAsync(projectId, meshId, layerId);
                Console.WriteLine($"[GradioHub] Depth map for layer {layerId}: {depthMapBytes?.Length ?? 0} bytes");
                if (depthMapBytes != null && depthMapBytes.Length > 0)
                    inputImages.Add(depthMapBytes);

                // Fetch image references: use camera angle's reference if cameraAngleId is set, otherwise mesh references
                if (cameraAngleId.HasValue)
                {
                    var angle = await _angleRepo.GetByIdAsync(cameraAngleId.Value, projectId);
                    Console.WriteLine($"[GradioHub] Angle {cameraAngleId.Value} → ProjectReferenceId: {angle?.ProjectReferenceId}");
                    if (angle != null && angle.ProjectReferenceId.HasValue)
                    {
                        var reference = await _refRepo.GetByIdAsync(angle.ProjectReferenceId.Value, projectId);
                        if (reference != null)
                        {
                            var refBytes = await _imageService.GetProjectReferenceAsync(projectId, reference.Id, reference.Extension);
                            Console.WriteLine($"[GradioHub]   Reference {reference.Id} ({reference.Filename}) → {refBytes?.Length ?? 0} bytes");
                            if (refBytes != null && refBytes.Length > 0)
                                inputImages.Add(refBytes);
                        }
                        else
                        {
                            Console.WriteLine($"[GradioHub]   WARNING: Reference {angle.ProjectReferenceId.Value} not found!");
                        }
                    }
                    else
                    {
                        Console.WriteLine($"[GradioHub]   WARNING: Angle has no ProjectReferenceId!");
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

                Console.WriteLine($"[GradioHub] Total input images: {inputImages.Count} (depth map + reference)");

                // Prepend the image model's prompt to the user prompt
                var fullPrompt = string.IsNullOrWhiteSpace(imageModel.Prompt)
                    ? prompt
                    : $"{imageModel.Prompt}\n\n{prompt}";

                var genRequest = new ImageGenerationRequest
                {
                    Prompt = fullPrompt,
                    Model = imageModel.Model,
                    Width = 1024,
                    Height = 1024,
                    InputImages = inputImages,
                };

                // Fetch the project seed
                var appUserClaim = Context.User?.Claims.FirstOrDefault(c => c.Type == "AppUser");
                var userId = appUserClaim != null && Guid.TryParse(appUserClaim.Value, out var uid) ? uid : Guid.Empty;
                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                int? seed = project?.Seed;
                Console.WriteLine($"[GradioHub] Project {projectId} user {userId} seed: {(seed.HasValue ? seed.Value.ToString() : "none")}");
                await Clients.Caller.SendAsync("SeedUsed", seed);

                // Create a CancellationTokenSource for this connection so CancelGeneration can abort it
                var cts = CancellationTokenSource.CreateLinkedTokenSource(Context.ConnectionAborted);
                _cancelTokens[Context.ConnectionId] = cts;

                var progress = new Progress<(int value, string? message)>(p =>
                {
                    try
                    {
                        _ = Clients.Caller.SendAsync("ProgressUpdate", p.value, p.message);
                    }
                    catch { /* client may have disconnected */ }
                });

                var result = await _gradioService.GenerateWithProgressAsync(
                    genRequest,
                    imageModel,
                    seed,
                    progress,
                    cts.Token);

                // Clean up cancel token on success
                _cancelTokens.TryRemove(Context.ConnectionId, out _);

                // Send the generated image back as base64
                var base64Image = $"data:image/png;base64,{Convert.ToBase64String(result.ImageBytes)}";
                await Clients.Caller.SendAsync("GenerationComplete", base64Image);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Gradio Generation Error: {ex}");
                Console.Error.WriteLine($"Stack trace:\n{ex.StackTrace}");
                _cancelTokens.TryRemove(Context.ConnectionId, out _);
                await Clients.Caller.SendAsync("GenerationError", ex.Message, ex.StackTrace);
            }
        }

        /// <summary>
        /// Called by the client to cancel the currently running Gradio generation.
        /// Cancels the CancellationTokenSource which aborts the HTTP requests (SSE stream, image download).
        /// </summary>
        public async Task CancelGeneration()
        {
            Console.WriteLine("[GradioHub] CancelGeneration requested");
            if (_cancelTokens.TryRemove(Context.ConnectionId, out var cts))
            {
                cts.Cancel();
                cts.Dispose();
            }
            await Clients.Caller.SendAsync("GenerationError", "Generation cancelled by user.", null);
        }
    }
}
