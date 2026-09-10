using System.Text.Json.Serialization;

namespace TextureGen3D.AI.Models
{
    public class ChatMessage
    {
        [JsonPropertyName("role")]
        public string Role { get; set; } = "";

        [JsonPropertyName("content")]
        public string Content { get; set; } = "";
    }
}
