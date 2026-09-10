using TextureGen3D.Data.Entities.Projects;

namespace TextureGen3D.Data.Interfaces.Projects
{
    public interface IProjectImageGenerationRepository
    {
        Task<ProjectImageGeneration> CreateAsync(ProjectImageGeneration generation);
        Task<ProjectImageGeneration?> GetByIdAsync(Guid id);
        Task<IEnumerable<ProjectImageGeneration>> GetByProjectIdAsync(Guid projectId);
        Task<(IEnumerable<ProjectImageGeneration> items, int totalCount)> GetPaginatedAsync(int start, int length);
        Task<IEnumerable<DailyCostResult>> GetDailyCostsAsync(string range);
    }
}
