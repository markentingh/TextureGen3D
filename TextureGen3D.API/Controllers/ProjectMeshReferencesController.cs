using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/project-mesh-references")]
    [Authorize]
    public class ProjectMeshReferencesController : ApiController
    {
        readonly IProjectRepository _projectRepo;
        readonly IProjectMeshRepository _meshRepo;
        readonly IProjectMeshReferenceRepository _meshRefRepo;

        public ProjectMeshReferencesController(
            IProjectRepository projectRepo,
            IProjectMeshRepository meshRepo,
            IProjectMeshReferenceRepository meshRefRepo)
        {
            _projectRepo = projectRepo;
            _meshRepo = meshRepo;
            _meshRefRepo = meshRefRepo;
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

                var meshRefs = await _meshRefRepo.GetByMeshIdAsync(meshId, projectId);
                return Json(new ApiResponse { success = true, data = meshRefs });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class AddMeshReferenceRequest
        {
            public Guid MeshId { get; set; }
            public Guid ReferenceId { get; set; }
        }

        [HttpPost("{projectId}")]
        public async Task<IActionResult> Add(Guid projectId, [FromBody] AddMeshReferenceRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                // Check if already exists
                var existing = await _meshRefRepo.GetByMeshAndReferenceAsync(request.MeshId, request.ReferenceId, projectId);
                if (existing != null)
                    return Json(new ApiResponse { success = true, data = existing });

                var meshRef = new ProjectMeshReference
                {
                    ProjectId = projectId,
                    ProjectMeshId = request.MeshId,
                    ProjectReferenceId = request.ReferenceId,
                    Active = true,
                };
                var created = await _meshRefRepo.CreateAsync(meshRef);
                return Json(new ApiResponse { success = true, data = created });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/{meshRefId}/delete")]
        public async Task<IActionResult> Delete(Guid projectId, Guid meshRefId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _meshRefRepo.DeleteAsync(meshRefId, projectId);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/{meshRefId}/update-active")]
        public async Task<IActionResult> UpdateActive(Guid projectId, Guid meshRefId, [FromQuery] bool active)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _meshRefRepo.UpdateActiveAsync(meshRefId, projectId, active);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
