using TextureGen3D.Data.Entities.Projects;

namespace TextureGen3D.Data.Interfaces.Projects
{
    public interface IProjectMeshLayerRepository
    {
        Task<ProjectMeshLayer> CreateAsync(ProjectMeshLayer layer);
        Task<ProjectMeshLayer?> GetByIdAsync(Guid id, Guid projectId);
        Task<IEnumerable<ProjectMeshLayer>> GetByMeshIdAsync(Guid meshId, Guid projectId);
        Task<int> GetNextIndexAsync(Guid meshId, Guid projectId);
        Task UpdateNameAsync(Guid id, Guid projectId, string name);
        Task UpdateIndexAsync(Guid id, Guid projectId, int index);
        Task ReorderAsync(Guid meshId, Guid projectId, List<Guid> orderedIds);
        Task DeleteAsync(Guid id, Guid projectId);
        Task DeleteByMeshIdAsync(Guid meshId, Guid projectId);
    }
}
