using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace TextureGen3D.AI.Models
{
    public class ChatCompletionRequest
    {
        [JsonPropertyName("model")]
        public string Model { get; set; } = "";

        [JsonPropertyName("messages")]
        public List<ChatMessage> Messages { get; set; } = new List<ChatMessage>();

        [JsonPropertyName("temperature")]
        public double Temperature { get; set; }

        [JsonPropertyName("seed")]
        public long? Seed { get; set; }

        [JsonPropertyName("extra_body")]
        public Dictionary<string, object> ExtraBody { get; set; } = new Dictionary<string, object>();
    }
}
