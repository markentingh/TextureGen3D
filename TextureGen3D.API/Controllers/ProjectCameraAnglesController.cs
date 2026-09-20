using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.API.Services;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/project-camera-angles")]
    [Authorize]
    public class ProjectCameraAnglesController : ApiController
    {
        readonly IProjectRepository _projectRepo;
        readonly IProjectCameraAngleRepository _angleRepo;
        readonly IProjectReferenceRepository _refRepo;
        readonly IImageGenerationModelRepository _imageGenModelRepo;
        readonly IImageService _imageService;
        readonly IImageGeneration _imageGeneration;
        readonly IEnumerable<IImageGeneration> _allImageGenerations;

        public ProjectCameraAnglesController(
            IProjectRepository projectRepo,
            IProjectCameraAngleRepository angleRepo,
            IProjectReferenceRepository refRepo,
            IImageGenerationModelRepository imageGenModelRepo,
            IImageService imageService,
            IImageGeneration imageGeneration,
            IEnumerable<IImageGeneration> allImageGenerations)
        {
            _projectRepo = projectRepo;
            _angleRepo = angleRepo;
            _refRepo = refRepo;
            _imageGenModelRepo = imageGenModelRepo;
            _imageService = imageService;
            _imageGeneration = imageGeneration;
            _allImageGenerations = allImageGenerations;
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
            public string Prompt { get; set; } = "";
            public Guid? ProjectReferenceId { get; set; }
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
                    Prompt = request.Prompt ?? "",
                    ProjectReferenceId = request.ProjectReferenceId,
                };
                var created = await _angleRepo.CreateAsync(angle);
                return Json(new ApiResponse { success = true, data = created });
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

        [HttpPost("{projectId}/{angleId}/update-prompt")]
        public async Task<IActionResult> UpdatePrompt(Guid projectId, Guid angleId, [FromBody] UpdatePromptRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _angleRepo.UpdatePromptAsync(angleId, projectId, request.Prompt ?? "");
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        public class UpdateReferenceRequest
        {
            public Guid? ProjectReferenceId { get; set; }
        }

        [HttpPost("{projectId}/{angleId}/update-reference")]
        public async Task<IActionResult> UpdateReference(Guid projectId, Guid angleId, [FromBody] UpdateReferenceRequest request)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var project = await _projectRepo.GetByIdAsync(projectId, userId);
                if (project == null)
                    return Json(new ApiResponse { success = false, message = "Project not found" });

                await _angleRepo.UpdateReferenceAsync(angleId, projectId, request.ProjectReferenceId);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/{angleId}/generate-reference")]
        public async Task<IActionResult> GenerateReference(
            Guid projectId,
            Guid angleId,
            [FromQuery] Guid referenceId,
            [FromQuery] int modelId,
            [FromQuery] string? userPrompt = null)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var (error, angle, imageBytes) = await GenerateReferenceCoreAsync(projectId, angleId, referenceId, modelId, userPrompt, userId);
                if (error != null)
                    return Json(new ApiResponse { success = false, message = error });

                // Save the generated image as a new ProjectReference (all reference
                // images belong to the project; camera angles just reference the ID).
                var dimensions = await _imageService.GetImageDimensionsAsync(imageBytes);
                var newReference = new ProjectReference
                {
                    Id = Guid.NewGuid(),
                    ProjectId = projectId,
                    Filename = $"CameraAngle_{angle!.Id}",
                    Extension = "png",
                    FileSize = imageBytes.Length,
                    Width = dimensions?.width ?? 1024,
                    Height = dimensions?.height ?? 1024,
                    Active = true
                };
                await _imageService.SaveProjectReferenceAsync(projectId, newReference.Id, "png", imageBytes);
                await _imageService.SaveProjectReferenceThumbAsync(projectId, newReference.Id, "png", imageBytes);
                await _refRepo.CreateAsync(newReference);

                // Link the new ProjectReference to this camera angle
                await _angleRepo.UpdateReferenceAsync(angleId, projectId, newReference.Id);

                return Json(new ApiResponse { success = true, data = new
                {
                    angleId = angle!.Id,
                    referenceId = newReference.Id,
                    image = Convert.ToBase64String(imageBytes)
                }});
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("{projectId}/{angleId}/preview-reference")]
        public async Task<IActionResult> PreviewReference(
            Guid projectId,
            Guid angleId,
            [FromQuery] Guid referenceId,
            [FromQuery] int modelId,
            [FromQuery] string? userPrompt = null)
        {
            try
            {
                var userId = GetUserId();
                if (userId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "Could not find user" });

                var (error, _, imageBytes) = await GenerateReferenceCoreAsync(projectId, angleId, referenceId, modelId, userPrompt, userId);
                if (error != null)
                    return Json(new ApiResponse { success = false, message = error });

                // Preview only — do NOT persist to disk or the database
                return Json(new ApiResponse { success = true, data = new
                {
                    image = Convert.ToBase64String(imageBytes)
                }});
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        /// <summary>
        /// Shared validation + generation logic for both GenerateReference and PreviewReference.
        /// Returns (errorMessage, angle, generatedImageBytes). On success, errorMessage is null
        /// and angle/imageBytes are populated. On failure, errorMessage is set and the others
        /// are default.
        /// </summary>
        private async Task<(string? error, ProjectCameraAngle? angle, byte[] imageBytes)> GenerateReferenceCoreAsync(
            Guid projectId,
            Guid angleId,
            Guid referenceId,
            int modelId,
            string? userPrompt,
            Guid userId)
        {
            var project = await _projectRepo.GetByIdAsync(projectId, userId);
            if (project == null)
                return ("Project not found", null, Array.Empty<byte>());

            if (referenceId == Guid.Empty)
                return ("Reference ID is required", null, Array.Empty<byte>());

            var angle = await _angleRepo.GetByIdAsync(angleId, projectId);
            if (angle == null)
                return ("Camera angle not found", null, Array.Empty<byte>());

            var reference = await _refRepo.GetByIdAsync(referenceId, projectId);
            if (reference == null)
                return ("Reference not found", null, Array.Empty<byte>());

            var imageModel = await _imageGenModelRepo.GetByIdAsync(modelId);
            if (imageModel == null)
                return ("Image model not found", null, Array.Empty<byte>());

            // Read the 512x512 camera-angle thumbnail from the request body.
            // The frontend sends base64 text (Content-Type: text/plain), so we
            // must read it as a string and decode it — reading raw bytes would
            // give us the UTF-8 bytes of the base64 string, not the image.
            string cameraAngleBase64;
            using (var reader = new System.IO.StreamReader(Request.Body))
            {
                cameraAngleBase64 = await reader.ReadToEndAsync();
            }
            if (string.IsNullOrWhiteSpace(cameraAngleBase64))
                return ("Camera angle image not provided in body", null, Array.Empty<byte>());

            // Strip data URL prefix if present
            if (cameraAngleBase64.StartsWith("data:"))
                cameraAngleBase64 = cameraAngleBase64.Substring(cameraAngleBase64.IndexOf(',') + 1);

            byte[] cameraAngleBytes = Convert.FromBase64String(cameraAngleBase64);

            var referenceBytes = await _imageService.GetProjectReferenceAsync(projectId, referenceId, reference.Extension);
            if (referenceBytes.Length == 0)
                return ("Reference image not found on disk", null, Array.Empty<byte>());

            var prompt =
                "Generate a new image based on the reference image (input image #1) " +
                "but using the camera angle from input image #2. " +
                "Keep the subject, style, colors, and details of input image #1, " +
                "but re-render it from the same viewing angle, orientation, and perspective shown in input image #2.";

            // Append the optional user-supplied prompt to the bottom
            if (!string.IsNullOrWhiteSpace(userPrompt))
                prompt = prompt + "\n\n" + userPrompt;

            // Append the camera angle's own prompt from the database
            if (!string.IsNullOrWhiteSpace(angle.Prompt))
                prompt = prompt + "\n\n" + angle.Prompt;

            var genRequest = new ImageGenerationRequest
            {
                Prompt = prompt,
                Model = imageModel.Model,
                Width = 1024,
                Height = 1024,
                InputImages = new List<byte[]> { referenceBytes, cameraAngleBytes }
            };

            var genService = _allImageGenerations.FirstOrDefault(g => g.ModelKey == imageModel.ModelKey)
                ?? _imageGeneration;
            var result = await genService.GenerateAsync(genRequest);
            if (result.ImageBytes == null || result.ImageBytes.Length == 0)
                return ("Image generation returned no image", null, Array.Empty<byte>());

            return (null, angle, result.ImageBytes);
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
