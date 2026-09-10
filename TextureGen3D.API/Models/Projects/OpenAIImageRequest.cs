using System.Text.Json.Serialization;

namespace TextureGen3D.API.Models.Projects
{
    public class OpenAIImageRequest
    {
        [JsonPropertyName("model")]
        public string? Model { get; set; }

        [JsonPropertyName("prompt")]
        public string? Prompt { get; set; }

        [JsonPropertyName("n")]
        public int? N { get; set; }

        [JsonPropertyName("size")]
        public string? Size { get; set; }

        [JsonPropertyName("quality")]
        public string? Quality { get; set; }

        [JsonPropertyName("images")]
        public List<OpenAIImageReference>? Images { get; set; }

        [JsonIgnore]
        public byte[]? Mask { get; set; }
    }

    public class OpenAIResponsesRequest
    {
        [JsonPropertyName("model")]
        public string Model { get; set; } = "gpt-4o";

        [JsonPropertyName("previous_response_id")]
        public string? PreviousResponseId { get; set; }

        [JsonPropertyName("input")]
        public List<OpenAIInputMessage> Input { get; set; } = new();

        [JsonPropertyName("tools")]
        public List<OpenAITool> Tools { get; set; } = new();

        [JsonPropertyName("tool_choice")]
        public string? ToolChoice { get; set; }
    }

    public class OpenAITool
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "";

        [JsonPropertyName("model")]
        public string? Model { get; set; }

        [JsonPropertyName("size")]
        public string? Size { get; set; }

        [JsonPropertyName("quality")]
        public string? Quality { get; set; }

        [JsonPropertyName("action")]
        public string? Action { get; set; }
    }

    public class OpenAIInputMessage
    {
        [JsonPropertyName("role")]
        public string Role { get; set; } = "user";

        [JsonPropertyName("content")]
        public List<OpenAIInputContent> Content { get; set; } = new();
    }

    public class OpenAIInputContent
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "";

        [JsonPropertyName("text")]
        public string? Text { get; set; }

        [JsonPropertyName("image_url")]
        public string? ImageUrl { get; set; }

        [JsonPropertyName("detail")]
        public string? Detail { get; set; }
    }

    public class OpenAIImageReference
    {
        [JsonPropertyName("image_url")]
        public string? ImageUrl { get; set; }

        [JsonPropertyName("detail")]
        public string? Detail { get; set; }
    }

    public class OpenAIResponsesResponse
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }

        [JsonPropertyName("output")]
        public List<OpenAIResponsesOutput>? Output { get; set; }

        [JsonPropertyName("usage")]
        public OpenAIResponsesUsage? Usage { get; set; }
    }

    public class OpenAIResponsesOutput
    {
        [JsonPropertyName("type")]
        public string? Type { get; set; }

        [JsonPropertyName("result")]
        public string? Result { get; set; }
    }

    public class OpenAIResponsesUsage
    {
        [JsonPropertyName("total_tokens")]
        public int TotalTokens { get; set; }

        [JsonPropertyName("input_tokens")]
        public int InputTokens { get; set; }

        [JsonPropertyName("output_tokens")]
        public int OutputTokens { get; set; }
    }
}
