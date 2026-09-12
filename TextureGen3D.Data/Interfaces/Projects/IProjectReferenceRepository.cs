using TextureGen3D.Data.Entities.Projects;

namespace TextureGen3D.Data.Interfaces.Projects
{
    public interface IProjectReferenceRepository
    {
        Task<ProjectReference> CreateAsync(ProjectReference reference);
        Task<ProjectReference?> GetByIdAsync(Guid id, Guid projectId);
        Task<IEnumerable<ProjectReference>> GetByProjectIdAsync(Guid projectId);
        Task UpdateActiveAsync(Guid id, Guid projectId, bool active);
        Task UpdateAsync(ProjectReference reference);
        Task DeleteAsync(Guid id, Guid projectId);
    }
}
