using Microsoft.Extensions.Options;

namespace TextureGen3D.API.Services
{
    public class ImageGenerationOptions
    {
        public int TimeoutSeconds { get; set; } = 300;
        public Dictionary<string, ImageModelConfig> Models { get; set; } = new();
    }

    public class ImageModelConfig
    {
        public string ApiKey { get; set; } = "";
        public string Endpoint { get; set; } = "https://api.openai.com/v1/responses";
        public string ImageEndpoint { get; set; } = "https://api.openai.com/v1/images/generations";
        public string ImageEditEndpoint { get; set; } = "https://api.openai.com/v1/images/edits";
    }

    public class TokenCostOptions
    {
        public decimal Cost { get; set; } = 0.01m;
    }

    public class UpscalerOptions
    {
        public string Endpoint { get; set; } = "http://localhost:7725";
    }
}
