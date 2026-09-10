using TextureGen3D.Data.Entities.Projects;

namespace TextureGen3D.Data.Interfaces.Projects
{
    public interface IProjectRepository
    {
        Task<IEnumerable<Project>> GetAllAsync(Guid appUserId);
        Task<IEnumerable<Project>> GetArchivedAsync(Guid appUserId);
        Task<Project?> GetByIdAsync(Guid id, Guid appUserId);
        Task<Project?> GetByKeyAsync(string key);
        Task<Project> CreateAsync(Project project);
        Task UpdateAsync(Project project);
        Task UpdateTitleAsync(Guid id, Guid appUserId, string title);
        Task UpdateKeyAsync(Guid id, Guid appUserId, string key);
        Task DeleteAsync(Guid id, Guid appUserId);
        Task UnarchiveAsync(Guid id, Guid appUserId);
    }
}
