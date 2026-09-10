using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using TextureGen3D.API.Models.Projects;
using TextureGen3D.Data.Entities;

namespace TextureGen3D.API.Services
{
    public class ImageGenerationForOpenAI : IImageGeneration
    {
        readonly IHttpClientFactory _httpClientFactory;
        readonly ImageGenerationOptions _options;
        readonly IImageService _imageService;

        public string ModelKey => "openai";

        public IImageTokens CreateTokenizer(ImageGenerationModel model)
        {
            return new ImageTokensForOpenAI(model.CPMITTokens, model.CPMIITokens, model.CPMOTokens);
        }

        public ImageGenerationForOpenAI(IHttpClientFactory httpClientFactory, IOptions<ImageGenerationOptions> options, IImageService imageService)
        {
            _httpClientFactory = httpClientFactory;
            _options = options.Value;
            _imageService = imageService;
        }

        public async Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.Prompt))
                throw new ArgumentException("Prompt is required.", nameof(request));

            if (request.InputImages != null && request.InputImages.Count > 0)
            {
                var resized = new List<byte[]>(request.InputImages.Count);
                foreach (var img in request.InputImages)
                    resized.Add(await _imageService.ResizeImageMaxAsync(img, 1024));
                request.InputImages = resized;
            }

            if (request.UseResponsesApi)
                return await GenerateViaResponsesApiAsync(request);

            if (request.InputImages != null && request.InputImages.Count > 0)
                return await GenerateViaImageEditApiAsync(request);

            return await GenerateViaImageApiAsync(request);
        }

        async Task<ImageGenerationResult> GenerateViaImageApiAsync(ImageGenerationRequest request)
        {
            if (!_options.Models.TryGetValue("openai", out var config))
                throw new InvalidOperationException("OpenAI image model is not configured.");

            if (string.IsNullOrWhiteSpace(config.ApiKey))
                throw new InvalidOperationException("OpenAI API key is missing.");

            var model = string.IsNullOrWhiteSpace(request.Model) ? "gpt-image-2" : request.Model;
            var size = !string.IsNullOrWhiteSpace(request.CustomSize) ? request.CustomSize : $"{request.Width}x{request.Height}";
            var quality = string.IsNullOrWhiteSpace(request.Quality) ? "medium" : request.Quality;

            var images = new List<OpenAIImageReference>();
            if (request.InputImages != null && request.InputImages.Count > 0)
            {
                foreach (var img in request.InputImages)
                {
                    if (img != null && img.Length > 0)
                    {
                        images.Add(new OpenAIImageReference { ImageUrl = GetImageDataUrl(img) });
                    }
                }
            }

            var jsonOptions = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            };

            var imageApiRequest = new OpenAIImageRequest
            {
                Model = model,
                Prompt = request.Prompt,
                N = 1,
                Size = size,
                Quality = quality,
                Images = images.Count > 0 ? images : null
            };

            var jsonContent = JsonSerializer.Serialize(imageApiRequest, jsonOptions);
            var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

            using var client = _httpClientFactory.CreateClient("ImageGeneration");
            var httpRequest = new HttpRequestMessage(HttpMethod.Post, config.ImageEndpoint) { Content = content };
            httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiKey);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(_options.TimeoutSeconds));
            var response = await client.SendAsync(httpRequest, cts.Token);
            var responseContent = await response.Content.ReadAsStringAsync(cts.Token);

            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"Image generation failed: {response.StatusCode} - {responseContent}");

            var generationResponse = JsonSerializer.Deserialize<OpenAIImageResponse>(responseContent, jsonOptions);
            if (generationResponse?.Data == null || generationResponse.Data.Count == 0)
                throw new InvalidOperationException("No image returned from generation API.");

            var first = generationResponse.Data[0];
            byte[]? imageBytes = null;

            if (!string.IsNullOrWhiteSpace(first.B64Json))
                imageBytes = Convert.FromBase64String(first.B64Json);
            else if (!string.IsNullOrWhiteSpace(first.Url))
            {
                using var imageResponse = await client.GetAsync(first.Url, cts.Token);
                if (!imageResponse.IsSuccessStatusCode)
                    throw new InvalidOperationException($"Failed to download generated image: {imageResponse.StatusCode}");
                imageBytes = await imageResponse.Content.ReadAsByteArrayAsync(cts.Token);
            }

            if (imageBytes == null || imageBytes.Length == 0)
                throw new InvalidOperationException("Generated image did not contain a URL or base64 data.");

            return new ImageGenerationResult { ImageBytes = imageBytes };
        }

        async Task<ImageGenerationResult> GenerateViaImageEditApiAsync(ImageGenerationRequest request)
        {
            if (!_options.Models.TryGetValue("openai", out var config))
                throw new InvalidOperationException("OpenAI image model is not configured.");

            if (string.IsNullOrWhiteSpace(config.ApiKey))
                throw new InvalidOperationException("OpenAI API key is missing.");

            var model = string.IsNullOrWhiteSpace(request.Model) ? "gpt-image-2" : request.Model;
            var size = !string.IsNullOrWhiteSpace(request.CustomSize) ? request.CustomSize : $"{request.Width}x{request.Height}";
            var quality = string.IsNullOrWhiteSpace(request.Quality) ? "medium" : request.Quality;

            var jsonOptions = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            };

            using var client = _httpClientFactory.CreateClient("ImageGeneration");
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(_options.TimeoutSeconds));

            HttpResponseMessage response;

            if (request.InputMask != null && request.InputMask.Length > 0 && request.InputImages.Count > 0)
            {
                using var formContent = new MultipartFormDataContent();
                formContent.Add(new StringContent(model), "model");
                formContent.Add(new StringContent(request.Prompt), "prompt");
                formContent.Add(new StringContent("1"), "n");
                formContent.Add(new StringContent(size), "size");
                formContent.Add(new StringContent(quality), "quality");

                var baseImage = request.InputImages[0];
                var imageContent = new ByteArrayContent(baseImage);
                imageContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
                formContent.Add(imageContent, "image", "image.png");

                var maskContent = new ByteArrayContent(request.InputMask);
                maskContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
                formContent.Add(maskContent, "mask", "mask.png");

                for (var i = 1; i < request.InputImages.Count; i++)
                {
                    var extraImg = request.InputImages[i];
                    if (extraImg == null || extraImg.Length == 0) continue;
                    var extraContent = new ByteArrayContent(extraImg);
                    extraContent.Headers.ContentType = new MediaTypeHeaderValue("image/png");
                    formContent.Add(extraContent, "image[]", $"image_{i}.png");
                }

                using var maskRequest = new HttpRequestMessage(HttpMethod.Post, config.ImageEditEndpoint) { Content = formContent };
                maskRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiKey);
                response = await client.SendAsync(maskRequest, cts.Token);
            }
            else
            {
                var images = new List<OpenAIImageReference>();
                for (var i = 0; i < request.InputImages.Count; i++)
                {
                    var img = request.InputImages[i];
                    if (img != null && img.Length > 0)
                    {
                        images.Add(new OpenAIImageReference { ImageUrl = GetImageDataUrl(img) });
                    }
                }

                var imageEditRequest = new OpenAIImageRequest
                {
                    Model = model,
                    Prompt = request.Prompt,
                    N = 1,
                    Size = size,
                    Quality = quality,
                    Images = images
                };

                var jsonContent = JsonSerializer.Serialize(imageEditRequest, jsonOptions);
                var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

                using var httpRequest = new HttpRequestMessage(HttpMethod.Post, config.ImageEditEndpoint) { Content = content };
                httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiKey);
                response = await client.SendAsync(httpRequest, cts.Token);
            }

            var responseContent = await response.Content.ReadAsStringAsync(cts.Token);

            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"Image edit failed: {response.StatusCode} - {responseContent}");

            var generationResponse = JsonSerializer.Deserialize<OpenAIImageResponse>(responseContent, jsonOptions);
            if (generationResponse?.Data == null || generationResponse.Data.Count == 0)
                throw new InvalidOperationException("No image returned from edit API.");

            var first = generationResponse.Data[0];
            byte[]? imageBytes = null;

            if (!string.IsNullOrWhiteSpace(first.B64Json))
                imageBytes = Convert.FromBase64String(first.B64Json);
            else if (!string.IsNullOrWhiteSpace(first.Url))
            {
                using var imageResponse = await client.GetAsync(first.Url, cts.Token);
                if (!imageResponse.IsSuccessStatusCode)
                    throw new InvalidOperationException($"Failed to download generated image: {imageResponse.StatusCode}");
                imageBytes = await imageResponse.Content.ReadAsByteArrayAsync(cts.Token);
            }

            if (imageBytes == null || imageBytes.Length == 0)
                throw new InvalidOperationException("Generated image did not contain a URL or base64 data.");

            return new ImageGenerationResult { ImageBytes = imageBytes };
        }

        async Task<ImageGenerationResult> GenerateViaResponsesApiAsync(ImageGenerationRequest request)
        {
            if (!_options.Models.TryGetValue("openai", out var config))
                throw new InvalidOperationException("OpenAI image model is not configured.");

            if (string.IsNullOrWhiteSpace(config.ApiKey))
                throw new InvalidOperationException("OpenAI API key is missing.");

            var imageModel = string.IsNullOrWhiteSpace(request.Model) ? "gpt-image-2" : request.Model;
            var toolSize = !string.IsNullOrWhiteSpace(request.CustomSize) ? request.CustomSize : $"{request.Width}x{request.Height}";
            var toolQuality = string.IsNullOrWhiteSpace(request.Quality) ? "medium" : request.Quality;

            var jsonOptions = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            };

            var responsesRequest = new OpenAIResponsesRequest
            {
                Model = "gpt-4o",
                Tools = new List<OpenAITool>
                {
                    new() { Type = "image_generation", Model = imageModel, Size = toolSize, Quality = toolQuality }
                },
                ToolChoice = "auto"
            };

            if (!string.IsNullOrWhiteSpace(request.PreviousResponseId))
                responsesRequest.PreviousResponseId = request.PreviousResponseId;

            var contentItems = new List<OpenAIInputContent> { new() { Type = "input_text", Text = request.Prompt } };

            if (request.InputImages != null && request.InputImages.Count > 0)
            {
                foreach (var imgBytes in request.InputImages)
                {
                    if (imgBytes != null && imgBytes.Length > 0)
                    {
                        contentItems.Add(new OpenAIInputContent
                        {
                            Type = "input_image",
                            ImageUrl = GetImageDataUrl(imgBytes),
                            Detail = "auto"
                        });
                    }
                }
            }

            responsesRequest.Input = new List<OpenAIInputMessage> { new() { Role = "user", Content = contentItems } };

            var jsonContent = JsonSerializer.Serialize(responsesRequest, jsonOptions);
            var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

            using var client = _httpClientFactory.CreateClient("ImageGeneration");
            var httpRequest = new HttpRequestMessage(HttpMethod.Post, config.Endpoint) { Content = content };
            httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiKey);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(_options.TimeoutSeconds));
            var response = await client.SendAsync(httpRequest, cts.Token);
            var responseContent = await response.Content.ReadAsStringAsync(cts.Token);

            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"Image generation failed: {response.StatusCode} - {responseContent}");

            var genResponse = JsonSerializer.Deserialize<OpenAIResponsesResponse>(responseContent, jsonOptions);
            if (genResponse == null)
                throw new InvalidOperationException("Failed to parse Responses API output.");

            byte[]? imageBytes = null;
            if (genResponse.Output != null)
            {
                foreach (var output in genResponse.Output)
                {
                    if (output.Type == "image_generation_call" && !string.IsNullOrWhiteSpace(output.Result))
                    {
                        imageBytes = Convert.FromBase64String(output.Result);
                        break;
                    }
                }
            }

            if (imageBytes == null || imageBytes.Length == 0)
                throw new InvalidOperationException("No image returned from generation API.");

            return new ImageGenerationResult
            {
                ImageBytes = imageBytes,
                ResponseId = genResponse.Id,
                InputTokens = genResponse.Usage?.InputTokens ?? 0,
                OutputTokens = genResponse.Usage?.OutputTokens ?? 0
            };
        }

        static string GetImageDataUrl(byte[] imageData)
        {
            if (imageData == null || imageData.Length == 0)
                return "";

            var format = Image.DetectFormat(imageData);
            var mime = format?.DefaultMimeType ?? "image/png";
            return $"data:{mime};base64,{Convert.ToBase64String(imageData)}";
        }
    }
}
