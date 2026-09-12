using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.API.Services;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/project-models")]
    [Authorize]
    public class ProjectModelsController : ApiController
    {
        readonly IProjectRepository _projectRepo;
        readonly IProjectModelRepository _modelRepo;
        readonly IProjectMeshRepository _meshRepo;
        readonly IProjectCameraAngleRepository _angleRepo;
        readonly IImageService _imageService;

        static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "fbx", "obj", "abc", "usd", "ply", "stl"
        };

        public ProjectModelsController(
            IProjectRepository projectRepo,
            IProjectModelRepository modelRepo,
            IProjectMeshRepository meshRepo,
            IProjectCameraAngleRepository angleRepo,
            IImageService imageService)
        {
            _projectRepo = projectRepo;
            _modelRepo = modelRepo;
            _meshRepo = meshRepo;
            _angleRepo = angleRepo;
            _imageService = imageService;
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

                var models = await _modelRepo.GetByProjectIdAsync(projectId);
                return Json(new ApiResponse { success = true, data = models });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/upload")]
        [RequestSizeLimit(1_000_000_000)]
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
                if (!AllowedExtensions.Contains(extension))
                    return Json(new ApiResponse { success = false, message = $"Unsupported file extension. Allowed: .fbx, .obj, .abc, .usd, .ply, .stl" });

                var model = new ProjectModel
                {
                    Id = Guid.NewGuid(),
                    ProjectId = projectId,
                    Filename = file.FileName,
                    Extension = extension,
                    FileSize = (int)file.Length
                };

                using var ms = new MemoryStream();
                await file.CopyToAsync(ms);
                var fileBytes = ms.ToArray();

                await _imageService.SaveProjectModelAsync(projectId, model.Id, extension, fileBytes);
                await _modelRepo.CreateAsync(model);

                return Json(new ApiResponse { success = true, data = model });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("{projectId}/{modelId}/download")]
        public async Task<IActionResult> Download(Guid projectId, Guid modelId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return NotFound();

                var model = await _modelRepo.GetByIdAsync(modelId, projectId);
                if (model == null)
                    return NotFound();

                var fileBytes = await _imageService.GetProjectModelAsync(projectId, modelId, model.Extension);
                if (fileBytes.Length == 0)
                    return NotFound();

                return File(fileBytes, "application/octet-stream", model.Filename);
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/{modelId}/delete")]
        public async Task<IActionResult> Delete(Guid projectId, Guid modelId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var model = await _modelRepo.GetByIdAsync(modelId, projectId);
                if (model == null)
                    return Json(new ApiResponse { success = false, message = "Model not found" });

                await _imageService.DeleteProjectModelAsync(projectId, modelId, model.Extension);
                // Cascade delete: camera angles first (FK → meshes), then meshes, then model
                await _angleRepo.DeleteByModelIdAsync(modelId, projectId);
                await _meshRepo.DeleteByModelIdAsync(modelId, projectId);
                await _modelRepo.DeleteAsync(modelId, projectId);

                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
