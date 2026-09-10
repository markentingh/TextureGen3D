using TextureGen3D.Data.Entities;

namespace TextureGen3D.Data.Interfaces
{
    public interface IImageGenerationModelRepository
    {
        Task<IEnumerable<ImageGenerationModel>> GetAllAsync();
        Task<IEnumerable<ImageGenerationModel>> GetActiveAsync();
        Task<ImageGenerationModel?> GetByModelKeyAsync(string modelKey);
        Task<ImageGenerationModel?> GetByIdAsync(int id);
        Task<ImageGenerationModel> CreateAsync(ImageGenerationModel model);
        Task UpdateAsync(ImageGenerationModel model);
        Task ToggleActiveAsync(int id, bool active);
        Task DeleteAsync(int id);
    }
}
