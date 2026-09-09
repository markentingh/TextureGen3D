using TextureGen3D.Data.Entities.Auth;

namespace TextureGen3D.Data.Interfaces.Auth
{
    public interface IAppRoleRepository
    {
        Task<IEnumerable<AppRole>> GetAll();
        Task<AppRole> GetById(int id);
        Task<AppRole> GetByName(string name);
    }
}
