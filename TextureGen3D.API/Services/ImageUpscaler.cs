using System.Net.Http.Headers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace TextureGen3D.API.Services;

public interface IImageUpscaler
{
    Task<byte[]> UpscaleAsync(byte[] imageBytes, int scale = 2);
}

public class ImageUpscaler : IImageUpscaler
{
    readonly IHttpClientFactory _httpClientFactory;
    readonly UpscalerOptions _options;
    readonly ILogger<ImageUpscaler> _logger;

    public ImageUpscaler(IHttpClientFactory httpClientFactory, IOptions<UpscalerOptions> options, ILogger<ImageUpscaler> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<byte[]> UpscaleAsync(byte[] imageBytes, int scale = 2)
    {
        if (imageBytes == null || imageBytes.Length == 0)
            throw new ArgumentException("Image bytes are required for upscaling.", nameof(imageBytes));

        var endpoint = _options.Endpoint.TrimEnd('/');
        var upscaleUrl = $"{endpoint}/upscale?scale={scale}";

        _logger.LogInformation("Sending {Bytes} bytes to upscaler service at {Url} (scale={Scale})", imageBytes.Length, upscaleUrl, scale);

        using var client = _httpClientFactory.CreateClient("Upscaler");
        using var content = new ByteArrayContent(imageBytes);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");

        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
        var response = await client.PostAsync(upscaleUrl, content, cts.Token);

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync(cts.Token);
            throw new InvalidOperationException($"Upscaler service failed: {response.StatusCode} - {errorContent}");
        }

        var resultBytes = await response.Content.ReadAsByteArrayAsync(cts.Token);
        if (resultBytes.Length == 0)
            throw new InvalidOperationException("Upscaler service returned empty image data.");

        _logger.LogInformation("Received {Bytes} bytes from upscaler service", resultBytes.Length);

        return resultBytes;
    }
}
