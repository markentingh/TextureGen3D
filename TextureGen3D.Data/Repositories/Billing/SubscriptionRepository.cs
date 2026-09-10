using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Billing;
using TextureGen3D.Data.Interfaces.Billing;

namespace TextureGen3D.Data.Repositories.Billing
{
    public class SubscriptionRepository : ISubscriptionRepository
    {
        readonly IDbConnection _dbConnection;

        public SubscriptionRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<Subscription> CreateAsync(Subscription subscription)
        {
            const string query = @"
                INSERT INTO public.""Subscriptions"" (""Title"", ""MonthlyProductId"", ""YearlyProductId"", ""FeaturesJson"", ""SortIndex"", ""Status"")
                VALUES (@Title, @MonthlyProductId, @YearlyProductId, @FeaturesJson, COALESCE((SELECT MAX(""SortIndex"") FROM public.""Subscriptions"") + 1, 0), @Status)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<Subscription>(query, subscription);
        }

        public async Task<Subscription?> GetByIdAsync(int id)
        {
            const string query = @"SELECT * FROM public.""Subscriptions"" WHERE ""Id"" = @id";
            return await _dbConnection.QueryFirstOrDefaultAsync<Subscription>(query, new { id });
        }

        public async Task<IEnumerable<Subscription>> GetAllAsync()
        {
            const string query = @"SELECT * FROM public.""Subscriptions"" ORDER BY ""SortIndex"" ASC, ""DateCreated"" DESC";
            return await _dbConnection.QueryAsync<Subscription>(query);
        }

        public async Task<IEnumerable<Subscription>> GetActiveAsync()
        {
            const string query = @"SELECT * FROM public.""Subscriptions"" WHERE ""Archived"" = FALSE AND ""Status"" = 1 ORDER BY ""SortIndex"" ASC, ""DateCreated"" DESC";
            return await _dbConnection.QueryAsync<Subscription>(query);
        }

        public async Task UpdateAsync(Subscription subscription)
        {
            const string query = @"
                UPDATE public.""Subscriptions"" SET ""Title"" = @Title, ""MonthlyProductId"" = @MonthlyProductId, ""YearlyProductId"" = @YearlyProductId, ""FeaturesJson"" = @FeaturesJson, ""Status"" = @Status
                WHERE ""Id"" = @Id";
            await _dbConnection.ExecuteAsync(query, subscription);
        }

        public async Task ArchiveAsync(int id)
        {
            const string query = @"UPDATE public.""Subscriptions"" SET ""Archived"" = TRUE WHERE ""Id"" = @id";
            await _dbConnection.ExecuteAsync(query, new { id });
        }

        public async Task ReorderAsync(IEnumerable<int> ids)
        {
            const string query = @"UPDATE public.""Subscriptions"" SET ""SortIndex"" = @sortIndex WHERE ""Id"" = @id";
            var parameters = ids.Select((id, index) => new { id, sortIndex = index });
            await _dbConnection.ExecuteAsync(query, parameters);
        }

        public async Task SetFeaturedAsync(int id)
        {
            const string query = @"
                UPDATE public.""Subscriptions"" SET ""Featured"" = CASE WHEN ""Id"" = @id THEN TRUE ELSE FALSE END";
            await _dbConnection.ExecuteAsync(query, new { id });
        }
    }
}
