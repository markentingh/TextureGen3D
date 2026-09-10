using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.Data.Repositories.Projects
{
    public class ProjectImageGenerationRepository : IProjectImageGenerationRepository
    {
        readonly IDbConnection _dbConnection;

        public ProjectImageGenerationRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<ProjectImageGeneration> CreateAsync(ProjectImageGeneration generation)
        {
            generation.Id = Guid.NewGuid();
            const string query = @"
                INSERT INTO public.""ProjectImageGenerations"" (""Id"", ""ProjectId"", ""AppUserId"", ""ImageGenerationId"", ""InputTextTokens"", ""InputImageTokens"", ""OutputTokens"", ""Tokens"", ""Prompt"", ""Filename"", ""Resolution"", ""InputImages"", ""InputImageJson"", ""Type"", ""Cost"", ""DateYear"", ""DateMonth"", ""DateDay"")
                VALUES (@Id, @ProjectId, @AppUserId, @ImageGenerationId, @InputTextTokens, @InputImageTokens, @OutputTokens, @Tokens, @Prompt, @Filename, @Resolution, @InputImages, @InputImageJson, @Type, @Cost, EXTRACT(YEAR FROM NOW())::int, EXTRACT(MONTH FROM NOW())::int, EXTRACT(DAY FROM NOW())::int)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<ProjectImageGeneration>(query, generation);
        }

        public async Task<ProjectImageGeneration?> GetByIdAsync(Guid id)
        {
            const string query = @"SELECT * FROM public.""ProjectImageGenerations"" WHERE ""Id"" = @id";
            return await _dbConnection.QueryFirstOrDefaultAsync<ProjectImageGeneration>(query, new { id });
        }

        public async Task<IEnumerable<ProjectImageGeneration>> GetByProjectIdAsync(Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectImageGenerations"" WHERE ""ProjectId"" = @projectId ORDER BY ""DateCreated"" DESC";
            return await _dbConnection.QueryAsync<ProjectImageGeneration>(query, new { projectId });
        }

        public async Task<(IEnumerable<ProjectImageGeneration> items, int totalCount)> GetPaginatedAsync(int start, int length)
        {
            const string countQuery = @"SELECT COUNT(*) FROM public.""ProjectImageGenerations""";
            var totalCount = await _dbConnection.ExecuteScalarAsync<int>(countQuery);

            const string query = @"
                SELECT * FROM public.""ProjectImageGenerations""
                ORDER BY ""DateCreated"" DESC
                OFFSET @start LIMIT @length";
            var items = await _dbConnection.QueryAsync<ProjectImageGeneration>(query, new { start, length });
            return (items, totalCount);
        }

        public async Task<IEnumerable<DailyCostResult>> GetDailyCostsAsync(string range)
        {
            var now = DateTime.UtcNow.Date;
            DateTime startDate;
            DateTime endDate;
            string query;

            switch (range?.ToLowerInvariant())
            {
                case "3months":
                    startDate = now.AddMonths(-3);
                    endDate = now.AddDays(1);
                    query = @"
                        SELECT MAKE_DATE(""DateYear"", ""DateMonth"", ""DateDay"") AS ""Date"",
                               COALESCE(SUM(""Cost""), 0) AS ""TotalCost"",
                               COALESCE(SUM(CASE WHEN ""Type"" = 3 THEN ""Cost"" ELSE 0 END), 0) AS ""UpscaleCost"",
                               COALESCE(SUM(""Tokens""), 0) AS ""TotalTokens"",
                               COALESCE(SUM(""InputTextTokens""), 0) AS ""TotalInputTextTokens"",
                               COALESCE(SUM(""InputImageTokens""), 0) AS ""TotalInputImageTokens"",
                               COALESCE(SUM(""OutputTokens""), 0) AS ""TotalOutputTokens"",
                               COUNT(*) AS ""TotalGenerations""
                        FROM public.""ProjectImageGenerations""
                        WHERE ""DateCreated"" >= @startDate AND ""DateCreated"" < @endDate
                        GROUP BY ""DateYear"", ""DateMonth"", ""DateDay""
                        ORDER BY ""Date""";
                    break;

                case "12months":
                    startDate = now.AddYears(-1);
                    endDate = now.AddDays(1);
                    query = @"
                        SELECT MAKE_DATE(""DateYear"", ""DateMonth"", 1) AS ""Date"",
                               COALESCE(SUM(""Cost""), 0) AS ""TotalCost"",
                               COALESCE(SUM(CASE WHEN ""Type"" = 3 THEN ""Cost"" ELSE 0 END), 0) AS ""UpscaleCost"",
                               COALESCE(SUM(""Tokens""), 0) AS ""TotalTokens"",
                               COALESCE(SUM(""InputTextTokens""), 0) AS ""TotalInputTextTokens"",
                               COALESCE(SUM(""InputImageTokens""), 0) AS ""TotalInputImageTokens"",
                               COALESCE(SUM(""OutputTokens""), 0) AS ""TotalOutputTokens"",
                               COUNT(*) AS ""TotalGenerations""
                        FROM public.""ProjectImageGenerations""
                        WHERE ""DateCreated"" >= @startDate AND ""DateCreated"" < @endDate
                        GROUP BY ""DateYear"", ""DateMonth""
                        ORDER BY ""Date""";
                    break;

                case "ytd":
                    startDate = new DateTime(now.Year, 1, 1);
                    endDate = now.AddDays(1);
                    query = @"
                        SELECT (MAKE_DATE(""DateYear"", 1, 1) + ((EXTRACT(WEEK FROM ""DateCreated"")::int - 1) * INTERVAL '7 days'))::date AS ""Date"",
                               COALESCE(SUM(""Cost""), 0) AS ""TotalCost"",
                               COALESCE(SUM(CASE WHEN ""Type"" = 3 THEN ""Cost"" ELSE 0 END), 0) AS ""UpscaleCost"",
                               COALESCE(SUM(""Tokens""), 0) AS ""TotalTokens"",
                               COALESCE(SUM(""InputTextTokens""), 0) AS ""TotalInputTextTokens"",
                               COALESCE(SUM(""InputImageTokens""), 0) AS ""TotalInputImageTokens"",
                               COALESCE(SUM(""OutputTokens""), 0) AS ""TotalOutputTokens"",
                               COUNT(*) AS ""TotalGenerations""
                        FROM public.""ProjectImageGenerations""
                        WHERE ""DateCreated"" >= @startDate AND ""DateCreated"" < @endDate
                        GROUP BY ""DateYear"", EXTRACT(WEEK FROM ""DateCreated"")::int
                        ORDER BY ""Date""";
                    break;

                case "thismonth":
                    startDate = new DateTime(now.Year, now.Month, 1);
                    endDate = now.AddDays(1);
                    query = @"
                        SELECT MAKE_DATE(""DateYear"", ""DateMonth"", ""DateDay"") AS ""Date"",
                               COALESCE(SUM(""Cost""), 0) AS ""TotalCost"",
                               COALESCE(SUM(CASE WHEN ""Type"" = 3 THEN ""Cost"" ELSE 0 END), 0) AS ""UpscaleCost"",
                               COALESCE(SUM(""Tokens""), 0) AS ""TotalTokens"",
                               COALESCE(SUM(""InputTextTokens""), 0) AS ""TotalInputTextTokens"",
                               COALESCE(SUM(""InputImageTokens""), 0) AS ""TotalInputImageTokens"",
                               COALESCE(SUM(""OutputTokens""), 0) AS ""TotalOutputTokens"",
                               COUNT(*) AS ""TotalGenerations""
                        FROM public.""ProjectImageGenerations""
                        WHERE ""DateCreated"" >= @startDate AND ""DateCreated"" < @endDate
                        GROUP BY ""DateYear"", ""DateMonth"", ""DateDay""
                        ORDER BY ""Date""";
                    break;

                case "lastmonth":
                    startDate = new DateTime(now.Year, now.Month, 1).AddMonths(-1);
                    endDate = new DateTime(now.Year, now.Month, 1);
                    query = @"
                        SELECT MAKE_DATE(""DateYear"", ""DateMonth"", ""DateDay"") AS ""Date"",
                               COALESCE(SUM(""Cost""), 0) AS ""TotalCost"",
                               COALESCE(SUM(CASE WHEN ""Type"" = 3 THEN ""Cost"" ELSE 0 END), 0) AS ""UpscaleCost"",
                               COALESCE(SUM(""Tokens""), 0) AS ""TotalTokens"",
                               COALESCE(SUM(""InputTextTokens""), 0) AS ""TotalInputTextTokens"",
                               COALESCE(SUM(""InputImageTokens""), 0) AS ""TotalInputImageTokens"",
                               COALESCE(SUM(""OutputTokens""), 0) AS ""TotalOutputTokens"",
                               COUNT(*) AS ""TotalGenerations""
                        FROM public.""ProjectImageGenerations""
                        WHERE ""DateCreated"" >= @startDate AND ""DateCreated"" < @endDate
                        GROUP BY ""DateYear"", ""DateMonth"", ""DateDay""
                        ORDER BY ""Date""";
                    break;

                default:
                    startDate = now.AddDays(-30);
                    endDate = now.AddDays(1);
                    query = @"
                        SELECT MAKE_DATE(""DateYear"", ""DateMonth"", ""DateDay"") AS ""Date"",
                               COALESCE(SUM(""Cost""), 0) AS ""TotalCost"",
                               COALESCE(SUM(CASE WHEN ""Type"" = 3 THEN ""Cost"" ELSE 0 END), 0) AS ""UpscaleCost"",
                               COALESCE(SUM(""Tokens""), 0) AS ""TotalTokens"",
                               COALESCE(SUM(""InputTextTokens""), 0) AS ""TotalInputTextTokens"",
                               COALESCE(SUM(""InputImageTokens""), 0) AS ""TotalInputImageTokens"",
                               COALESCE(SUM(""OutputTokens""), 0) AS ""TotalOutputTokens"",
                               COUNT(*) AS ""TotalGenerations""
                        FROM public.""ProjectImageGenerations""
                        WHERE ""DateCreated"" >= @startDate AND ""DateCreated"" < @endDate
                        GROUP BY ""DateYear"", ""DateMonth"", ""DateDay""
                        ORDER BY ""Date""";
                    break;
            }

            return await _dbConnection.QueryAsync<DailyCostResult>(query, new { startDate, endDate });
        }
    }
}
