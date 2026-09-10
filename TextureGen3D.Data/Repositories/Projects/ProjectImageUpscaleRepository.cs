using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.Data.Repositories.Projects
{
    public class ProjectImageUpscaleRepository : IProjectImageUpscaleRepository
    {
        readonly IDbConnection _dbConnection;

        public ProjectImageUpscaleRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<ProjectImageUpscale> CreateAsync(ProjectImageUpscale upscale)
        {
            upscale.Id = Guid.NewGuid();
            upscale.Created = DateTime.UtcNow;
            const string query = @"
                INSERT INTO public.""ProjectImageUpscales"" (""Id"", ""ProjectId"", ""Width"", ""Height"", ""Scale"", ""Created"")
                VALUES (@Id, @ProjectId, @Width, @Height, @Scale, @Created)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<ProjectImageUpscale>(query, upscale);
        }

        public async Task<IEnumerable<ProjectImageUpscale>> GetByProjectIdAsync(Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectImageUpscales"" WHERE ""ProjectId"" = @projectId ORDER BY ""Created"" DESC";
            return await _dbConnection.QueryAsync<ProjectImageUpscale>(query, new { projectId });
        }
    }
}
