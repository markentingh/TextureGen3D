using Dapper;
using TextureGen3D.Data.Entities.Auth;
using TextureGen3D.Data.Interfaces.Auth;
using System.Data;

namespace TextureGen3D.Data.Repositories.Auth
{
    public class AppRoleRepository : IAppRoleRepository
    {
        readonly IDbConnection _dbConnection;
        public AppRoleRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<IEnumerable<AppRole>> GetAll()
        {
            string query = @"SELECT * FROM public.""AppRoles"" ORDER BY ""Id""";
            return await _dbConnection.QueryAsync<AppRole>(query);
        }

        public async Task<AppRole> GetById(int id)
        {
            string query = @"SELECT * FROM public.""AppRoles"" WHERE ""Id"" = @id";
            return (await _dbConnection.QueryFirstOrDefaultAsync<AppRole>(query, new { id }))!;
        }

        public async Task<AppRole> GetByName(string name)
        {
            string query = @"SELECT * FROM public.""AppRoles"" WHERE ""Name"" = @name";
            return (await _dbConnection.QueryFirstOrDefaultAsync<AppRole>(query, new { name }))!;
        }
    }
}
