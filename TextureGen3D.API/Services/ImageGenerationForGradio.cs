using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using TextureGen3D.Data.Entities;

namespace TextureGen3D.API.Services
{
    public class ImageGenerationForGradio : IImageGeneration
    {
        readonly IHttpClientFactory _httpClientFactory;
        readonly ImageGenerationOptions _options;

        public string ModelKey => "gradio";

        public IImageTokens CreateTokenizer(ImageGenerationModel model)
        {
            return new ImageTokensForGradio(model);
        }

        public ImageGenerationForGradio(IHttpClientFactory httpClientFactory, IOptions<ImageGenerationOptions> options)
        {
            _httpClientFactory = httpClientFactory;
            _options = options.Value;
        }

        public Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request)
        {
            throw new NotSupportedException("Gradio generation requires progress tracking. Use GenerateWithProgressAsync via the SignalR hub.");
        }

        /// <summary>
        /// Full Gradio generation flow with progress reporting.
        /// Called from the GradioHub.
        ///
        /// Flow:
        /// 1. Upload input images (depth map + reference) via /gradio_api/upload
        /// 2. POST to the configured endpoint URL (e.g. /gradio_api/call/v2/generate_reference_depth)
        ///    with the parameter mappings from the ImageGenerationModel
        /// 3. Read the event_id from the response
        /// 4. Stream the SSE result from /gradio_api/call/{api_name}/{event_id}
        /// 5. Parse the final "event: complete" message to get the output image URL
        /// 6. Download the output image
        /// </summary>
        public async Task<ImageGenerationResult> GenerateWithProgressAsync(
            ImageGenerationRequest request,
            ImageGenerationModel imageModel,
            int? seed = null,
            IProgress<(int value, string? message)>? progress = null,
            CancellationToken cancellationToken = default)
        {
            if (!_options.Models.TryGetValue("gradio", out var config))
                throw new InvalidOperationException("Gradio image model is not configured.");

            var endpoint = config.Endpoint.TrimEnd('/');

            using var client = _httpClientFactory.CreateClient("ImageGeneration");
            client.Timeout = TimeSpan.FromMinutes(10);

            // The endpointUrl stored on the model includes the /gradio_api/call/ prefix,
            // e.g. "/gradio_api/call/v2/generate_reference_depth"
            var endpointUrl = imageModel.EndpointUrl;
            if (string.IsNullOrWhiteSpace(endpointUrl))
                throw new InvalidOperationException("Gradio model has no endpoint URL configured.");

            var postUrl = $"{endpoint}{endpointUrl}";

            // Extract the API name from the endpoint URL for the SSE stream.
            // endpointUrl is like "/gradio_api/call/v2/generate_reference_depth"
            // The SSE stream URL is "/gradio_api/call/generate_reference_depth/{event_id}"
            // (drops the "v2/" segment and appends the event_id)
            var apiName = ExtractApiName(endpointUrl);

            // 1. Upload input images
            progress?.Report((5, "Uploading input images..."));

            // Use a unique upload session ID so Gradio doesn't collide on filenames
            // across multiple angle generations in the same session
            var uploadId = Guid.NewGuid().ToString("N")[..8];

            var inputImages = request.InputImages ?? new List<byte[]>();
            string? depthMapPath = null;
            string? referenceImagePath = null;

            Console.WriteLine($"[Gradio] Input images count: {inputImages.Count}");
            if (inputImages.Count > 0)
                Console.WriteLine($"[Gradio]   Depth map bytes: {inputImages[0].Length}");
            if (inputImages.Count > 1)
                Console.WriteLine($"[Gradio]   Reference image bytes: {inputImages[1].Length}");

            if (inputImages.Count > 0)
            {
                depthMapPath = await UploadFileAsync(client, endpoint, inputImages[0], $"depth_map_{uploadId}.png", cancellationToken);
                Console.WriteLine($"[Gradio]   Depth map uploaded to: {depthMapPath}");
                progress?.Report((10, "Depth map uploaded."));
            }
            if (inputImages.Count > 1)
            {
                referenceImagePath = await UploadFileAsync(client, endpoint, inputImages[1], $"reference_{uploadId}.png", cancellationToken);
                Console.WriteLine($"[Gradio]   Reference image uploaded to: {referenceImagePath}");
                progress?.Report((15, "Reference image uploaded."));
            }

            // 2. Build the request body using the parameter names from the model
            var bodyParams = new Dictionary<string, object>();

            Console.WriteLine($"[Gradio] Parameter mapping: DepthMapPath='{imageModel.DepthMapPath}', InputImagesPath='{imageModel.InputImagesPath}', PromptPath='{imageModel.PromptPath}'");

            if (!string.IsNullOrWhiteSpace(imageModel.DepthMapPath) && depthMapPath != null)
            {
                bodyParams[imageModel.DepthMapPath] = new { path = depthMapPath, meta = new { _type = "gradio.FileData" } };
                Console.WriteLine($"[Gradio]   Mapped depth map to parameter '{imageModel.DepthMapPath}'");
            }
            if (!string.IsNullOrWhiteSpace(imageModel.InputImagesPath) && referenceImagePath != null)
            {
                bodyParams[imageModel.InputImagesPath] = new { path = referenceImagePath, meta = new { _type = "gradio.FileData" } };
                Console.WriteLine($"[Gradio]   Mapped reference image to parameter '{imageModel.InputImagesPath}'");
            }
            // Note: prompt is not sent to Gradio — the RefControl LoRA uses only
            // the depth map and reference image for conditioning.
            if (!string.IsNullOrWhiteSpace(imageModel.SeedPath) && seed.HasValue)
            {
                bodyParams[imageModel.SeedPath] = seed.Value;
                Console.WriteLine($"[Gradio]   Mapped seed {seed.Value} to parameter '{imageModel.SeedPath}'");
            }

            // Texture resolution → scales both input images and the output
            // (see modules/refcontrol_depth.py depth_to_image's resolution arg)
            var resolution = request.Width > 0 ? request.Width : 1024;
            bodyParams["resolution"] = resolution;
            Console.WriteLine($"[Gradio]   Mapped resolution {resolution} to parameter 'resolution'");

            var jsonBody = JsonSerializer.Serialize(bodyParams);
            Console.WriteLine($"[Gradio] Request body: {jsonBody}");

            // 3. POST to start the generation
            progress?.Report((20, "Starting generation..."));
            using var postContent = new StringContent(jsonBody, Encoding.UTF8, "application/json");
            using var postResponse = await client.PostAsync(postUrl, postContent, cancellationToken);
            var postResponseContent = await postResponse.Content.ReadAsStringAsync(cancellationToken);

            if (!postResponse.IsSuccessStatusCode)
                throw new InvalidOperationException($"Gradio POST failed: {postResponse.StatusCode} - {postResponseContent}");

            var postJson = JsonNode.Parse(postResponseContent) as JsonObject
                ?? throw new InvalidOperationException("Failed to parse Gradio POST response.");

            var eventId = postJson["event_id"]?.GetValue<string>()
                ?? throw new InvalidOperationException("Gradio POST did not return an event_id.");

            // 4. Stream the SSE result
            progress?.Report((30, "Waiting for generation..."));
            var sseUrl = $"{endpoint}/gradio_api/call/{apiName}/{eventId}";

            using var sseResponse = await client.GetAsync(sseUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!sseResponse.IsSuccessStatusCode)
                throw new InvalidOperationException($"Gradio SSE stream failed: {sseResponse.StatusCode}");

            string? outputUrl = null;
            using var sseStream = await sseResponse.Content.ReadAsStreamAsync(cancellationToken);
            using var reader = new StreamReader(sseStream);

            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(cancellationToken);
                if (line == null) break;

                // SSE format: "event: complete" followed by "data: [...]"
                if (line.StartsWith("event:"))
                {
                    var eventType = line.Substring("event:".Length).Trim();
                    if (eventType == "complete")
                    {
                        progress?.Report((90, "Generation complete, fetching output..."));
                    }
                    else if (eventType == "error")
                    {
                        var errorData = await reader.ReadLineAsync(cancellationToken);
                        throw new InvalidOperationException($"Gradio generation error: {errorData}");
                    }
                }
                else if (line.StartsWith("data:"))
                {
                    var dataContent = line.Substring("data:".Length).Trim();
                    if (string.IsNullOrWhiteSpace(dataContent)) continue;

                    try
                    {
                        var dataJson = JsonNode.Parse(dataContent);
                        if (dataJson is JsonArray arr && arr.Count > 0)
                        {
                            // The output is typically the first element, which is an object with a "url" key
                            var firstOutput = arr[0];
                            if (firstOutput is JsonObject outputObj)
                            {
                                outputUrl = outputObj["url"]?.GetValue<string>();
                            }
                            else if (firstOutput is JsonValue outputVal)
                            {
                                // Could be a direct URL string
                                var strVal = outputVal.GetValue<string>();
                                if (strVal.StartsWith("http"))
                                    outputUrl = strVal;
                            }
                        }
                    }
                    catch { /* not JSON data, skip */ }
                }
            }

            if (string.IsNullOrWhiteSpace(outputUrl))
                throw new InvalidOperationException("Gradio generation did not return an output image URL.");

            // 5. Download the output image
            progress?.Report((95, "Downloading output image..."));
            using var imageResponse = await client.GetAsync(outputUrl, cancellationToken);
            if (!imageResponse.IsSuccessStatusCode)
                throw new InvalidOperationException($"Failed to download Gradio output image: {imageResponse.StatusCode}");

            var imageBytes = await imageResponse.Content.ReadAsByteArrayAsync(cancellationToken);
            progress?.Report((100, "Done."));

            return new ImageGenerationResult { ImageBytes = imageBytes };
        }

        /// <summary>
        /// Upload a file to Gradio via POST /gradio_api/upload (multipart/form-data).
        /// Returns the server-side file path.
        /// </summary>
        async Task<string> UploadFileAsync(
            HttpClient client, string endpoint, byte[] fileBytes, string filename, CancellationToken ct)
        {
            using var formContent = new MultipartFormDataContent();
            var fileContent = new ByteArrayContent(fileBytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            formContent.Add(fileContent, "files", filename);

            var uploadUrl = $"{endpoint}/gradio_api/upload";
            using var response = await client.PostAsync(uploadUrl, formContent, ct);
            var responseContent = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"Gradio upload failed: {response.StatusCode} - {responseContent}");

            // Response is a JSON array of file paths, e.g. ["/tmp/gradio/xxx/depth_map.png"]
            var paths = JsonNode.Parse(responseContent) as JsonArray;
            if (paths == null || paths.Count == 0)
                throw new InvalidOperationException("Gradio upload did not return file paths.");

            return paths[0]?.GetValue<string>()
                ?? throw new InvalidOperationException("Gradio upload returned an empty file path.");
        }

        /// <summary>
        /// Extract the API name from the endpoint URL.
        /// e.g. "/gradio_api/call/v2/generate_reference_depth" → "generate_reference_depth"
        /// The SSE stream URL uses /gradio_api/call/{api_name}/{event_id}
        /// </summary>
        static string ExtractApiName(string endpointUrl)
        {
            // Remove leading slash and split by /
            var segments = endpointUrl.TrimStart('/').Split('/');
            // Expected: ["gradio_api", "call", "v2", "generate_reference_depth"]
            // or:       ["gradio_api", "call", "generate_reference_depth"]
            // The API name is always the last segment
            return segments[^1];
        }
    }

    /// <summary>
    /// Token calculator for Gradio models. Uses cost-per-megapixel pricing like ComfyUI.
    /// </summary>
    public class ImageTokensForGradio : IImageTokens
    {
        readonly ImageGenerationModel _model;

        public ImageTokensForGradio(ImageGenerationModel model)
        {
            _model = model;
        }

        public TokenCalculationResult CalculateTokens(
            string prompt, int width, int height, string quality,
            IReadOnlyList<(int width, int height)> inputImages = null,
            string inputDetail = "auto", decimal tokenCost = 0.01m)
        {
            var megapixels = (width * height) / (1024m * 1024m);
            var costPerMP = megapixels <= 1 ? _model.CP1K
                : megapixels <= 4 ? _model.CP2K
                : megapixels <= 16 ? _model.CP4K
                : _model.CP8K;

            var totalCost = megapixels * costPerMP;
            var tokens = Math.Max(1, (int)Math.Round(totalCost / tokenCost));

            return new TokenCalculationResult
            {
                EstimatedCostUSD = totalCost,
                PlatformTokens = tokens
            };
        }
    }
}
