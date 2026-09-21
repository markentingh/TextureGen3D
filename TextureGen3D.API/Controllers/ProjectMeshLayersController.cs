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
        readonly IProjectCameraAngleRepository _angleRepo;
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
            IProjectCameraAngleRepository angleRepo,
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
            _angleRepo = angleRepo;
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
            public string? CameraAngle { get; set; }
            public bool Inpaint { get; set; }
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
                    CameraAngle = request.CameraAngle ?? "",
                    Inpaint = request.Inpaint,
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

        [HttpGet("{projectId}/mesh/{meshId}/{layerId}/uvmap-thumb")]
        public async Task<IActionResult> GetUvMapThumb(Guid projectId, Guid meshId, Guid layerId)
        {
            try
            {
                var data = await _imageService.GetProjectMeshLayerUvMapThumbAsync(projectId, meshId, layerId);
                if (data == null) return NotFound();
                return File(data, "image/png");
            }
            catch
            {
                return NotFound();
            }
        }

        [HttpGet("{projectId}/mesh/{meshId}/{layerId}/mask")]
        public async Task<IActionResult> GetMask(Guid projectId, Guid meshId, Guid layerId)
        {
            try
            {
                var data = await _imageService.GetProjectMeshLayerMaskAsync(projectId, meshId, layerId);
                if (data == null) return NotFound();
                return File(data, "image/png");
            }
            catch
            {
                return NotFound();
            }
        }

        [HttpGet("{projectId}/mesh/{meshId}/{layerId}/mask-thumb")]
        public async Task<IActionResult> GetMaskThumb(Guid projectId, Guid meshId, Guid layerId)
        {
            try
            {
                var data = await _imageService.GetProjectMeshLayerMaskThumbAsync(projectId, meshId, layerId);
                if (data == null) return NotFound();
                return File(data, "image/png");
            }
            catch
            {
                return NotFound();
            }
        }

        [HttpGet("{projectId}/mesh/{meshId}/{layerId}/angle-thumb")]
        public async Task<IActionResult> GetLayerAngleThumb(Guid projectId, Guid meshId, Guid layerId)
        {
            try
            {
                var data = await _imageService.GetProjectMeshLayerAngleThumbAsync(projectId, meshId, layerId);
                if (data == null) return NotFound();
                return File(data, "image/png");
            }
            catch
            {
                return NotFound();
            }
        }

        public class SaveAngleThumbRequest
        {
            public Guid MeshId { get; set; }
            public string Base64Image { get; set; } = "";
        }

        /// <summary>
        /// Save a thumbnail of the camera angle used to project this layer —
        /// shown in the layer row for layers whose angle has no camera-angle record.
        /// </summary>
        [HttpPost("{projectId}/{layerId}/save-angle-thumb")]
        public async Task<IActionResult> SaveAngleThumb(Guid projectId, Guid layerId, [FromBody] SaveAngleThumbRequest request)
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
                if (string.IsNullOrWhiteSpace(base64))
                    return Json(new ApiResponse { success = false, message = "No image provided" });
                if (base64.StartsWith("data:")) base64 = base64.Substring(base64.IndexOf(',') + 1);
                var imageBytes = Convert.FromBase64String(base64);

                await _imageService.SaveProjectMeshLayerAngleThumbAsync(projectId, request.MeshId, layerId, imageBytes);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
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

                // Generate and save a thumbnail of the UV map
                var uvThumbBytes = await _imageService.GenerateThumbnailAsync(uvmapBytes, 100);
                await _imageService.SaveProjectMeshLayerUvMapThumbAsync(projectId, request.MeshId, layerId, uvThumbBytes);

                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class SaveMaskItem
        {
            public Guid LayerId { get; set; }
            public string Base64Mask { get; set; } = "";
        }

        public class SaveMasksRequest
        {
            public Guid MeshId { get; set; }
            public List<SaveMaskItem> Masks { get; set; } = new();
        }

        /// <summary>
        /// Batch-save mask.png files for layers painted with the mask brush.
        /// Mask is a white canvas that the user paints black onto; black areas
        /// hide the layer's UV map in the shader.
        /// </summary>
        [HttpPost("{projectId}/save-masks")]
        public async Task<IActionResult> SaveMasks(Guid projectId, [FromBody] SaveMasksRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                foreach (var item in request.Masks)
                {
                    var base64 = item.Base64Mask;
                    if (string.IsNullOrWhiteSpace(base64)) continue;
                    if (base64.StartsWith("data:")) base64 = base64.Substring(base64.IndexOf(',') + 1);
                    var maskBytes = Convert.FromBase64String(base64);

                    await _imageService.SaveProjectMeshLayerMaskAsync(projectId, request.MeshId, item.LayerId, maskBytes);

                    var maskThumbBytes = await _imageService.GenerateThumbnailAsync(maskBytes, 100);
                    await _imageService.SaveProjectMeshLayerMaskThumbAsync(projectId, request.MeshId, item.LayerId, maskThumbBytes);
                }

                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class ReprojectRequest
        {
            public Guid MeshId { get; set; }
            public string CameraAngle { get; set; } = ""; // JSON {x,y,z}
        }

        /// <summary>
        /// Re-project the layer's existing image.png onto the UV map using the stored camera angle.
        /// The frontend calls this from the reprojection button on the layer list item.
        /// Returns the re-projected UV map as base64 so the frontend can save it.
        /// </summary>
        [HttpPost("{projectId}/{layerId}/reproject")]
        public async Task<IActionResult> Reproject(Guid projectId, Guid layerId, [FromBody] ReprojectRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                // Update the camera angle if provided
                if (!string.IsNullOrWhiteSpace(request.CameraAngle))
                {
                    await _layerRepo.UpdateCameraAngleAsync(layerId, projectId, request.CameraAngle);
                }

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
            public string CameraAngle { get; set; } = ""; // JSON {x,y,z}
            public Guid? CameraAngleId { get; set; } // if set, use this camera angle's reference image instead of mesh references
            public string? InputImage { get; set; } // base64 data URL — caller-supplied input image (e.g. an inpainted render); replaces mesh/angle references
            public int Resolution { get; set; } // texture resolution in px (1024/2048/4096); falls back to the project's TextureResolution
        }

        public class SaveDepthMapRequest
        {
            public Guid MeshId { get; set; }
            public string DepthMap { get; set; } = ""; // base64 data URL
        }

        /// <summary>
        /// Save a depth map to the layer folder before starting ComfyUI generation.
        /// The ComfyUI hub reads the depth map from storage instead of receiving it via SignalR.
        /// </summary>
        [HttpPost("{projectId}/{layerId}/save-depthmap")]
        public async Task<IActionResult> SaveDepthMap(Guid projectId, Guid layerId, [FromBody] SaveDepthMapRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                if (string.IsNullOrWhiteSpace(request.DepthMap))
                    return Json(new ApiResponse { success = false, message = "No depth map provided" });

                var base64 = request.DepthMap.StartsWith("data:")
                    ? request.DepthMap[(request.DepthMap.IndexOf(',') + 1)..]
                    : request.DepthMap;
                var depthMapBytes = Convert.FromBase64String(base64);

                var depthJpeg = await _imageService.ConvertToHighQualityJpegAsync(depthMapBytes);
                await _imageService.SaveProjectMeshLayerDepthMapAsync(projectId, request.MeshId, layerId, depthJpeg);

                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class SaveProjectionImageRequest
        {
            public string Image { get; set; } = ""; // base64 data URL
        }

        /// <summary>
        /// Upload a caller-supplied projection input image (e.g. an inpainted
        /// render). SignalR messages are limited to 32KB, so images are sent via
        /// this API and the hubs resolve them by id from storage.
        /// </summary>
        [HttpPost("{projectId}/projection-image")]
        public async Task<IActionResult> SaveProjectionImage(Guid projectId, [FromBody] SaveProjectionImageRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                if (string.IsNullOrWhiteSpace(request.Image))
                    return Json(new ApiResponse { success = false, message = "No image provided" });

                var base64 = request.Image.StartsWith("data:") ? request.Image[(request.Image.IndexOf(',') + 1)..] : request.Image;
                var imageId = Guid.NewGuid();
                await _imageService.SaveProjectProjectionImageAsync(projectId, imageId, Convert.FromBase64String(base64));

                return Json(new ApiResponse { success = true, data = new { imageId } });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
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

                // A caller-supplied input image (e.g. an inpainted render) acts as
                // the sole reference — skip mesh/angle reference lookup entirely
                if (!string.IsNullOrWhiteSpace(request.InputImage))
                {
                    var imgBase64 = request.InputImage.StartsWith("data:") ? request.InputImage.Substring(request.InputImage.IndexOf(',') + 1) : request.InputImage;
                    inputImages.Add(Convert.FromBase64String(imgBase64));
                }
                // Fetch image references: use camera angle's reference if CameraAngleId is set, otherwise mesh references
                else if (request.CameraAngleId.HasValue)
                {
                    var angle = await _angleRepo.GetByIdAsync(request.CameraAngleId.Value, projectId);
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
                    var meshRefs = await _meshRefRepo.GetByMeshIdAsync(request.MeshId, projectId);
                    foreach (var meshRef in meshRefs.Where(mr => mr.Active))
                    {
                        var reference = await _refRepo.GetByIdAsync(meshRef.ProjectReferenceId, projectId);
                        if (reference == null) continue;
                        var refBytes = await _imageService.GetProjectReferenceAsync(projectId, reference.Id, reference.Extension);
                        if (refBytes != null && refBytes.Length > 0)
                            inputImages.Add(refBytes);
                    }
                }

                if (inputImages.Count == 0)
                    return Json(new ApiResponse { success = false, message = "At least one input image (depth map) is required" });

                var resolution = request.Resolution > 0 ? request.Resolution
                    : (project.TextureResolution > 0 ? project.TextureResolution : 1024);
                var hasReferences = inputImages.Count > 1;
                var albedoInstruction = " The output must be a pure albedo (diffuse color) map — flat, evenly lit surface colors with no shadows, no highlights, no ambient occlusion, no specular reflections, and no directional lighting. Treat the result as if illuminated by uniform, shadowless light from all directions so that only the intrinsic material color of each surface point is captured.";
                var systemPrompt = hasReferences
                    ? $"You are generating a texture map for a 3D model. The first input image is a depth map rendered from a specific camera angle of the 3D model's surface — brighter pixels are closer to the camera, darker pixels are farther away. The remaining input images are reference textures that should be projected onto the 3D model's surface as seen from that camera angle. Generate a {resolution}x{resolution} texture that maps the reference imagery onto the geometry indicated by the depth map, preserving the spatial layout and surface contours. The output should look like a coherent texture applied to the 3D model's UV map from this viewpoint, not a flat composite. Respect the depth map's silhouette and surface relief when placing and distorting the reference textures." + albedoInstruction + "\n\n" + (request.Prompt ?? "")
                    : $"You are generating a texture map for a 3D model. The first input image is a depth map rendered from a specific camera angle of the 3D model's surface — brighter pixels are closer to the camera, darker pixels are farther away. Generate a {resolution}x{resolution} texture that follows the surface contours and silhouette indicated by the depth map, producing a coherent texture suitable for the model's UV map from this viewpoint." + albedoInstruction + "\n\n" + (request.Prompt ?? "");

                var genRequest = new ImageGenerationRequest
                {
                    Prompt = systemPrompt,
                    Model = imageModel.Model,
                    Width = resolution,
                    Height = resolution,
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

                // Save the camera angle if provided
                if (!string.IsNullOrWhiteSpace(request.CameraAngle))
                {
                    await _layerRepo.UpdateCameraAngleAsync(layerId, projectId, request.CameraAngle);
                }

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

        public class InpaintRequest
        {
            public Guid MeshId { get; set; }
            public string Image { get; set; } = ""; // base64 data URL — the unlit composite render (InputImages[0])
            public string Mask { get; set; } = "";  // base64 data URL — composite with the masked region made transparent (InputMask)
            public string? Prompt { get; set; }
            public List<Guid>? ReferenceIds { get; set; } // active project reference ids
            public int ImageModelId { get; set; }
            public int Resolution { get; set; } // texture resolution in px; falls back to the project's TextureResolution
        }

        /// <summary>
        /// Inpaint a camera-space render of the mesh: the base composite goes to
        /// InputImages[0], the RGBA image with the masked region transparent goes
        /// to InputMask, and active reference images are appended to InputImages.
        /// Returns the edited image as a base64 data URL.
        /// </summary>
        [HttpPost("{projectId}/inpaint")]
        public async Task<IActionResult> Inpaint(Guid projectId, [FromBody] InpaintRequest request)
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

                static byte[] DecodeDataUrl(string dataUrl) => Convert.FromBase64String(
                    dataUrl.StartsWith("data:") ? dataUrl[(dataUrl.IndexOf(',') + 1)..] : dataUrl);

                if (string.IsNullOrWhiteSpace(request.Image))
                    return Json(new ApiResponse { success = false, message = "No input image provided" });
                if (string.IsNullOrWhiteSpace(request.Mask))
                    return Json(new ApiResponse { success = false, message = "No input mask provided" });

                var inputImages = new List<byte[]> { DecodeDataUrl(request.Image) };

                if (request.ReferenceIds != null)
                {
                    foreach (var refId in request.ReferenceIds)
                    {
                        var reference = await _refRepo.GetByIdAsync(refId, projectId);
                        if (reference == null) continue;
                        var refBytes = await _imageService.GetProjectReferenceAsync(projectId, reference.Id, reference.Extension);
                        if (refBytes != null && refBytes.Length > 0)
                            inputImages.Add(refBytes);
                    }
                }

                var resolution = request.Resolution > 0 ? request.Resolution
                    : (project.TextureResolution > 0 ? project.TextureResolution : 1024);
                var genRequest = new ImageGenerationRequest
                {
                    // Frame the request so the model edits the composite (input
                    // image 0) instead of treating inputs as generation sources
                    Prompt = $"Update the first input image based on the provided mask, reference images, and the following prompt: {request.Prompt}",
                    Model = imageModel.Model,
                    Width = resolution,
                    Height = resolution,
                    InputImages = inputImages,
                    InputMask = DecodeDataUrl(request.Mask),
                };

                var genService = _allImageGenerations.FirstOrDefault(g => g.ModelKey == imageModel.ModelKey)
                    ?? _imageGeneration;
                var result = await genService.GenerateAsync(genRequest);
                if (result.ImageBytes == null || result.ImageBytes.Length == 0)
                    return Json(new ApiResponse { success = false, message = "Image generation returned no image" });

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

        public class UpdateVisibleRequest
        {
            public bool Visible { get; set; }
        }

        [HttpPost("{projectId}/{layerId}/toggle-visible")]
        public async Task<IActionResult> ToggleVisible(Guid projectId, Guid layerId, [FromBody] UpdateVisibleRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _layerRepo.UpdateVisibleAsync(layerId, projectId, request.Visible);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class StitchRequest
        {
            public Guid MeshId { get; set; }
            public int ImageModelId { get; set; }
            public List<Guid> LayerIds { get; set; } = new();
        }

        [HttpPost("{projectId}/stitch-layers")]
        public async Task<IActionResult> StitchLayers(Guid projectId, [FromBody] StitchRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                // Collect UV map images from selected layers
                var inputImages = new List<byte[]>();
                foreach (var layerId in request.LayerIds)
                {
                    var uvmapBytes = await _imageService.GetProjectMeshLayerUvMapAsync(projectId, request.MeshId, layerId);
                    if (uvmapBytes != null && uvmapBytes.Length > 0)
                        inputImages.Add(uvmapBytes);
                }

                if (inputImages.Count == 0)
                    return Json(new ApiResponse { success = false, message = "No UV maps found in selected layers" });

                // Get the image generation model
                var imageModel = await _imageGenModelRepo.GetByIdAsync(request.ImageModelId);
                if (imageModel == null)
                    return Json(new ApiResponse { success = false, message = "Image model not found" });

                // Build the stitch prompt
                var stitchPrompt = "You are given multiple UV map texture layers for a single 3D model. " +
                    "Each image is a UV map texture with transparent regions where that layer has no coverage. " +
                    "Stitch all UV map layers together into a single seamless, high-quality albedo texture map. " +
                    "Merge overlapping regions by blending colors smoothly. " +
                    "Fill any remaining transparent gaps with the nearest surrounding colors. " +
                    "The final image must be a complete, seamless UV texture map with no transparency, " +
                    "no shadows, no lighting, no highlights, and no reflections — only flat base colors " +
                    "and surface details suitable for projection onto a 3D model.";

                // Select the correct IImageGeneration implementation
                var genService = _allImageGenerations.FirstOrDefault(g => g.ModelKey == imageModel.ModelKey)
                    ?? _imageGeneration;

                var stitchResolution = project.TextureResolution > 0 ? project.TextureResolution : 1024;
                var genRequest = new ImageGenerationRequest
                {
                    Prompt = stitchPrompt,
                    Model = imageModel.Model,
                    Width = stitchResolution,
                    Height = stitchResolution,
                    InputImages = inputImages,
                };

                var result = await genService.GenerateAsync(genRequest);
                if (result.ImageBytes == null || result.ImageBytes.Length == 0)
                    return Json(new ApiResponse { success = false, message = "Image generation returned no image" });

                // Get all existing layers for this mesh
                var existingLayers = await _layerRepo.GetByMeshIdAsync(request.MeshId, projectId);

                // Increment all existing layers' indices by 1
                foreach (var layer in existingLayers)
                {
                    await _layerRepo.UpdateIndexAsync(layer.Id, projectId, layer.Index + 1);
                }

                // Set all existing layers' visibility to false
                await _layerRepo.SetAllVisibleAsync(request.MeshId, projectId, false);

                // Create the new stitched layer at index 0
                var newLayer = new ProjectMeshLayer
                {
                    ProjectId = projectId,
                    ProjectMeshId = request.MeshId,
                    Name = "Stitched",
                    Index = 0,
                    CameraAngle = "",
                    Visible = true,
                };
                var createdLayer = await _layerRepo.CreateAsync(newLayer);

                // Save the generated image to the new layer
                await _imageService.SaveProjectMeshLayerImageAsync(projectId, request.MeshId, createdLayer.Id, result.ImageBytes);

                // Generate and save thumbnail
                var thumbBytes = await _imageService.GenerateThumbnailAsync(result.ImageBytes, 100);
                await _imageService.SaveProjectMeshLayerThumbAsync(projectId, request.MeshId, createdLayer.Id, thumbBytes);

                // The generated image IS the UV map (it's a stitched UV map texture)
                await _imageService.SaveProjectMeshLayerUvMapAsync(projectId, request.MeshId, createdLayer.Id, result.ImageBytes);
                var uvThumbBytes = await _imageService.GenerateThumbnailAsync(result.ImageBytes, 100);
                await _imageService.SaveProjectMeshLayerUvMapThumbAsync(projectId, request.MeshId, createdLayer.Id, uvThumbBytes);

                return Json(new ApiResponse { success = true, data = new
                {
                    layerId = createdLayer.Id,
                    image = $"data:image/png;base64,{Convert.ToBase64String(result.ImageBytes)}"
                }});
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
