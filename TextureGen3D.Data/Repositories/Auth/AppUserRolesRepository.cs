using Dapper;
using TextureGen3D.Data.Entities.Auth;
using TextureGen3D.Data.Interfaces.Auth;
using System.Data;

namespace TextureGen3D.Data.Repositories.Auth
{
    public class AppUserRolesRepository : IAppUserRolesRepository
    {
        readonly IDbConnection _dbConnection;
        public AppUserRolesRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<IEnumerable<AppUserRole>> GetByUserId(Guid userId)
        {
            string query = @"SELECT * FROM public.""AppUserRoles"" WHERE ""AppUserId"" = @userId";
            return await _dbConnection.QueryAsync<AppUserRole>(query, new { userId });
        }

        public async Task Add(AppUserRole userRole)
        {
            string query = @"INSERT INTO public.""AppUserRoles"" (""AppUserId"", ""AppRoleId"") VALUES (@AppUserId, @AppRoleId)";
            await _dbConnection.ExecuteAsync(query, userRole);
        }

        public async Task Remove(Guid userId, int roleId)
        {
            string query = @"DELETE FROM public.""AppUserRoles"" WHERE ""AppUserId"" = @userId AND ""AppRoleId"" = @roleId";
            await _dbConnection.ExecuteAsync(query, new { userId, roleId });
        }
    }
}
