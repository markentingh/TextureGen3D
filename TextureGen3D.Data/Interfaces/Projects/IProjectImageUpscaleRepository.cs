using TextureGen3D.Data.Entities.Projects;

namespace TextureGen3D.Data.Interfaces.Projects
{
    public interface IProjectImageUpscaleRepository
    {
        Task<ProjectImageUpscale> CreateAsync(ProjectImageUpscale upscale);
        Task<IEnumerable<ProjectImageUpscale>> GetByProjectIdAsync(Guid projectId);
    }
}
