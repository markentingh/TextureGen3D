using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/llms")]
    [Authorize]
    public class LLMsController : ApiController
    {
        [HttpGet("available")]
        public IActionResult GetAvailableLLMs()
        {
            try
            {
                var llms = AI.OpenAI.Available.Select(kvp => new
                {
                    key = kvp.Key.ToString(),
                    model = kvp.Value.Model,
                    endpoint = kvp.Value.Endpoint,
                    hasKey = !string.IsNullOrEmpty(kvp.Value.PrivateKey)
                }).Where(llm => llm.hasKey).ToList();

                return Json(new ApiResponse { success = true, data = llms });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
