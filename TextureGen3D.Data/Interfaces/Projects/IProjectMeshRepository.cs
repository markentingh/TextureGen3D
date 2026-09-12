using TextureGen3D.Data.Entities.Projects;

namespace TextureGen3D.Data.Interfaces.Projects
{
    public interface IProjectMeshRepository
    {
        Task<ProjectMesh> CreateAsync(ProjectMesh mesh);
        Task<ProjectMesh?> GetByIdAsync(Guid id, Guid projectId);
        Task<IEnumerable<ProjectMesh>> GetByProjectIdAsync(Guid projectId);
        Task<IEnumerable<ProjectMesh>> GetByModelIdAsync(Guid modelId, Guid projectId);
        Task DeleteAsync(Guid id, Guid projectId);
        Task DeleteByModelIdAsync(Guid modelId, Guid projectId);
        Task UpdatePromptAsync(Guid id, Guid projectId, string prompt);
    }
}
