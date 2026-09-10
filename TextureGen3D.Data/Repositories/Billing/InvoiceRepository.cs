using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Billing;
using TextureGen3D.Data.Interfaces.Billing;

namespace TextureGen3D.Data.Repositories.Billing
{
    public class InvoiceRepository : IInvoiceRepository
    {
        readonly IDbConnection _dbConnection;

        public InvoiceRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<Invoice> CreateAsync(Invoice invoice)
        {
            const string query = @"
                INSERT INTO public.""Invoices"" (""AppUserId"", ""SubscriptionId"", ""ProductId"", ""Price"")
                VALUES (@AppUserId, @SubscriptionId, @ProductId, @Price)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<Invoice>(query, invoice);
        }

        public async Task<Invoice?> GetByIdAsync(int id)
        {
            const string query = @"SELECT * FROM public.""Invoices"" WHERE ""Id"" = @id";
            return await _dbConnection.QueryFirstOrDefaultAsync<Invoice>(query, new { id });
        }

        public async Task<IEnumerable<Invoice>> GetAllAsync()
        {
            const string query = @"SELECT * FROM public.""Invoices"" ORDER BY ""DateCreated"" DESC";
            return await _dbConnection.QueryAsync<Invoice>(query);
        }

        public async Task<IEnumerable<Invoice>> GetByAppUserIdAsync(Guid appUserId)
        {
            const string query = @"SELECT * FROM public.""Invoices"" WHERE ""AppUserId"" = @appUserId ORDER BY ""DateCreated"" DESC";
            return await _dbConnection.QueryAsync<Invoice>(query, new { appUserId });
        }
    }
}
