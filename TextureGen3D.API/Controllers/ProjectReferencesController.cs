using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using TextureGen3D.API.Models;
using TextureGen3D.API.Services;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/project-references")]
    [Authorize]
    public class ProjectReferencesController : ApiController
    {
        readonly IProjectRepository _projectRepo;
        readonly IProjectReferenceRepository _refRepo;
        readonly IProjectMeshReferenceRepository _meshRefRepo;
        readonly IImageGenerationModelRepository _imageGenModelRepo;
        readonly IImageService _imageService;
        readonly IImageGeneration _imageGeneration;

        static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "png", "jpg", "jpeg", "webp"
        };

        public ProjectReferencesController(
            IProjectRepository projectRepo,
            IProjectReferenceRepository refRepo,
            IProjectMeshReferenceRepository meshRefRepo,
            IImageGenerationModelRepository imageGenModelRepo,
            IImageService imageService,
            IImageGeneration imageGeneration)
        {
            _projectRepo = projectRepo;
            _refRepo = refRepo;
            _meshRefRepo = meshRefRepo;
            _imageGenModelRepo = imageGenModelRepo;
            _imageService = imageService;
            _imageGeneration = imageGeneration;
        }

        [HttpGet("{projectId}")]
        public async Task<IActionResult> GetByProject(Guid projectId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var references = await _refRepo.GetByProjectIdAsync(projectId);
                var result = references.Select(r => new
                {
                    id = r.Id,
                    projectId = r.ProjectId,
                    filename = r.Filename,
                    extension = r.Extension,
                    fileSize = r.FileSize,
                    width = r.Width,
                    height = r.Height,
                    active = r.Active,
                    created = r.Created
                }).ToList();

                return Json(new ApiResponse { success = true, data = result });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/upload")]
        [RequestSizeLimit(50_000_000)]
        public async Task<IActionResult> Upload(Guid projectId, IFormFile file)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                if (file == null || file.Length == 0)
                    return Json(new ApiResponse { success = false, message = "No file provided" });

                var extension = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
                if (extension == "jpeg") extension = "jpg";
                if (!AllowedExtensions.Contains(extension))
                    return Json(new ApiResponse { success = false, message = "Unsupported file extension. Allowed: .png, .jpg, .webp" });

                using var ms = new MemoryStream();
                await file.CopyToAsync(ms);
                var fileBytes = ms.ToArray();

                // Convert webp to png
                if (extension == "webp")
                {
                    using var image = Image.Load(fileBytes);
                    using var pngMs = new MemoryStream();
                    await image.SaveAsync(pngMs, new PngEncoder());
                    fileBytes = pngMs.ToArray();
                    extension = "png";
                }

                // Resize large images down to 1024 width
                var dimensions = await _imageService.GetImageDimensionsAsync(fileBytes);
                int width = 0, height = 0;
                if (dimensions.HasValue)
                {
                    width = dimensions.Value.width;
                    height = dimensions.Value.height;
                    if (width > 1024)
                    {
                        fileBytes = await _imageService.ResizeImageAsync(fileBytes, 1024);
                        var resizedDims = await _imageService.GetImageDimensionsAsync(fileBytes);
                        if (resizedDims.HasValue)
                        {
                            width = resizedDims.Value.width;
                            height = resizedDims.Value.height;
                        }
                    }
                }

                var reference = new ProjectReference
                {
                    Id = Guid.NewGuid(),
                    ProjectId = projectId,
                    Filename = file.FileName,
                    Extension = extension,
                    FileSize = fileBytes.Length,
                    Width = width,
                    Height = height,
                    Active = true
                };

                await _imageService.SaveProjectReferenceAsync(projectId, reference.Id, extension, fileBytes);
                await _imageService.SaveProjectReferenceThumbAsync(projectId, reference.Id, extension, fileBytes);
                await _refRepo.CreateAsync(reference);

                return Json(new ApiResponse { success = true, data = new
                {
                    id = reference.Id,
                    projectId = reference.ProjectId,
                    filename = reference.Filename,
                    extension = reference.Extension,
                    fileSize = reference.FileSize,
                    width = reference.Width,
                    height = reference.Height,
                    active = reference.Active,
                    created = reference.Created
                }});
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("{projectId}/{referenceId}/image")]
        public async Task<IActionResult> GetImage(Guid projectId, Guid referenceId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return NotFound();

                var reference = await _refRepo.GetByIdAsync(referenceId, projectId);
                if (reference == null)
                    return NotFound();

                var fileBytes = await _imageService.GetProjectReferenceAsync(projectId, referenceId, reference.Extension);
                if (fileBytes.Length == 0)
                    return NotFound();

                var contentType = reference.Extension == "png" ? "image/png" : "image/jpeg";
                return File(fileBytes, contentType);
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("{projectId}/{referenceId}/thumb")]
        public async Task<IActionResult> GetThumb(Guid projectId, Guid referenceId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return NotFound();

                var reference = await _refRepo.GetByIdAsync(referenceId, projectId);
                if (reference == null)
                    return NotFound();

                var thumbBytes = await _imageService.GetProjectReferenceThumbAsync(projectId, referenceId, reference.Extension);
                if (thumbBytes.Length == 0)
                    return NotFound();

                return File(thumbBytes, "image/jpeg");
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/{referenceId}/delete")]
        public async Task<IActionResult> Delete(Guid projectId, Guid referenceId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var reference = await _refRepo.GetByIdAsync(referenceId, projectId);
                if (reference == null)
                    return Json(new ApiResponse { success = false, message = "Reference not found" });

                // Delete all mesh reference records that point to this project reference
                await _meshRefRepo.DeleteByReferenceIdAsync(referenceId, projectId);
                await _imageService.DeleteProjectReferenceAsync(projectId, referenceId, reference.Extension);
                await _imageService.DeleteProjectReferenceThumbAsync(projectId, referenceId, reference.Extension);
                await _refRepo.DeleteAsync(referenceId, projectId);

                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/{referenceId}/update-active")]
        public async Task<IActionResult> UpdateActive(Guid projectId, Guid referenceId, [FromQuery] bool active)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _refRepo.UpdateActiveAsync(referenceId, projectId, active);

                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/generate")]
        public async Task<IActionResult> Generate(Guid projectId, [FromBody] GenerateReferenceRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                if (request.ReferenceId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Reference ID is required" });

                var reference = await _refRepo.GetByIdAsync(request.ReferenceId, projectId);
                if (reference == null)
                    return Json(new ApiResponse { success = false, message = "Reference not found" });

                var imageModel = await _imageGenModelRepo.GetByIdAsync(request.ImageModelId);
                if (imageModel == null)
                    return Json(new ApiResponse { success = false, message = "Image model not found" });

                var referenceBytes = await _imageService.GetProjectReferenceAsync(projectId, request.ReferenceId, reference.Extension);
                if (referenceBytes.Length == 0)
                    return Json(new ApiResponse { success = false, message = "Reference image not found on disk" });

                var genRequest = new ImageGenerationRequest
                {
                    Prompt = request.Prompt ?? "",
                    Model = imageModel.Model,
                    Width = 1024,
                    Height = 1024,
                    InputImages = new List<byte[]> { referenceBytes }
                };

                var result = await _imageGeneration.GenerateAsync(genRequest);
                if (result.ImageBytes == null || result.ImageBytes.Length == 0)
                    return Json(new ApiResponse { success = false, message = "Image generation returned no image" });

                // Return as base64 so the client can preview before saving
                return Json(new ApiResponse { success = true, data = new
                {
                    image = Convert.ToBase64String(result.ImageBytes)
                }});
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/save-generated")]
        public async Task<IActionResult> SaveGenerated(Guid projectId, [FromBody] SaveGeneratedReferenceRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                if (string.IsNullOrWhiteSpace(request.ImageBase64))
                    return Json(new ApiResponse { success = false, message = "No image data provided" });

                var fileBytes = Convert.FromBase64String(request.ImageBase64);
                var extension = "png";

                // Resize to max 1024 width
                var dimensions = await _imageService.GetImageDimensionsAsync(fileBytes);
                int width = 0, height = 0;
                if (dimensions.HasValue)
                {
                    width = dimensions.Value.width;
                    height = dimensions.Value.height;
                    if (width > 1024)
                    {
                        fileBytes = await _imageService.ResizeImageAsync(fileBytes, 1024);
                        var resizedDims = await _imageService.GetImageDimensionsAsync(fileBytes);
                        if (resizedDims.HasValue)
                        {
                            width = resizedDims.Value.width;
                            height = resizedDims.Value.height;
                        }
                    }
                }

                if (request.Mode == "replace" && request.ReferenceId != Guid.Empty)
                {
                    // Replace existing reference
                    var existing = await _refRepo.GetByIdAsync(request.ReferenceId, projectId);
                    if (existing == null)
                        return Json(new ApiResponse { success = false, message = "Reference not found" });

                    // Delete old files
                    await _imageService.DeleteProjectReferenceAsync(projectId, request.ReferenceId, existing.Extension);
                    await _imageService.DeleteProjectReferenceThumbAsync(projectId, request.ReferenceId, existing.Extension);

                    // Save new files with png extension
                    await _imageService.SaveProjectReferenceAsync(projectId, request.ReferenceId, extension, fileBytes);
                    await _imageService.SaveProjectReferenceThumbAsync(projectId, request.ReferenceId, extension, fileBytes);

                    // Update DB record
                    existing.Extension = extension;
                    existing.FileSize = fileBytes.Length;
                    existing.Width = width;
                    existing.Height = height;
                    await _refRepo.UpdateAsync(existing);

                    return Json(new ApiResponse { success = true, data = new
                    {
                        id = existing.Id,
                        projectId = existing.ProjectId,
                        filename = existing.Filename,
                        extension = existing.Extension,
                        fileSize = existing.FileSize,
                        width = existing.Width,
                        height = existing.Height,
                        active = existing.Active,
                        created = existing.Created
                    }});
                }
                else
                {
                    // Create new reference
                    var reference = new ProjectReference
                    {
                        Id = Guid.NewGuid(),
                        ProjectId = projectId,
                        Filename = $"generated_{DateTime.UtcNow:yyyyMMddHHmmss}.png",
                        Extension = extension,
                        FileSize = fileBytes.Length,
                        Width = width,
                        Height = height,
                        Active = true
                    };

                    await _imageService.SaveProjectReferenceAsync(projectId, reference.Id, extension, fileBytes);
                    await _imageService.SaveProjectReferenceThumbAsync(projectId, reference.Id, extension, fileBytes);
                    await _refRepo.CreateAsync(reference);

                    return Json(new ApiResponse { success = true, data = new
                    {
                        id = reference.Id,
                        projectId = reference.ProjectId,
                        filename = reference.Filename,
                        extension = reference.Extension,
                        fileSize = reference.FileSize,
                        width = reference.Width,
                        height = reference.Height,
                        active = reference.Active,
                        created = reference.Created
                    }});
                }
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }

    public class GenerateReferenceRequest
    {
        public Guid ReferenceId { get; set; }
        public int ImageModelId { get; set; }
        public string Prompt { get; set; } = "";
    }

    public class SaveGeneratedReferenceRequest
    {
        public string ImageBase64 { get; set; } = "";
        public string Mode { get; set; } = "new"; // "new" or "replace"
        public Guid ReferenceId { get; set; }
    }
}
