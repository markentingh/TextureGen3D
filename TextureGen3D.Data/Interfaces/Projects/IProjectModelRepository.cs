using TextureGen3D.Data.Entities.Projects;

namespace TextureGen3D.Data.Interfaces.Projects
{
    public interface IProjectModelRepository
    {
        Task<ProjectModel> CreateAsync(ProjectModel model);
        Task<ProjectModel?> GetByIdAsync(Guid id, Guid projectId);
        Task<IEnumerable<ProjectModel>> GetByProjectIdAsync(Guid projectId);
        Task DeleteAsync(Guid id, Guid projectId);
    }
}
