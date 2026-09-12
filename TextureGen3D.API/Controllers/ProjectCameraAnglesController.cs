using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.API.Services;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/project-camera-angles")]
    [Authorize]
    public class ProjectCameraAnglesController : ApiController
    {
        readonly IProjectRepository _projectRepo;
        readonly IProjectCameraAngleRepository _angleRepo;

        public ProjectCameraAnglesController(
            IProjectRepository projectRepo,
            IProjectCameraAngleRepository angleRepo)
        {
            _projectRepo = projectRepo;
            _angleRepo = angleRepo;
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

                var angles = await _angleRepo.GetByProjectIdAsync(projectId);
                return Json(new ApiResponse { success = true, data = angles });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
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

                var angles = await _angleRepo.GetByMeshIdAsync(meshId, projectId);
                return Json(new ApiResponse { success = true, data = angles });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class CreateAngleRequest
        {
            public Guid ModelId { get; set; }
            public Guid MeshId { get; set; }
            public string Rotation { get; set; } = "{}";
        }

        [HttpPost("{projectId}")]
        public async Task<IActionResult> Create(Guid projectId, [FromBody] CreateAngleRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var angle = new ProjectCameraAngle
                {
                    ProjectId = projectId,
                    ModelId = request.ModelId,
                    MeshId = request.MeshId,
                    Rotation = request.Rotation,
                };
                var created = await _angleRepo.CreateAsync(angle);
                return Json(new ApiResponse { success = true, data = created });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/{angleId}/delete")]
        public async Task<IActionResult> Delete(Guid projectId, Guid angleId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _angleRepo.DeleteAsync(angleId, projectId);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/delete-all")]
        public async Task<IActionResult> DeleteAll(Guid projectId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _angleRepo.DeleteByProjectIdAsync(projectId);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/mesh/{meshId}/delete-all")]
        public async Task<IActionResult> DeleteAllByMesh(Guid projectId, Guid meshId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _angleRepo.DeleteByMeshIdAsync(meshId, projectId);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
