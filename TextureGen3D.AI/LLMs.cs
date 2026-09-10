using TextureGen3D.AI.Models;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TextureGen3D.AI
{
    public static class OpenAI
    {
        public static int PreferredModel { get; set; }

        public static Dictionary<int, LLMInfo> Available { get; set; } = new Dictionary<int, LLMInfo>();

        private static readonly HttpClient _httpClient = new HttpClient();

        public static void AddModel(LLMModel model)
        {
            if (model == null) return;
            Available[model.ModelId] = new LLMInfo
            {
                Model = model.Model,
                Endpoint = model.Endpoint,
                PrivateKey = model.PrivateKey,
                ExtraBody = model.ExtraBody
            };
        }

        public static void UpdateModel(LLMModel model)
        {
            AddModel(model);
        }

        public static void RemoveModel(int modelId)
        {
            if (Available.ContainsKey(modelId))
            {
                Available.Remove(modelId);
                if (PreferredModel == modelId)
                {
                    PreferredModel = Available.Keys.FirstOrDefault();
                }
            }
        }

        public static async Task<string> Prompt(string system, string assistant, string user, int modelId = 0, double temperature = 0.6, long? seed = null)
        {
            var preferredModelId = modelId > 0 ? modelId : PreferredModel > 0 ? PreferredModel : 0;
            if (preferredModelId == 0 || !Available.TryGetValue(preferredModelId, out var myLLM))
            {
                throw new Exception("No preferred LLM configured");
            }

            if (string.IsNullOrEmpty(myLLM.PrivateKey))
            {
                throw new Exception("LLM private key is missing");
            }

            var messages = new List<ChatMessage>();

            if (!string.IsNullOrEmpty(system))
            {
                messages.Add(new ChatMessage { Role = "system", Content = system });
            }

            if (!string.IsNullOrEmpty(assistant))
            {
                messages.Add(new ChatMessage { Role = "assistant", Content = assistant });
            }

            messages.Add(new ChatMessage { Role = "user", Content = user });

            var requestBody = new ChatCompletionRequest
            {
                Model = myLLM.Model,
                Messages = messages,
                Temperature = temperature,
                Seed = seed
            };

            if (myLLM.ExtraBody?.Count > 0)
            {
                requestBody.ExtraBody = myLLM.ExtraBody;
            }

            var jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            };

            var jsonContent = JsonSerializer.Serialize(requestBody, jsonOptions);
            var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

            var request = new HttpRequestMessage(HttpMethod.Post, $"{myLLM.Endpoint.TrimEnd('/')}/chat/completions");
            request.Content = content;
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", myLLM.PrivateKey);

            var response = await _httpClient.SendAsync(request);
            var responseContent = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"LLM API request failed: {response.StatusCode} - {responseContent}");
            }

            var completionResponse = JsonSerializer.Deserialize<ChatCompletionResponse>(responseContent, jsonOptions);

            if (completionResponse?.Choices == null || completionResponse.Choices.Count == 0)
            {
                throw new Exception("No response from LLM");
            }

            return completionResponse.Choices[0].Message.Content;
        }
    }
}
