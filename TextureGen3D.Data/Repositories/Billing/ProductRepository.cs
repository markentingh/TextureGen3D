using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Billing;
using TextureGen3D.Data.Interfaces.Billing;

namespace TextureGen3D.Data.Repositories.Billing
{
    public class ProductRepository : IProductRepository
    {
        readonly IDbConnection _dbConnection;

        public ProductRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<Product> CreateAsync(Product product)
        {
            const string query = @"
                INSERT INTO public.""Products"" (""Title"", ""Price"", ""Tokens"")
                VALUES (@Title, @Price, @Tokens)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<Product>(query, product);
        }

        public async Task<Product?> GetByIdAsync(int id)
        {
            const string query = @"SELECT * FROM public.""Products"" WHERE ""Id"" = @id";
            return await _dbConnection.QueryFirstOrDefaultAsync<Product>(query, new { id });
        }

        public async Task<IEnumerable<Product>> GetAllAsync()
        {
            const string query = @"SELECT * FROM public.""Products"" ORDER BY ""DateCreated"" DESC";
            return await _dbConnection.QueryAsync<Product>(query);
        }

        public async Task<IEnumerable<Product>> GetActiveAsync()
        {
            const string query = @"SELECT * FROM public.""Products"" WHERE ""Archived"" = FALSE ORDER BY ""DateCreated"" DESC";
            return await _dbConnection.QueryAsync<Product>(query);
        }

        public async Task UpdateAsync(Product product)
        {
            const string query = @"
                UPDATE public.""Products"" SET ""Title"" = @Title, ""Price"" = @Price, ""Tokens"" = @Tokens
                WHERE ""Id"" = @Id";
            await _dbConnection.ExecuteAsync(query, product);
        }

        public async Task UpdateDetailsAsync(int id, string title, int price, int tokens)
        {
            const string query = @"
                UPDATE public.""Products""
                SET ""Title"" = @title, ""Price"" = @price, ""Tokens"" = @tokens
                WHERE ""Id"" = @id";
            await _dbConnection.ExecuteAsync(query, new { id, title, price, tokens });
        }

        public async Task ArchiveAsync(int id)
        {
            const string query = @"UPDATE public.""Products"" SET ""Archived"" = TRUE WHERE ""Id"" = @id";
            await _dbConnection.ExecuteAsync(query, new { id });
        }
    }
}
