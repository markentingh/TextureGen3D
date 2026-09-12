using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.API.Models.Projects;
using TextureGen3D.API.Services;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/projects")]
    [Authorize]
    public class ProjectsController : ApiController
    {
        readonly IProjectRepository _projectRepo;
        readonly IProjectModelRepository _modelRepo;
        readonly IProjectMeshRepository _meshRepo;
        readonly IProjectCameraAngleRepository _angleRepo;
        readonly IImageGenerationModelRepository _imageGenRepo;
        readonly IImageService _imageService;

        public ProjectsController(
            IProjectRepository projectRepo,
            IProjectModelRepository modelRepo,
            IProjectMeshRepository meshRepo,
            IProjectCameraAngleRepository angleRepo,
            IImageGenerationModelRepository imageGenRepo,
            IImageService imageService)
        {
            _projectRepo = projectRepo;
            _modelRepo = modelRepo;
            _meshRepo = meshRepo;
            _angleRepo = angleRepo;
            _imageGenRepo = imageGenRepo;
            _imageService = imageService;
        }

        [HttpGet]
        public async Task<IActionResult> GetProjects()
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var projects = await _projectRepo.GetAllAsync(userId);
                var result = projects.Select(p => new
                {
                    p.Id,
                    p.Title,
                    p.Description,
                    p.Key,
                    p.Color,
                    p.Status,
                    p.Created,
                    hasThumb = _imageService.HasProjectThumbAsync(p.Id).GetAwaiter().GetResult()
                });
                return Json(new ApiResponse { success = true, data = result });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("archived")]
        public async Task<IActionResult> GetArchived()
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var projects = await _projectRepo.GetArchivedAsync(userId);
                return Json(new ApiResponse { success = true, data = projects });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetById(Guid id)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(id, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                return Json(new ApiResponse
                {
                    success = true,
                    data = new
                    {
                        project.Id,
                        project.Title,
                        project.Description,
                        project.Key,
                        project.Color,
                        project.Status,
                        project.Created,
                        hasThumb = await _imageService.HasProjectThumbAsync(project.Id)
                    }
                });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("{id}/load")]
        public async Task<IActionResult> Load(Guid id)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(id, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                // Fetch all project data in parallel
                var modelsTask = _modelRepo.GetByProjectIdAsync(id);
                var meshesTask = _meshRepo.GetByProjectIdAsync(id);
                var anglesTask = _angleRepo.GetByProjectIdAsync(id);
                var imageModelsTask = _imageGenRepo.GetActiveAsync();
                var hasThumbTask = _imageService.HasProjectThumbAsync(id);

                await Task.WhenAll(modelsTask, meshesTask, anglesTask, imageModelsTask, hasThumbTask);

                var models = await modelsTask;
                var meshes = await meshesTask;
                var angles = await anglesTask;
                var imageModels = await imageModelsTask;
                var hasThumb = await hasThumbTask;

                return Json(new ApiResponse
                {
                    success = true,
                    data = new
                    {
                        project = new
                        {
                            project.Id,
                            project.Title,
                            project.Description,
                            project.Key,
                            project.Color,
                            project.Status,
                            project.Created,
                            project.ImageModelId,
                            hasThumb
                        },
                        models,
                        meshes,
                        angles,
                        imageModels = imageModels.Select(m => new
                        {
                            id = m.Id,
                            modelKey = m.ModelKey,
                            name = m.Name,
                            model = m.Model,
                            type = m.Type,
                            cp1k = m.CP1K,
                            cp2k = m.CP2K,
                            cp4k = m.CP4K,
                            cp8k = m.CP8K
                        }).ToList()
                    }
                });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("{id}/thumb")]
        public async Task<IActionResult> GetThumb(Guid id)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(id, userId);
                if (project == null)
                    return NotFound();

                var thumbBytes = await _imageService.GetProjectThumbAsync(id);
                if (thumbBytes.Length == 0)
                    return NotFound();

                return File(thumbBytes, "image/jpeg");
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("{id}/generations/{generationId}/image")]
        public async Task<IActionResult> GetGenerationImage(Guid id, Guid generationId, [FromQuery] bool thumb = false)
        {
            try
            {
                var imageBytes = await _imageService.GetProjectImageGenerationAsync(id, generationId);
                if (imageBytes.Length == 0)
                    return NotFound();

                if (thumb)
                {
                    imageBytes = await _imageService.GenerateThumbnailAsync(imageBytes);
                }

                return File(imageBytes, "image/jpeg");
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("create")]
        public async Task<IActionResult> Create([FromBody] CreateProjectRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                if (string.IsNullOrWhiteSpace(request.Title))
                    return Json(new ApiResponse { success = false, message = "Title is required" });

                var project = await _projectRepo.CreateAsync(new Project
                {
                    AppUserId = userId,
                    Title = request.Title,
                    Description = request.Description,
                    Key = request.Key,
                    Color = request.Color
                });

                return Json(new ApiResponse { success = true, data = project });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("update-title")]
        public async Task<IActionResult> UpdateTitle([FromBody] UpdateProjectTitleRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                await _projectRepo.UpdateTitleAsync(request.Id, userId, request.Title);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("update-key")]
        public async Task<IActionResult> UpdateKey([FromBody] UpdateProjectKeyRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                await _projectRepo.UpdateKeyAsync(request.Id, userId, request.Key);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("update-image-model")]
        public async Task<IActionResult> UpdateImageModel([FromBody] UpdateProjectImageModelRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                await _projectRepo.UpdateImageModelAsync(request.Id, userId, request.ImageModelId);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{id}/save-thumb")]
        public async Task<IActionResult> SaveThumb(Guid id, [FromBody] SaveProjectThumbRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(id, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                if (string.IsNullOrWhiteSpace(request.Base64Image))
                    return Json(new ApiResponse { success = false, message = "No image provided" });

                var base64Data = request.Base64Image;
                var commaIndex = base64Data.IndexOf(',');
                if (commaIndex >= 0) base64Data = base64Data[(commaIndex + 1)..];

                var imageBytes = Convert.FromBase64String(base64Data);
                await _imageService.SaveProjectThumbAsync(id, imageBytes);

                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("archive")]
        public async Task<IActionResult> Archive([FromBody] ArchiveProjectRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                await _projectRepo.DeleteAsync(request.ProjectId, userId);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("unarchive")]
        public async Task<IActionResult> Unarchive([FromBody] ArchiveProjectRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                await _projectRepo.UnarchiveAsync(request.ProjectId, userId);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
