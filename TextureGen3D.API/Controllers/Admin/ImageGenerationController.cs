using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using TextureGen3D.API.Models;
using TextureGen3D.API.Models.ImageGeneration;
using TextureGen3D.API.Services;
using TextureGen3D.Auth.Policies;
using TextureGen3D.Data.Entities;
using TextureGen3D.Data.Interfaces;
using TextureGen3D.Data.Interfaces.Projects;
using Dapper;
using System.Data;

namespace TextureGen3D.API.Controllers.Admin
{
    [Route("/api/admin/image-generation")]
    [Authorize(Policy = nameof(AuthConstants.Policy.ManageUsers))]
    public class ImageGenerationController : ApiController
    {
        readonly IImageGenerationModelRepository _repo;
        readonly IProjectImageGenerationRepository _projectImageGenRepo;
        readonly IDbConnection _dbConnection;
        readonly ImageGenerationOptions _imageGenOptions;

        public ImageGenerationController(
            IImageGenerationModelRepository repo,
            IProjectImageGenerationRepository projectImageGenRepo,
            IDbConnection dbConnection,
            IOptions<ImageGenerationOptions> imageGenOptions)
        {
            _repo = repo;
            _projectImageGenRepo = projectImageGenRepo;
            _dbConnection = dbConnection;
            _imageGenOptions = imageGenOptions.Value;
        }

        [HttpGet("get-models")]
        public async Task<IActionResult> GetModels()
        {
            try
            {
                var dbModels = (await _repo.GetAllAsync()).ToList();
                var result = dbModels.Select(m => new
                {
                    id = m.Id,
                    modelKey = m.ModelKey,
                    name = m.Name,
                    model = m.Model,
                    cpmitTokens = m.CPMITTokens,
                    cpmiiTokens = m.CPMIITokens,
                    cpmoTokens = m.CPMOTokens,
                    type = m.Type,
                    cp1k = m.CP1K,
                    cp2k = m.CP2K,
                    cp4k = m.CP4K,
                    cp8k = m.CP8K,
                    workflowJson = m.WorkflowJson,
                    promptPath = m.PromptPath,
                    depthMapPath = m.DepthMapPath,
                    inputImagesPath = m.InputImagesPath,
                    seedPath = m.SeedPath,
                    prompt = m.Prompt,
                    endpointUrl = m.EndpointUrl,
                    active = m.Active
                }).ToList();

                return Json(new ApiResponse { success = true, data = result });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("save-model")]
        public async Task<IActionResult> SaveModel([FromBody] SaveImageGenerationModelRequest request)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(request.ModelKey))
                    return Json(new ApiResponse { success = false, message = "Model key is required." });

                if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Model))
                    return Json(new ApiResponse { success = false, message = "Name and Model are required." });

                if (request.Id > 0)
                {
                    var existing = await _repo.GetByIdAsync(request.Id);
                    if (existing != null)
                    {
                        existing.ModelKey = request.ModelKey;
                        existing.Name = request.Name;
                        existing.Model = request.Model;
                        existing.CPMITTokens = request.CPMITTokens;
                        existing.CPMIITokens = request.CPMIITokens;
                        existing.CPMOTokens = request.CPMOTokens;
                        existing.Type = request.Type;
                        existing.CP1K = request.CP1K;
                        existing.CP2K = request.CP2K;
                        existing.CP4K = request.CP4K;
                        existing.CP8K = request.CP8K;
                        existing.WorkflowJson = request.WorkflowJson;
                        existing.PromptPath = request.PromptPath;
                        existing.DepthMapPath = request.DepthMapPath;
                        existing.InputImagesPath = request.InputImagesPath;
                        existing.SeedPath = request.SeedPath;
                        existing.Prompt = request.Prompt;
                        existing.EndpointUrl = request.EndpointUrl;
                        existing.Active = request.Active;
                        await _repo.UpdateAsync(existing);
                    }
                }
                else
                {
                    var model = new ImageGenerationModel
                    {
                        ModelKey = request.ModelKey,
                        Name = request.Name,
                        Model = request.Model,
                        CPMITTokens = request.CPMITTokens,
                        CPMIITokens = request.CPMIITokens,
                        CPMOTokens = request.CPMOTokens,
                        Type = request.Type,
                        CP1K = request.CP1K,
                        CP2K = request.CP2K,
                        CP4K = request.CP4K,
                        CP8K = request.CP8K,
                        WorkflowJson = request.WorkflowJson,
                        PromptPath = request.PromptPath,
                        DepthMapPath = request.DepthMapPath,
                        InputImagesPath = request.InputImagesPath,
                        SeedPath = request.SeedPath,
                        Prompt = request.Prompt,
                        EndpointUrl = request.EndpointUrl,
                        Active = request.Active
                    };
                    await _repo.CreateAsync(model);
                }

                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("toggle-active")]
        public async Task<IActionResult> ToggleActive([FromBody] ToggleActiveRequest request)
        {
            try
            {
                if (request.Id <= 0)
                    return Json(new ApiResponse { success = false, message = "ID is required." });

                await _repo.ToggleActiveAsync(request.Id, request.Active);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("delete-model")]
        public async Task<IActionResult> DeleteModel([FromBody] DeleteImageGenerationModelRequest request)
        {
            try
            {
                if (request.Id <= 0)
                    return Json(new ApiResponse { success = false, message = "ID is required." });

                await _repo.DeleteAsync(request.Id);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("get-generations")]
        public async Task<IActionResult> GetGenerations([FromQuery] int start = 0, [FromQuery] int length = 25)
        {
            try
            {
                const string query = @"
                    SELECT pig.*, u.""Email"" AS ""UserEmail"", p.""Title"" AS ""ProjectTitle"", igm.""Name"" AS ""ModelName""
                    FROM public.""ProjectImageGenerations"" pig
                    LEFT JOIN public.""AppUsers"" u ON pig.""AppUserId"" = u.""Id""
                    LEFT JOIN public.""Projects"" p ON pig.""ProjectId"" = p.""Id""
                    LEFT JOIN public.""ImageGeneration"" igm ON pig.""ImageGenerationId"" = igm.""Id""
                    ORDER BY pig.""DateCreated"" DESC
                    OFFSET @start LIMIT @length";

                var rows = await _dbConnection.QueryAsync(query, new { start, length });

                const string countQuery = @"SELECT COUNT(*) FROM public.""ProjectImageGenerations""";
                var totalCount = await _dbConnection.ExecuteScalarAsync<int>(countQuery);

                var items = rows.Select(r => new
                {
                    id = r.Id,
                    projectId = r.ProjectId,
                    appUserId = r.AppUserId,
                    userEmail = (string?)r.UserEmail,
                    projectTitle = (string?)r.ProjectTitle,
                    modelName = (string?)r.ModelName,
                    inputTextTokens = r.InputTextTokens,
                    inputImageTokens = r.InputImageTokens,
                    outputTokens = r.OutputTokens,
                    tokens = r.Tokens,
                    cost = r.Cost,
                    prompt = r.Prompt,
                    filename = r.Filename,
                    resolution = r.Resolution,
                    inputImages = r.InputImages,
                    inputImageJson = r.InputImageJson,
                    type = r.Type,
                    dateCreated = r.DateCreated
                }).ToList();

                return Json(new ApiResponse { success = true, data = new { items, totalCount } });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("get-daily-costs")]
        public async Task<IActionResult> GetDailyCosts([FromQuery] string range = "30days")
        {
            try
            {
                var results = await _projectImageGenRepo.GetDailyCostsAsync(range);
                var items = results.Select(r => new
                {
                    date = r.Date.ToString("yyyy-MM-dd"),
                    totalCost = r.TotalCost,
                    upscaleCost = r.UpscaleCost,
                    totalTokens = r.TotalTokens,
                    totalInputTextTokens = r.TotalInputTextTokens,
                    totalInputImageTokens = r.TotalInputImageTokens,
                    totalOutputTokens = r.TotalOutputTokens,
                    totalGenerations = r.TotalGenerations
                }).ToList();

                return Json(new ApiResponse { success = true, data = items });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("gradio-endpoints")]
        public async Task<IActionResult> GetGradioEndpoints()
        {
            try
            {
                if (!_imageGenOptions.Models.TryGetValue("gradio", out var gradioConfig))
                    return Json(new ApiResponse { success = false, message = "Gradio model configuration not found" });

                var endpoint = gradioConfig.Endpoint.TrimEnd('/');
                var openapiUrl = $"{endpoint}/gradio_api/openapi.json";

                using var httpClient = new HttpClient();
                httpClient.Timeout = TimeSpan.FromSeconds(30);
                var response = await httpClient.GetAsync(openapiUrl);
                if (!response.IsSuccessStatusCode)
                    return Json(new ApiResponse { success = false, message = $"Failed to fetch Gradio OpenAPI spec: {response.StatusCode}" });

                var json = await response.Content.ReadAsStringAsync();
                var openapi = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(json);

                // Extract POST endpoints under /gradio_api/call/ (excluding {event_id} result fetchers)
                var endpoints = new List<object>();
                if (openapi.TryGetProperty("paths", out var paths))
                {
                    foreach (var pathProp in paths.EnumerateObject())
                    {
                        var path = pathProp.Name;
                        if (!path.StartsWith("/gradio_api/call/") || path.Contains("event_id"))
                            continue;

                        if (!pathProp.Value.TryGetProperty("post", out var post))
                            continue;

                        // Extract parameters from requestBody
                        var parameters = new List<string>();
                        if (post.TryGetProperty("requestBody", out var requestBody) &&
                            requestBody.TryGetProperty("content", out var content) &&
                            content.TryGetProperty("application/json", out var appJson) &&
                            appJson.TryGetProperty("schema", out var schema) &&
                            schema.TryGetProperty("properties", out var props))
                        {
                            foreach (var paramProp in props.EnumerateObject())
                            {
                                parameters.Add(paramProp.Name);
                            }
                        }

                        // Display path without /gradio_api/call/ prefix
                        var displayPath = path.Substring("/gradio_api/call/".Length);

                        endpoints.Add(new
                        {
                            path = displayPath,
                            fullPath = path,
                            parameters
                        });
                    }
                }

                return Json(new ApiResponse { success = true, data = endpoints });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("gradio-health")]
        public async Task<IActionResult> GradioHealth()
        {
            try
            {
                if (!_imageGenOptions.Models.TryGetValue("gradio", out var gradioConfig))
                    return Json(new ApiResponse { success = false, message = "Gradio model configuration not found" });

                var endpoint = gradioConfig.Endpoint.TrimEnd('/');
                var healthUrl = $"{endpoint}/gradio_api/openapi.json";

                using var httpClient = new HttpClient();
                httpClient.Timeout = TimeSpan.FromSeconds(5);
                var response = await httpClient.GetAsync(healthUrl);
                if (response.IsSuccessStatusCode)
                    return Json(new ApiResponse { success = true });
                return Json(new ApiResponse { success = false, message = $"Gradio server returned {response.StatusCode}" });
            }
            catch (TaskCanceledException)
            {
                return Json(new ApiResponse { success = false, message = "Gradio server timed out" });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
