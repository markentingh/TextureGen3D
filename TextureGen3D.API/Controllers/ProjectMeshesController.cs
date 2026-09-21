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
        readonly IImageService _imageService;

        public ProjectMeshesController(
            IProjectRepository projectRepo,
            IProjectMeshRepository meshRepo,
            IImageService imageService)
        {
            _projectRepo = projectRepo;
            _meshRepo = meshRepo;
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

        public class SyncMeshesRequest
        {
            public Guid ModelId { get; set; }
            public List<CreateMeshRequest> Meshes { get; set; } = new();
        }

        // Re-upload of an existing model: incoming meshes update the existing
        // record with the same name (preserving its Id so layers/camera angles
        // keep pointing at it); unmatched names create new records.
        // Returns the resulting records aligned to the incoming order.
        [HttpPost("{projectId}/sync")]
        public async Task<IActionResult> Sync(Guid projectId, [FromBody] SyncMeshesRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                // Queue of existing records per name — consumed in order so
                // duplicate mesh names each map to a distinct record
                var existing = (await _meshRepo.GetByModelIdAsync(request.ModelId, projectId))
                    .GroupBy(m => m.Name ?? "")
                    .ToDictionary(g => g.Key, g => new Queue<ProjectMesh>(g));

                var results = new List<ProjectMesh>();
                foreach (var incoming in request.Meshes)
                {
                    var name = incoming.Name ?? "";
                    if (existing.TryGetValue(name, out var queue) && queue.Count > 0)
                    {
                        var match = queue.Dequeue();
                        await _meshRepo.UpdateDataAsync(match.Id, projectId, incoming.MeshData, incoming.UVMapData, incoming.Triangles, incoming.Vertices);
                        match.MeshData = incoming.MeshData;
                        match.UVMapData = incoming.UVMapData;
                        match.Triangles = incoming.Triangles;
                        match.Vertices = incoming.Vertices;
                        results.Add(match);
                    }
                    else
                    {
                        var mesh = new ProjectMesh
                        {
                            ProjectId = projectId,
                            ModelId = request.ModelId,
                            Name = name,
                            MeshData = incoming.MeshData,
                            UVMapData = incoming.UVMapData,
                            Triangles = incoming.Triangles,
                            Vertices = incoming.Vertices,
                        };
                        results.Add(await _meshRepo.CreateAsync(mesh));
                    }
                }
                return Json(new ApiResponse { success = true, data = results });
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

                // Layers/references/angles cascade via FK; the mesh's on-disk
                // folder (uvmaps, masks, layer images) needs explicit removal
                await _imageService.DeleteProjectMeshFolderAsync(projectId, meshId);
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
