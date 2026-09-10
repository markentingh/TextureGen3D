using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.API.Models.Projects;
using TextureGen3D.API.Services;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/projects")]
    [Authorize]
    public class ProjectsController : ApiController
    {
        readonly IProjectRepository _projectRepo;
        readonly IImageService _imageService;

        public ProjectsController(IProjectRepository projectRepo, IImageService imageService)
        {
            _projectRepo = projectRepo;
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
