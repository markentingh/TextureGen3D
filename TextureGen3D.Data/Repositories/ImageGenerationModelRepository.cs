using Dapper;
using System.Data;
using TextureGen3D.Data.Entities;
using TextureGen3D.Data.Interfaces;

namespace TextureGen3D.Data.Repositories
{
    public class ImageGenerationModelRepository : IImageGenerationModelRepository
    {
        readonly IDbConnection _dbConnection;

        public ImageGenerationModelRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<IEnumerable<ImageGenerationModel>> GetAllAsync()
        {
            const string query = @"SELECT * FROM public.""ImageGeneration"" ORDER BY ""Id""";
            return await _dbConnection.QueryAsync<ImageGenerationModel>(query);
        }

        public async Task<IEnumerable<ImageGenerationModel>> GetActiveAsync()
        {
            const string query = @"SELECT * FROM public.""ImageGeneration"" WHERE ""Active"" = TRUE ORDER BY ""Id""";
            return await _dbConnection.QueryAsync<ImageGenerationModel>(query);
        }

        public async Task<ImageGenerationModel?> GetByModelKeyAsync(string modelKey)
        {
            const string query = @"SELECT * FROM public.""ImageGeneration"" WHERE ""ModelKey"" = @modelKey";
            return await _dbConnection.QueryFirstOrDefaultAsync<ImageGenerationModel>(query, new { modelKey });
        }

        public async Task<ImageGenerationModel?> GetByIdAsync(int id)
        {
            const string query = @"SELECT * FROM public.""ImageGeneration"" WHERE ""Id"" = @id";
            return await _dbConnection.QueryFirstOrDefaultAsync<ImageGenerationModel>(query, new { id });
        }

        public async Task<ImageGenerationModel> CreateAsync(ImageGenerationModel model)
        {
            const string query = @"
                INSERT INTO public.""ImageGeneration"" (""ModelKey"", ""Name"", ""Model"", ""CPMITTokens"", ""CPMIITokens"", ""CPMOTokens"", ""Type"", ""CP1K"", ""CP2K"", ""CP4K"", ""CP8K"", ""Active"")
                VALUES (@ModelKey, @Name, @Model, @CPMITTokens, @CPMIITokens, @CPMOTokens, @Type, @CP1K, @CP2K, @CP4K, @CP8K, @Active)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<ImageGenerationModel>(query, model);
        }

        public async Task UpdateAsync(ImageGenerationModel model)
        {
            const string query = @"
                UPDATE public.""ImageGeneration""
                SET ""ModelKey"" = @ModelKey, ""Name"" = @Name, ""Model"" = @Model,
                    ""CPMITTokens"" = @CPMITTokens, ""CPMIITokens"" = @CPMIITokens, ""CPMOTokens"" = @CPMOTokens,
                    ""Type"" = @Type, ""CP1K"" = @CP1K, ""CP2K"" = @CP2K, ""CP4K"" = @CP4K, ""CP8K"" = @CP8K,
                    ""Active"" = @Active, ""DateUpdated"" = CURRENT_TIMESTAMP
                WHERE ""Id"" = @Id";
            await _dbConnection.ExecuteAsync(query, model);
        }

        public async Task ToggleActiveAsync(int id, bool active)
        {
            const string query = @"UPDATE public.""ImageGeneration"" SET ""Active"" = @active, ""DateUpdated"" = CURRENT_TIMESTAMP WHERE ""Id"" = @id";
            await _dbConnection.ExecuteAsync(query, new { id, active });
        }

        public async Task DeleteAsync(int id)
        {
            const string query = @"DELETE FROM public.""ImageGeneration"" WHERE ""Id"" = @id";
            await _dbConnection.ExecuteAsync(query, new { id });
        }
    }
}
