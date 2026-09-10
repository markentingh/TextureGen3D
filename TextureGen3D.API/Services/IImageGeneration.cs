using TextureGen3D.Data.Entities;

namespace TextureGen3D.API.Services
{
    public interface IImageGeneration
    {
        string ModelKey { get; }
        Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request);
        IImageTokens CreateTokenizer(ImageGenerationModel model);
    }

    public class ImageGenerationRequest
    {
        public string Prompt { get; set; } = "";
        public string Model { get; set; } = "";
        public int Width { get; set; } = 1024;
        public int Height { get; set; } = 1024;
        public string Quality { get; set; } = "medium";
        public string CustomSize { get; set; } = "";
        public List<byte[]>? InputImages { get; set; }
        public byte[]? InputMask { get; set; }
        public bool UseResponsesApi { get; set; }
        public string? PreviousResponseId { get; set; }
    }

    public class ImageGenerationResult
    {
        public byte[] ImageBytes { get; set; } = Array.Empty<byte>();
        public string? ResponseId { get; set; }
        public int InputTokens { get; set; }
        public int OutputTokens { get; set; }
    }
}
