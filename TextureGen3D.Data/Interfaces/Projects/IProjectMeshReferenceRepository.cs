using TextureGen3D.Data.Entities.Projects;

namespace TextureGen3D.Data.Interfaces.Projects
{
    public interface IProjectMeshReferenceRepository
    {
        Task<ProjectMeshReference> CreateAsync(ProjectMeshReference meshRef);
        Task<IEnumerable<ProjectMeshReference>> GetByMeshIdAsync(Guid meshId, Guid projectId);
        Task<ProjectMeshReference?> GetByMeshAndReferenceAsync(Guid meshId, Guid referenceId, Guid projectId);
        Task UpdateActiveAsync(Guid id, Guid projectId, bool active);
        Task DeleteAsync(Guid id, Guid projectId);
        Task DeleteByMeshIdAsync(Guid meshId, Guid projectId);
        Task DeleteByReferenceIdAsync(Guid referenceId, Guid projectId);
    }
}
