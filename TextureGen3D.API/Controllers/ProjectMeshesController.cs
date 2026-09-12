using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.API.Services;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/project-meshes")]
    [Authorize]
    public class ProjectMeshesController : ApiController
    {
        readonly IProjectRepository _projectRepo;
        readonly IProjectMeshRepository _meshRepo;

        public ProjectMeshesController(
            IProjectRepository projectRepo,
            IProjectMeshRepository meshRepo)
        {
            _projectRepo = projectRepo;
            _meshRepo = meshRepo;
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

                var meshes = await _meshRepo.GetByProjectIdAsync(projectId);
                return Json(new ApiResponse { success = true, data = meshes });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("{projectId}/model/{modelId}")]
        public async Task<IActionResult> GetByModel(Guid projectId, Guid modelId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var meshes = await _meshRepo.GetByModelIdAsync(modelId, projectId);
                return Json(new ApiResponse { success = true, data = meshes });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class CreateMeshRequest
        {
            public Guid ModelId { get; set; }
            public string Name { get; set; } = "";
            public string MeshData { get; set; } = "";
            public string UVMapData { get; set; } = "";
            public int Triangles { get; set; }
            public int Vertices { get; set; }
        }

        [HttpPost("{projectId}")]
        public async Task<IActionResult> Create(Guid projectId, [FromBody] CreateMeshRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var mesh = new ProjectMesh
                {
                    ProjectId = projectId,
                    ModelId = request.ModelId,
                    Name = request.Name,
                    MeshData = request.MeshData,
                    UVMapData = request.UVMapData,
                    Triangles = request.Triangles,
                    Vertices = request.Vertices,
                };
                var created = await _meshRepo.CreateAsync(mesh);
                return Json(new ApiResponse { success = true, data = created });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/batch")]
        public async Task<IActionResult> CreateBatch(Guid projectId, [FromBody] List<CreateMeshRequest> requests)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                var created = new List<ProjectMesh>();
                foreach (var request in requests)
                {
                    var mesh = new ProjectMesh
                    {
                        ProjectId = projectId,
                        ModelId = request.ModelId,
                        Name = request.Name,
                        MeshData = request.MeshData,
                        UVMapData = request.UVMapData,
                        Triangles = request.Triangles,
                        Vertices = request.Vertices,
                    };
                    created.Add(await _meshRepo.CreateAsync(mesh));
                }
                return Json(new ApiResponse { success = true, data = created });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/{meshId}/delete")]
        public async Task<IActionResult> Delete(Guid projectId, Guid meshId)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _meshRepo.DeleteAsync(meshId, projectId);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class UpdatePromptRequest
        {
            public string Prompt { get; set; } = "";
        }

        [HttpPost("{projectId}/{meshId}/update-prompt")]
        public async Task<IActionResult> UpdatePrompt(Guid projectId, Guid meshId, [FromBody] UpdatePromptRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _meshRepo.UpdatePromptAsync(meshId, projectId, request.Prompt ?? "");
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
