using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace TextureGen3D.AI.Models
{
    public class ChatCompletionResponse
    {
        [JsonPropertyName("choices")]
        public List<ChatChoice> Choices { get; set; } = new List<ChatChoice>();
    }
}
