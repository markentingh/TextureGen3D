using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.API.Services;
using TextureGen3D.Data.Entities;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/project-mesh-layers")]
    [Authorize]
    public class ProjectMeshLayersController : ApiController
    {
        readonly IProjectRepository _projectRepo;
        readonly IProjectMeshRepository _meshRepo;
        readonly IProjectMeshLayerRepository _layerRepo;
        readonly IProjectMeshReferenceRepository _meshRefRepo;
        readonly IProjectReferenceRepository _refRepo;
        readonly IImageService _imageService;
        readonly IImageGeneration _imageGeneration;
        readonly IEnumerable<IImageGeneration> _allImageGenerations;
        readonly IImageGenerationModelRepository _imageGenModelRepo;

        public ProjectMeshLayersController(
            IProjectRepository projectRepo,
            IProjectMeshRepository meshRepo,
            IProjectMeshLayerRepository layerRepo,
            IProjectMeshReferenceRepository meshRefRepo,
            IProjectReferenceRepository refRepo,
            IImageService imageService,
            IImageGeneration imageGeneration,
            IEnumerable<IImageGeneration> allImageGenerations,
            IImageGenerationModelRepository imageGenModelRepo)
        {
            _projectRepo = projectRepo;
            _meshRepo = meshRepo;
            _layerRepo = layerRepo;
            _meshRefRepo = meshRefRepo;
            _refRepo = refRepo;
            _imageService = imageService;
            _imageGeneration = imageGeneration;
            _allImageGenerations = allImageGenerations;
            _imageGenModelRepo = imageGenModelRepo;
        }

        [HttpGet("{projectId}/mesh/{meshId}")]
        public async Task<IActionResult> GetByMesh(Guid projectId, Guid meshId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var layers = await _layerRepo.GetByMeshIdAsync(meshId, projectId);
                return Json(new ApiResponse { success = true, data = layers });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class CreateLayerRequest
        {
            public Guid MeshId { get; set; }
            public string Name { get; set; } = "";
        }

        [HttpPost("{projectId}")]
        public async Task<IActionResult> Create(Guid projectId, [FromBody] CreateLayerRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var nextIndex = await _layerRepo.GetNextIndexAsync(request.MeshId, projectId);
                var layer = new ProjectMeshLayer
                {
                    ProjectId = projectId,
                    ProjectMeshId = request.MeshId,
                    Name = request.Name,
                    Index = nextIndex,
                };
                var created = await _layerRepo.CreateAsync(layer);
                return Json(new ApiResponse { success = true, data = created });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class UpdateNameRequest
        {
            public string Name { get; set; } = "";
        }

        [HttpPost("{projectId}/{layerId}/update-name")]
        public async Task<IActionResult> UpdateName(Guid projectId, Guid layerId, [FromBody] UpdateNameRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _layerRepo.UpdateNameAsync(layerId, projectId, request.Name ?? "");
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class ReorderRequest
        {
            public Guid MeshId { get; set; }
            public List<Guid> OrderedIds { get; set; } = new();
        }

        [HttpPost("{projectId}/reorder")]
        public async Task<IActionResult> Reorder(Guid projectId, [FromBody] ReorderRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _layerRepo.ReorderAsync(request.MeshId, projectId, request.OrderedIds);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/{layerId}/delete")]
        public async Task<IActionResult> Delete(Guid projectId, Guid layerId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var layer = await _layerRepo.GetByIdAsync(layerId, projectId);
                if (layer != null)
                {
                    // Delete the entire layer folder (image, thumb, uvmap, depthmap) and the DB record
                    await _imageService.DeleteProjectMeshLayerFolderAsync(projectId, layer.ProjectMeshId, layerId);
                }

                await _layerRepo.DeleteAsync(layerId, projectId);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("{projectId}/mesh/{meshId}/{layerId}/image")]
        public async Task<IActionResult> GetImage(Guid projectId, Guid meshId, Guid layerId)
        {
            try
            {
                var data = await _imageService.GetProjectMeshLayerImageAsync(projectId, meshId, layerId);
                if (data == null) return NotFound();
                return File(data, "image/png");
            }
            catch
            {
                return NotFound();
            }
        }

        [HttpGet("{projectId}/mesh/{meshId}/{layerId}/thumb")]
        public async Task<IActionResult> GetThumb(Guid projectId, Guid meshId, Guid layerId)
        {
            try
            {
                var data = await _imageService.GetProjectMeshLayerThumbAsync(projectId, meshId, layerId);
                if (data == null) return NotFound();
                return File(data, "image/png");
            }
            catch
            {
                return NotFound();
            }
        }

        [HttpGet("{projectId}/mesh/{meshId}/{layerId}/uvmap")]
        public async Task<IActionResult> GetUvMap(Guid projectId, Guid meshId, Guid layerId)
        {
            try
            {
                var data = await _imageService.GetProjectMeshLayerUvMapAsync(projectId, meshId, layerId);
                if (data == null) return NotFound();
                return File(data, "image/png");
            }
            catch
            {
                return NotFound();
            }
        }

        public class SaveImageRequest
        {
            public Guid MeshId { get; set; }
            public string Base64Image { get; set; } = "";
        }

        [HttpPost("{projectId}/{layerId}/save-image")]
        public async Task<IActionResult> SaveImage(Guid projectId, Guid layerId, [FromBody] SaveImageRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var base64 = request.Base64Image;
                if (base64.StartsWith("data:")) base64 = base64.Substring(base64.IndexOf(',') + 1);
                var imageBytes = Convert.FromBase64String(base64);

                await _imageService.SaveProjectMeshLayerImageAsync(projectId, request.MeshId, layerId, imageBytes);

                // Generate 100x100 thumbnail
                var thumbBytes = await _imageService.GenerateThumbnailAsync(imageBytes, 100);
                await _imageService.SaveProjectMeshLayerThumbAsync(projectId, request.MeshId, layerId, thumbBytes);

                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class SaveUvMapRequest
        {
            public Guid MeshId { get; set; }
            public string Base64UvMap { get; set; } = "";
        }

        [HttpPost("{projectId}/{layerId}/save-uvmap")]
        public async Task<IActionResult> SaveUvMap(Guid projectId, Guid layerId, [FromBody] SaveUvMapRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var base64 = request.Base64UvMap;
                if (base64.StartsWith("data:")) base64 = base64.Substring(base64.IndexOf(',') + 1);
                var uvmapBytes = Convert.FromBase64String(base64);

                await _imageService.SaveProjectMeshLayerUvMapAsync(projectId, request.MeshId, layerId, uvmapBytes);

                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class GenerateLayerImageRequest
        {
            public Guid MeshId { get; set; }
            public int ImageModelId { get; set; }
            public string Prompt { get; set; } = "";
            public string DepthMap { get; set; } = ""; // base64 data URL of the depth map
        }

        [HttpPost("{projectId}/{layerId}/generate")]
        public async Task<IActionResult> GenerateImage(Guid projectId, Guid layerId, [FromBody] GenerateLayerImageRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var imageModel = await _imageGenModelRepo.GetByIdAsync(request.ImageModelId);
                if (imageModel == null)
                    return Json(new ApiResponse { success = false, message = "Image model not found" });

                // Build input images: depth map first, then active mesh references
                var inputImages = new List<byte[]>();

                // Add the depth map (from the canvas)
                byte[]? depthMapBytes = null;
                if (!string.IsNullOrWhiteSpace(request.DepthMap))
                {
                    var base64 = request.DepthMap.StartsWith("data:") ? request.DepthMap.Substring(request.DepthMap.IndexOf(',') + 1) : request.DepthMap;
                    depthMapBytes = Convert.FromBase64String(base64);
                    inputImages.Add(depthMapBytes);
                }

                // Fetch active image references for this mesh from ProjectMeshReferences
                var meshRefs = await _meshRefRepo.GetByMeshIdAsync(request.MeshId, projectId);
                foreach (var meshRef in meshRefs.Where(mr => mr.Active))
                {
                    var reference = await _refRepo.GetByIdAsync(meshRef.ProjectReferenceId, projectId);
                    if (reference == null) continue;
                    var refBytes = await _imageService.GetProjectReferenceAsync(projectId, reference.Id, reference.Extension);
                    if (refBytes != null && refBytes.Length > 0)
                        inputImages.Add(refBytes);
                }

                if (inputImages.Count == 0)
                    return Json(new ApiResponse { success = false, message = "At least one input image (depth map) is required" });

                var hasReferences = inputImages.Count > 1;
                var albedoInstruction = " The output must be a pure albedo (diffuse color) map — flat, evenly lit surface colors with no shadows, no highlights, no ambient occlusion, no specular reflections, and no directional lighting. Treat the result as if illuminated by uniform, shadowless light from all directions so that only the intrinsic material color of each surface point is captured.";
                var systemPrompt = hasReferences
                    ? "You are generating a texture map for a 3D model. The first input image is a depth map rendered from a specific camera angle of the 3D model's surface — brighter pixels are closer to the camera, darker pixels are farther away. The remaining input images are reference textures that should be projected onto the 3D model's surface as seen from that camera angle. Generate a 1024x1024 texture that maps the reference imagery onto the geometry indicated by the depth map, preserving the spatial layout and surface contours. The output should look like a coherent texture applied to the 3D model's UV map from this viewpoint, not a flat composite. Respect the depth map's silhouette and surface relief when placing and distorting the reference textures." + albedoInstruction + "\n\n" + (request.Prompt ?? "")
                    : "You are generating a texture map for a 3D model. The first input image is a depth map rendered from a specific camera angle of the 3D model's surface — brighter pixels are closer to the camera, darker pixels are farther away. Generate a 1024x1024 texture that follows the surface contours and silhouette indicated by the depth map, producing a coherent texture suitable for the model's UV map from this viewpoint." + albedoInstruction + "\n\n" + (request.Prompt ?? "");

                var genRequest = new ImageGenerationRequest
                {
                    Prompt = systemPrompt,
                    Model = imageModel.Model,
                    Width = 1024,
                    Height = 1024,
                    InputImages = inputImages,
                };

                // Select the correct IImageGeneration implementation based on ModelKey
                var genService = _allImageGenerations.FirstOrDefault(g => g.ModelKey == imageModel.ModelKey)
                    ?? _imageGeneration;
                var result = await genService.GenerateAsync(genRequest);
                if (result.ImageBytes == null || result.ImageBytes.Length == 0)
                    return Json(new ApiResponse { success = false, message = "Image generation returned no image" });

                // Save the generated image to the layer
                await _imageService.SaveProjectMeshLayerImageAsync(projectId, request.MeshId, layerId, result.ImageBytes);

                // Generate and save 100x100 thumbnail
                var thumbBytes = await _imageService.GenerateThumbnailAsync(result.ImageBytes, 100);
                await _imageService.SaveProjectMeshLayerThumbAsync(projectId, request.MeshId, layerId, thumbBytes);

                // Save the depth map as JPEG
                if (depthMapBytes != null && depthMapBytes.Length > 0)
                {
                    var depthJpeg = await _imageService.ConvertToHighQualityJpegAsync(depthMapBytes);
                    await _imageService.SaveProjectMeshLayerDepthMapAsync(projectId, request.MeshId, layerId, depthJpeg);
                }

                // Return the generated image as base64 so the client can project it onto the UV map
                return Json(new ApiResponse { success = true, data = new
                {
                    image = $"data:image/png;base64,{Convert.ToBase64String(result.ImageBytes)}"
                }});
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class SaveComfyUiResultRequest
        {
            public Guid MeshId { get; set; }
            public string GeneratedImage { get; set; } = ""; // base64 data URL
            public string? DepthMap { get; set; } // base64 data URL (optional, for depth map save)
        }

        /// <summary>
        /// Save a ComfyUI-generated image to a layer (after the hub completes generation).
        /// The frontend calls this after receiving GenerationComplete from the SignalR hub.
        /// </summary>
        [HttpPost("{projectId}/{layerId}/save-comfyui-result")]
        public async Task<IActionResult> SaveComfyUiResult(Guid projectId, Guid layerId, [FromBody] SaveComfyUiResultRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                if (string.IsNullOrWhiteSpace(request.GeneratedImage))
                    return Json(new ApiResponse { success = false, message = "No generated image provided" });

                var base64Image = request.GeneratedImage.StartsWith("data:")
                    ? request.GeneratedImage[(request.GeneratedImage.IndexOf(',') + 1)..]
                    : request.GeneratedImage;
                var imageBytes = Convert.FromBase64String(base64Image);

                // Save the generated image to the layer
                await _imageService.SaveProjectMeshLayerImageAsync(projectId, request.MeshId, layerId, imageBytes);

                // Generate and save 100x100 thumbnail
                var thumbBytes = await _imageService.GenerateThumbnailAsync(imageBytes, 100);
                await _imageService.SaveProjectMeshLayerThumbAsync(projectId, request.MeshId, layerId, thumbBytes);

                // Save the depth map as JPEG if provided
                if (!string.IsNullOrWhiteSpace(request.DepthMap))
                {
                    var depthBase64 = request.DepthMap.StartsWith("data:")
                        ? request.DepthMap[(request.DepthMap.IndexOf(',') + 1)..]
                        : request.DepthMap;
                    var depthMapBytes = Convert.FromBase64String(depthBase64);
                    var depthJpeg = await _imageService.ConvertToHighQualityJpegAsync(depthMapBytes);
                    await _imageService.SaveProjectMeshLayerDepthMapAsync(projectId, request.MeshId, layerId, depthJpeg);
                }

                return Json(new ApiResponse { success = true, data = new
                {
                    image = $"data:image/png;base64,{Convert.ToBase64String(imageBytes)}"
                }});
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
