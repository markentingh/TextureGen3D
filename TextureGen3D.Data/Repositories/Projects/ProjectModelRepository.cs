using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.Data.Repositories.Projects
{
    public class ProjectModelRepository : IProjectModelRepository
    {
        readonly IDbConnection _dbConnection;

        public ProjectModelRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<ProjectModel> CreateAsync(ProjectModel model)
        {
            if (model.Id == Guid.Empty)
            {
                model.Id = Guid.NewGuid();
            }
            if (model.Created == default)
            {
                model.Created = DateTime.UtcNow;
            }
            const string query = @"
                INSERT INTO public.""ProjectModels"" (""Id"", ""ProjectId"", ""Filename"", ""Extension"", ""FileSize"", ""Created"")
                VALUES (@Id, @ProjectId, @Filename, @Extension, @FileSize, @Created)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<ProjectModel>(query, model);
        }

        public async Task<ProjectModel?> GetByIdAsync(Guid id, Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectModels"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            return await _dbConnection.QueryFirstOrDefaultAsync<ProjectModel>(query, new { id, projectId });
        }

        public async Task<IEnumerable<ProjectModel>> GetByProjectIdAsync(Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectModels"" WHERE ""ProjectId"" = @projectId ORDER BY ""Created"" DESC";
            return await _dbConnection.QueryAsync<ProjectModel>(query, new { projectId });
        }

        public async Task DeleteAsync(Guid id, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectModels"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId });
        }
    }
}
