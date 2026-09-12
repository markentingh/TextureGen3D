using Microsoft.AspNetCore.SignalR;
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
        readonly IImageService _imageService;

        public ComfyUiHub(
            IEnumerable<IImageGeneration> imageGenerations,
            IImageGenerationModelRepository imageGenModelRepo,
            IProjectMeshReferenceRepository meshRefRepo,
            IProjectReferenceRepository refRepo,
            IImageService imageService)
        {
            _comfyUiService = imageGenerations.OfType<ImageGenerationForComfyUI>().First();
            _imageGenModelRepo = imageGenModelRepo;
            _meshRefRepo = meshRefRepo;
            _refRepo = refRepo;
            _imageService = imageService;
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
            string depthMapBase64,
            Guid projectId,
            Guid meshId)
        {
            try
            {
                var imageModel = await _imageGenModelRepo.GetByIdAsync(imageModelId);
                if (imageModel == null)
                {
                    await Clients.Caller.SendAsync("GenerationError", "Image model not found.");
                    return;
                }

                if (string.IsNullOrWhiteSpace(imageModel.WorkflowJson))
                {
                    await Clients.Caller.SendAsync("GenerationError", "ComfyUI model has no workflow JSON configured.");
                    return;
                }

                // Build input images: depth map first, then active mesh references
                var inputImages = new List<byte[]>();

                if (!string.IsNullOrWhiteSpace(depthMapBase64))
                {
                    var base64 = depthMapBase64.StartsWith("data:")
                        ? depthMapBase64[(depthMapBase64.IndexOf(',') + 1)..]
                        : depthMapBase64;
                    inputImages.Add(Convert.FromBase64String(base64));
                }

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

                var genRequest = new ImageGenerationRequest
                {
                    Prompt = prompt,
                    Model = imageModel.Model,
                    Width = 1024,
                    Height = 1024,
                    InputImages = inputImages,
                };

                var progress = new Progress<(int value, string? message)>(async p =>
                {
                    try
                    {
                        await Clients.Caller.SendAsync("ProgressUpdate", p.value, p.message);
                    }
                    catch { /* client may have disconnected */ }
                });

                var result = await _comfyUiService.GenerateWithProgressAsync(
                    genRequest,
                    imageModel.WorkflowJson,
                    imageModel.PromptPath ?? "",
                    imageModel.DepthMapPath ?? "",
                    imageModel.InputImagesPath ?? "",
                    progress,
                    Context.ConnectionAborted);

                // Send the generated image back as base64
                var base64Image = $"data:image/png;base64,{Convert.ToBase64String(result.ImageBytes)}";
                await Clients.Caller.SendAsync("GenerationComplete", base64Image);
            }
            catch (Exception ex)
            {
                await Clients.Caller.SendAsync("GenerationError", ex.Message);
            }
        }
    }
}
