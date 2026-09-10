using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Billing;
using TextureGen3D.Data.Interfaces.Billing;

namespace TextureGen3D.Data.Repositories.Billing
{
    public class AppUserAITokenRepository : IAppUserAITokenRepository
    {
        readonly IDbConnection _dbConnection;

        public AppUserAITokenRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<AppUserAIToken> CreateAsync(AppUserAIToken token)
        {
            const string query = @"
                INSERT INTO public.""AppUserAITokens"" (""AppUserId"", ""InvoiceId"", ""BillingMonth"", ""Tokens"", ""TokensUsed"")
                VALUES (@AppUserId, @InvoiceId, @BillingMonth, @Tokens, @TokensUsed)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<AppUserAIToken>(query, token);
        }

        public async Task<AppUserAIToken?> GetByIdAsync(int id)
        {
            const string query = @"SELECT * FROM public.""AppUserAITokens"" WHERE ""Id"" = @id";
            return await _dbConnection.QueryFirstOrDefaultAsync<AppUserAIToken>(query, new { id });
        }

        public async Task<IEnumerable<AppUserAIToken>> GetByAppUserIdAsync(Guid appUserId)
        {
            const string query = @"SELECT * FROM public.""AppUserAITokens"" WHERE ""AppUserId"" = @appUserId ORDER BY ""DateCreated"" ASC";
            return await _dbConnection.QueryAsync<AppUserAIToken>(query, new { appUserId });
        }

        public async Task<IEnumerable<AppUserAIToken>> GetByAppUserAndMonthAsync(Guid appUserId, DateTime billingMonth)
        {
            const string query = @"SELECT * FROM public.""AppUserAITokens"" WHERE ""AppUserId"" = @appUserId AND ""BillingMonth"" = @billingMonth ORDER BY ""DateCreated"" ASC";
            return await _dbConnection.QueryAsync<AppUserAIToken>(query, new { appUserId, billingMonth });
        }

        public async Task UpdateTokensUsedAsync(int id, int tokensUsed)
        {
            const string query = @"UPDATE public.""AppUserAITokens"" SET ""TokensUsed"" = @tokensUsed WHERE ""Id"" = @id";
            await _dbConnection.ExecuteAsync(query, new { id, tokensUsed });
        }

        public async Task<(IEnumerable<AppUserAIToken> Items, int Total)> GetPagedByAppUserIdAsync(Guid appUserId, int page, int pageSize)
        {
            var offset = (page - 1) * pageSize;
            const string countQuery = @"SELECT COUNT(*) FROM public.""AppUserAITokens"" WHERE ""AppUserId"" = @appUserId";
            const string itemsQuery = @"
                SELECT * FROM public.""AppUserAITokens""
                WHERE ""AppUserId"" = @appUserId
                ORDER BY ""DateCreated"" DESC
                LIMIT @pageSize OFFSET @offset";
            var total = await _dbConnection.ExecuteScalarAsync<int>(countQuery, new { appUserId });
            var items = await _dbConnection.QueryAsync<AppUserAIToken>(itemsQuery, new { appUserId, pageSize, offset });
            return (items, total);
        }
    }
}
