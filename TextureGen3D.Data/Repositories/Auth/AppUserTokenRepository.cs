using Dapper;
using TextureGen3D.Data.Entities.Auth;
using TextureGen3D.Data.Interfaces.Auth;
using System.Data;

namespace TextureGen3D.Data.Repositories.Auth
{
    public class AppUserTokenRepository : IAppUserTokenRepository
    {
        readonly IDbConnection _dbConnection;
        public AppUserTokenRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<AppUserTokens> Add(AppUserTokens token)
        {
            string query = @"INSERT INTO public.""AppUserTokens"" (""AppUserId"", ""Token"", ""Expiry"", ""Created"", ""IPAddress"") 
                VALUES (@AppUserId, @Token, @Expiry, @Created, @IPAddress) RETURNING *";
            return (await _dbConnection.QueryFirstOrDefaultAsync<AppUserTokens>(query, token))!;
        }

        public async Task<AppUserTokens> FindByTokenIP(string token, string ip)
        {
            string query = @"SELECT * FROM public.""AppUserTokens"" WHERE ""Token"" = @token AND ""IPAddress"" = @ip";
            return (await _dbConnection.QueryFirstOrDefaultAsync<AppUserTokens>(query, new { token, ip }))!;
        }

        public async Task<bool> IsTokenUnique(string token)
        {
            string query = @"SELECT COUNT(*) FROM public.""AppUserTokens"" WHERE ""Token"" = @token";
            var count = await _dbConnection.ExecuteScalarAsync<int>(query, new { token });
            return count == 0;
        }

        public async Task ExtendRefreshToken(AppUserTokens token)
        {
            string query = @"UPDATE public.""AppUserTokens"" SET ""Expiry"" = @Expiry WHERE ""Id"" = @Id";
            await _dbConnection.ExecuteAsync(query, token);
        }
    }
}
