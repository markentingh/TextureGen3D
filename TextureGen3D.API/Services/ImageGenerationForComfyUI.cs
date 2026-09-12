using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using TextureGen3D.Data.Entities;

namespace TextureGen3D.API.Services
{
    public class ImageGenerationForComfyUI : IImageGeneration
    {
        readonly IHttpClientFactory _httpClientFactory;
        readonly ImageGenerationOptions _options;

        public string ModelKey => "comfyui";

        public IImageTokens CreateTokenizer(ImageGenerationModel model)
        {
            return new ImageTokensForComfyUI(model);
        }

        public ImageGenerationForComfyUI(IHttpClientFactory httpClientFactory, IOptions<ImageGenerationOptions> options)
        {
            _httpClientFactory = httpClientFactory;
            _options = options.Value;
        }

        public async Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request)
        {
            throw new NotSupportedException("ComfyUI generation requires progress tracking. Use GenerateWithProgressAsync via the SignalR hub.");
        }

        /// <summary>
        /// Full ComfyUI generation flow with progress reporting.
        /// Called from the ComfyUiHub.
        /// </summary>
        public async Task<ImageGenerationResult> GenerateWithProgressAsync(
            ImageGenerationRequest request,
            string workflowJson,
            string promptPath,
            string depthMapPath,
            string inputImagesPath,
            IProgress<(int value, string? message)>? progress = null,
            CancellationToken cancellationToken = default)
        {
            if (!_options.Models.TryGetValue("comfyui", out var config))
                throw new InvalidOperationException("ComfyUI image model is not configured.");

            var endpoint = config.Endpoint.TrimEnd('/');
            var apiKey = config.ApiKey;

            using var client = _httpClientFactory.CreateClient("ImageGeneration");
            // ComfyUI timeout is long for complex workflows
            client.Timeout = TimeSpan.FromMinutes(10);

            // Parse the workflow JSON
            var workflow = JsonNode.Parse(workflowJson) as JsonObject
                ?? throw new InvalidOperationException("Invalid workflow JSON.");

            // 1. Inject the prompt into the workflow
            if (!string.IsNullOrWhiteSpace(promptPath))
                SetWorkflowValue(workflow, promptPath, request.Prompt);

            // 2. Upload the depth map (first input image) and inject its path
            if (!string.IsNullOrWhiteSpace(depthMapPath) && request.InputImages != null && request.InputImages.Count > 0)
            {
                var depthBytes = request.InputImages[0];
                var uploaded = await UploadImageAsync(client, endpoint, apiKey, depthBytes, "depthmap.png", cancellationToken);
                var depthValue = $"{uploaded.Subfolder}/{uploaded.Name}";
                SetWorkflowValue(workflow, depthMapPath, depthValue);
            }

            // 3. Upload reference images (remaining input images) and inject their paths
            if (!string.IsNullOrWhiteSpace(inputImagesPath) && request.InputImages != null && request.InputImages.Count > 1)
            {
                var refImages = request.InputImages.Skip(1).ToList();
                var uploadedPaths = new List<string>();
                for (var i = 0; i < refImages.Count; i++)
                {
                    var uploaded = await UploadImageAsync(client, endpoint, apiKey, refImages[i], $"reference_{i}.png", cancellationToken);
                    uploadedPaths.Add($"{uploaded.Subfolder}/{uploaded.Name}");
                }
                SetWorkflowArrayValue(workflow, inputImagesPath, uploadedPaths);
            }

            // 4. Queue the prompt via /prompt API
            progress?.Report((5, "Queuing workflow..."));
            var promptId = await QueuePromptAsync(client, endpoint, apiKey, workflow, cancellationToken);

            // 5. Listen for progress via WebSocket
            await ListenForProgressAsync(endpoint, apiKey, promptId, progress, cancellationToken);

            // 6. Fetch the output image via /view endpoint
            progress?.Report((100, "Downloading output image..."));
            var imageBytes = await FetchOutputImageAsync(client, endpoint, apiKey, promptId, cancellationToken);

            return new ImageGenerationResult { ImageBytes = imageBytes };
        }

        /// <summary>
        /// Upload an image to ComfyUI via /upload/image.
        /// Returns the name and subfolder from the response.
        /// </summary>
        async Task<(string Name, string Subfolder)> UploadImageAsync(
            HttpClient client, string endpoint, string apiKey, byte[] imageBytes, string filename, CancellationToken ct)
        {
            using var formContent = new MultipartFormDataContent();
            var imageContent = new ByteArrayContent(imageBytes);
            imageContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            formContent.Add(imageContent, "image", filename);
            formContent.Add(new StringContent("input"), "type");
            formContent.Add(new StringContent("true"), "overwrite");

            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, $"{endpoint}/upload/image")
            {
                Content = formContent
            };
            if (!string.IsNullOrWhiteSpace(apiKey))
                httpRequest.Headers.Add("X-API-Key", apiKey);

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromMinutes(2));
            var response = await client.SendAsync(httpRequest, cts.Token);
            var responseContent = await response.Content.ReadAsStringAsync(cts.Token);

            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"ComfyUI upload failed: {response.StatusCode} - {responseContent}");

            var uploadResponse = JsonNode.Parse(responseContent) as JsonObject
                ?? throw new InvalidOperationException("Failed to parse ComfyUI upload response.");

            var name = uploadResponse["name"]?.GetValue<string>() ?? "";
            var subfolder = uploadResponse["subfolder"]?.GetValue<string>() ?? "";
            return (name, subfolder);
        }

        /// <summary>
        /// Queue a prompt via POST /prompt.
        /// Returns the prompt_id from the response.
        /// </summary>
        async Task<string> QueuePromptAsync(
            HttpClient client, string endpoint, string apiKey, JsonObject workflow, CancellationToken ct)
        {
            var payload = new JsonObject
            {
                ["prompt"] = workflow,
                ["client_id"] = Guid.NewGuid().ToString("N")
            };

            var jsonContent = JsonSerializer.Serialize(payload);
            using var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");
            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, $"{endpoint}/prompt") { Content = content };
            if (!string.IsNullOrWhiteSpace(apiKey))
                httpRequest.Headers.Add("X-API-Key", apiKey);

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromMinutes(2));
            var response = await client.SendAsync(httpRequest, cts.Token);
            var responseContent = await response.Content.ReadAsStringAsync(cts.Token);

            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"ComfyUI /prompt failed: {response.StatusCode} - {responseContent}");

            var promptResponse = JsonNode.Parse(responseContent) as JsonObject
                ?? throw new InvalidOperationException("Failed to parse ComfyUI /prompt response.");

            return promptResponse["prompt_id"]?.GetValue<string>()
                ?? throw new InvalidOperationException("ComfyUI /prompt did not return a prompt_id.");
        }

        /// <summary>
        /// Connect to the ComfyUI WebSocket and listen for progress messages
        /// for the given prompt_id. Reports progress updates.
        /// </summary>
        async Task ListenForProgressAsync(
            string endpoint, string apiKey, string promptId,
            IProgress<(int value, string? message)>? progress, CancellationToken ct)
        {
            // Convert HTTP endpoint to WebSocket URL
            var wsBase = endpoint
                .Replace("https://", "wss://")
                .Replace("http://", "ws://")
                .Replace("/api", "/ws");

            var wsUrl = $"{wsBase}?clientId={Guid.NewGuid():N}";

            using var ws = new ClientWebSocket();
            if (!string.IsNullOrWhiteSpace(apiKey))
                ws.Options.SetRequestHeader("X-API-Key", apiKey);

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromMinutes(10));

            await ws.ConnectAsync(new Uri(wsUrl), cts.Token);

            var buffer = new byte[65536];
            var completed = false;

            while (!completed && !cts.Token.IsCancellationRequested)
            {
                WebSocketReceiveResult result;
                using var ms = new MemoryStream();
                do
                {
                    result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token);
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                var json = Encoding.UTF8.GetString(ms.ToArray());
                var msg = JsonNode.Parse(json) as JsonObject;
                if (msg == null) continue;

                var type = msg["type"]?.GetValue<string>();

                if (type == "progress")
                {
                    var data = msg["data"] as JsonObject;
                    var value = data?["value"]?.GetValue<int>() ?? 0;
                    var max = data?["max"]?.GetValue<int>() ?? 1;
                    var pct = max > 0 ? (int)((double)value / max * 95) : 0;
                    progress?.Report((5 + pct, $"Generating: {value}/{max} steps"));
                }
                else if (type == "executing")
                {
                    var data = msg["data"] as JsonObject;
                    var nodeId = data?["node"]?.GetValue<string>();
                    if (nodeId == null)
                    {
                        // Execution complete
                        completed = true;
                        progress?.Report((99, "Generation complete"));
                    }
                }
                else if (type == "execution_error")
                {
                    var data = msg["data"] as JsonObject;
                    var errorMsg = data?["exception_message"]?.GetValue<string>() ?? "Unknown error";
                    throw new InvalidOperationException($"ComfyUI execution error: {errorMsg}");
                }
                else if (type == "execution_interrupted")
                {
                    throw new InvalidOperationException("ComfyUI execution was interrupted.");
                }
            }

            if (ws.State == WebSocketState.Open)
            {
                try
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Done", CancellationToken.None);
                }
                catch { /* ignore close errors */ }
            }
        }

        /// <summary>
        /// Fetch the output image from ComfyUI via GET /view.
        /// We need to find the output filename from the history endpoint.
        /// </summary>
        async Task<byte[]> FetchOutputImageAsync(
            HttpClient client, string endpoint, string apiKey, string promptId, CancellationToken ct)
        {
            // First, get the history to find the output filename
            using var historyRequest = new HttpRequestMessage(HttpMethod.Get, $"{endpoint}/history/{promptId}");
            if (!string.IsNullOrWhiteSpace(apiKey))
                historyRequest.Headers.Add("X-API-Key", apiKey);

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromMinutes(2));
            var historyResponse = await client.SendAsync(historyRequest, cts.Token);
            var historyContent = await historyResponse.Content.ReadAsStringAsync(cts.Token);

            if (!historyResponse.IsSuccessStatusCode)
                throw new InvalidOperationException($"ComfyUI /history failed: {historyResponse.StatusCode} - {historyContent}");

            var history = JsonNode.Parse(historyContent) as JsonObject;
            var promptHistory = history?[promptId] as JsonObject;
            var outputs = promptHistory?["outputs"] as JsonObject;
            if (outputs == null)
                throw new InvalidOperationException("No outputs found in ComfyUI history.");

            string? filename = null;
            string? subfolder = null;
            string? type = null;

            foreach (var node in outputs)
            {
                var nodeOutputs = node.Value as JsonObject;
                var images = nodeOutputs?["images"] as JsonArray;
                if (images != null && images.Count > 0)
                {
                    var firstImage = images[0] as JsonObject;
                    filename = firstImage?["filename"]?.GetValue<string>();
                    subfolder = firstImage?["subfolder"]?.GetValue<string>();
                    type = firstImage?["type"]?.GetValue<string>();
                    break;
                }
            }

            if (string.IsNullOrWhiteSpace(filename))
                throw new InvalidOperationException("No output image found in ComfyUI history.");

            // Now fetch the image via /view
            var viewUrl = $"{endpoint}/view?filename={Uri.EscapeDataString(filename)}";
            if (!string.IsNullOrWhiteSpace(subfolder))
                viewUrl += $"&subfolder={Uri.EscapeDataString(subfolder)}";
            if (!string.IsNullOrWhiteSpace(type))
                viewUrl += $"&type={Uri.EscapeDataString(type)}";

            using var viewRequest = new HttpRequestMessage(HttpMethod.Get, viewUrl);
            if (!string.IsNullOrWhiteSpace(apiKey))
                viewRequest.Headers.Add("X-API-Key", apiKey);

            var viewResponse = await client.SendAsync(viewRequest, cts.Token);
            if (!viewResponse.IsSuccessStatusCode)
                throw new InvalidOperationException($"ComfyUI /view failed: {viewResponse.StatusCode}");

            return await viewResponse.Content.ReadAsByteArrayAsync(cts.Token);
        }

        /// <summary>
        /// Parse a path like "87"."inputs"."image" and set the value at that location
        /// in the workflow JSON object.
        /// </summary>
        static void SetWorkflowValue(JsonObject workflow, string path, string value)
        {
            var segments = ParsePathSegments(path);
            if (segments.Count == 0) return;

            JsonNode current = workflow;
            for (var i = 0; i < segments.Count - 1; i++)
            {
                current = current[segments[i]];
                if (current == null) return;
            }

            current[segments[^1]] = value;
        }

        /// <summary>
        /// Parse a path like "87"."inputs"."image" and set an array of values at that location.
        /// If the target is an array, duplicate the first item's structure for each value.
        /// </summary>
        static void SetWorkflowArrayValue(JsonObject workflow, string path, List<string> values)
        {
            var segments = ParsePathSegments(path);
            if (segments.Count == 0) return;

            JsonNode current = workflow;
            for (var i = 0; i < segments.Count - 1; i++)
            {
                current = current[segments[i]];
                if (current == null) return;
            }

            var lastKey = segments[^1];
            var existing = current[lastKey];

            if (existing is JsonArray existingArray)
            {
                // Duplicate the first item's structure for each value
                if (existingArray.Count == 0)
                {
                    // Empty array — just set values directly
                    var newArr = new JsonArray();
                    foreach (var v in values)
                        newArr.Add(v);
                    current[lastKey] = newArr;
                    return;
                }

                var firstItem = existingArray[0]?.DeepClone();
                if (firstItem is JsonObject firstObj)
                {
                    // Find the "image" key (or similar) in the first item and use it as template
                    var template = firstObj.DeepClone() as JsonObject;
                    var newArr = new JsonArray();
                    foreach (var v in values)
                    {
                        var item = template!.DeepClone() as JsonObject;
                        // Set the image field — find the first string field that looks like an image path
                        var imageKey = item!.FirstOrDefault(kvp => kvp.Value is JsonValue && kvp.Value?.GetValue<string>().Contains('/') == true).Key;
                        if (imageKey != null)
                            item[imageKey] = v;
                        else
                        {
                            // If no existing image-like field, set the first string value
                            var firstStringKey = item.FirstOrDefault(kvp => kvp.Value is JsonValue).Key;
                            if (firstStringKey != null)
                                item[firstStringKey] = v;
                        }
                        newArr.Add(item);
                    }
                    current[lastKey] = newArr;
                }
                else
                {
                    // First item is a simple value — replace each
                    var newArr = new JsonArray();
                    foreach (var v in values)
                        newArr.Add(v);
                    current[lastKey] = newArr;
                }
            }
            else
            {
                // Not an array — if we have multiple values, use the first
                current[lastKey] = values.Count > 0 ? values[0] : "";
            }
        }

        /// <summary>
        /// Parse a path string like "87"."inputs"."image" into a list of segment keys.
        /// Handles both quoted and unquoted segments separated by dots.
        /// </summary>
        static List<string> ParsePathSegments(string path)
        {
            var segments = new List<string>();
            // Match quoted segments: "87"."inputs"."image"
            var matches = System.Text.RegularExpressions.Regex.Matches(path, @"\""(.*?)\""");
            if (matches.Count > 0)
            {
                foreach (System.Text.RegularExpressions.Match m in matches)
                    segments.Add(m.Groups[1].Value);
            }
            else
            {
                // Fallback: split by dots
                foreach (var seg in path.Split('.'))
                {
                    var s = seg.Trim().Trim('"');
                    if (!string.IsNullOrEmpty(s))
                        segments.Add(s);
                }
            }
            return segments;
        }
    }

    /// <summary>
    /// Token calculator for ComfyUI models. ComfyUI uses cost-per-megapixel pricing.
    /// </summary>
    public class ImageTokensForComfyUI : IImageTokens
    {
        readonly ImageGenerationModel _model;

        public ImageTokensForComfyUI(ImageGenerationModel model)
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
