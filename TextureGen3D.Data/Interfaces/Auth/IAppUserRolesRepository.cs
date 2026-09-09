using TextureGen3D.Data.Entities.Auth;

namespace TextureGen3D.Data.Interfaces.Auth
{
    public interface IAppUserRolesRepository
    {
        Task<IEnumerable<AppUserRole>> GetByUserId(Guid userId);
        Task Add(AppUserRole userRole);
        Task Remove(Guid userId, int roleId);
    }
}
