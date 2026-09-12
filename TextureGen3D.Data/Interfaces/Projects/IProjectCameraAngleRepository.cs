using TextureGen3D.Data.Entities.Projects;

namespace TextureGen3D.Data.Interfaces.Projects
{
    public interface IProjectCameraAngleRepository
    {
        Task<ProjectCameraAngle> CreateAsync(ProjectCameraAngle angle);
        Task<ProjectCameraAngle?> GetByIdAsync(Guid id, Guid projectId);
        Task<IEnumerable<ProjectCameraAngle>> GetByMeshIdAsync(Guid meshId, Guid projectId);
        Task<IEnumerable<ProjectCameraAngle>> GetByProjectIdAsync(Guid projectId);
        Task UpdatePromptAsync(Guid id, Guid projectId, string prompt);
        Task UpdateReferenceAsync(Guid id, Guid projectId, Guid? projectReferenceId);
        Task DeleteAsync(Guid id, Guid projectId);
        Task DeleteByMeshIdAsync(Guid meshId, Guid projectId);
        Task DeleteByModelIdAsync(Guid modelId, Guid projectId);
        Task DeleteByProjectIdAsync(Guid projectId);
    }
}
