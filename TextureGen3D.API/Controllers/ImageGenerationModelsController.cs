using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.Data.Interfaces;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/image-generation")]
    [Authorize]
    public class ImageGenerationModelsController : ApiController
    {
        readonly IImageGenerationModelRepository _repo;

        public ImageGenerationModelsController(IImageGenerationModelRepository repo)
        {
            _repo = repo;
        }

        [HttpGet("active-models")]
        public async Task<IActionResult> GetActiveModels()
        {
            try
            {
                var models = await _repo.GetActiveAsync();
                var result = models.Select(m => new
                {
                    id = m.Id,
                    modelKey = m.ModelKey,
                    name = m.Name,
                    model = m.Model,
                    type = m.Type,
                    cp1k = m.CP1K,
                    cp2k = m.CP2K,
                    cp4k = m.CP4K,
                    cp8k = m.CP8K
                }).ToList();

                return Json(new ApiResponse { success = true, data = result });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
