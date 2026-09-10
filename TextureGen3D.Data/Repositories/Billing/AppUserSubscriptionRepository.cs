using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Billing;
using TextureGen3D.Data.Interfaces.Billing;

namespace TextureGen3D.Data.Repositories.Billing
{
    public class AppUserSubscriptionRepository : IAppUserSubscriptionRepository
    {
        readonly IDbConnection _dbConnection;

        public AppUserSubscriptionRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<AppUserSubscription> CreateAsync(AppUserSubscription subscription)
        {
            const string query = @"
                INSERT INTO public.""AppUserSubscriptions"" (""AppUserId"", ""SubscriptionId"", ""StartDate"")
                VALUES (@AppUserId, @SubscriptionId, @StartDate)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<AppUserSubscription>(query, subscription);
        }

        public async Task<AppUserSubscription?> GetByIdAsync(int id)
        {
            const string query = @"SELECT * FROM public.""AppUserSubscriptions"" WHERE ""Id"" = @id";
            return await _dbConnection.QueryFirstOrDefaultAsync<AppUserSubscription>(query, new { id });
        }

        public async Task<IEnumerable<AppUserSubscription>> GetAllAsync()
        {
            const string query = @"SELECT * FROM public.""AppUserSubscriptions"" ORDER BY ""DateCreated"" DESC";
            return await _dbConnection.QueryAsync<AppUserSubscription>(query);
        }

        public async Task<IEnumerable<AppUserSubscription>> GetByAppUserIdAsync(Guid appUserId)
        {
            const string query = @"SELECT * FROM public.""AppUserSubscriptions"" WHERE ""AppUserId"" = @appUserId ORDER BY ""DateCreated"" DESC";
            return await _dbConnection.QueryAsync<AppUserSubscription>(query, new { appUserId });
        }

        public async Task<IEnumerable<AppUserSubscription>> GetActiveByAppUserIdAsync(Guid appUserId)
        {
            const string query = @"SELECT * FROM public.""AppUserSubscriptions"" WHERE ""AppUserId"" = @appUserId AND ""Cancelled"" = FALSE ORDER BY ""DateCreated"" DESC";
            return await _dbConnection.QueryAsync<AppUserSubscription>(query, new { appUserId });
        }

        public async Task CancelAsync(int id)
        {
            const string query = @"UPDATE public.""AppUserSubscriptions"" SET ""Cancelled"" = TRUE, ""EndDate"" = NOW() WHERE ""Id"" = @id";
            await _dbConnection.ExecuteAsync(query, new { id });
        }
    }
}
