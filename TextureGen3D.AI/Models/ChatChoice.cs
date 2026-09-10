using System.Text.Json.Serialization;

namespace TextureGen3D.AI.Models
{
    public class ChatChoice
    {
        [JsonPropertyName("message")]
        public ChatMessage Message { get; set; } = new ChatMessage();
    }
}
