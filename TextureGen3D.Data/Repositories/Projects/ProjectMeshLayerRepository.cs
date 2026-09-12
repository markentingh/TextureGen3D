using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.Data.Repositories.Projects
{
    public class ProjectMeshLayerRepository : IProjectMeshLayerRepository
    {
        readonly IDbConnection _dbConnection;

        public ProjectMeshLayerRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<ProjectMeshLayer> CreateAsync(ProjectMeshLayer layer)
        {
            if (layer.Id == Guid.Empty)
                layer.Id = Guid.NewGuid();
            if (layer.Created == default)
                layer.Created = DateTime.UtcNow;

            const string query = @"
                INSERT INTO public.""ProjectMeshLayers"" (""Id"", ""ProjectId"", ""ProjectMeshId"", ""Name"", ""Index"", ""Created"")
                VALUES (@Id, @ProjectId, @ProjectMeshId, @Name, @Index, @Created)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<ProjectMeshLayer>(query, layer);
        }

        public async Task<ProjectMeshLayer?> GetByIdAsync(Guid id, Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectMeshLayers"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            return await _dbConnection.QueryFirstOrDefaultAsync<ProjectMeshLayer>(query, new { id, projectId });
        }

        public async Task<IEnumerable<ProjectMeshLayer>> GetByMeshIdAsync(Guid meshId, Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectMeshLayers"" WHERE ""ProjectMeshId"" = @meshId AND ""ProjectId"" = @projectId ORDER BY ""Index"" ASC";
            return await _dbConnection.QueryAsync<ProjectMeshLayer>(query, new { meshId, projectId });
        }

        public async Task<int> GetNextIndexAsync(Guid meshId, Guid projectId)
        {
            const string query = @"SELECT COALESCE(MAX(""Index""), -1) + 1 FROM public.""ProjectMeshLayers"" WHERE ""ProjectMeshId"" = @meshId AND ""ProjectId"" = @projectId";
            return await _dbConnection.ExecuteScalarAsync<int>(query, new { meshId, projectId });
        }

        public async Task UpdateNameAsync(Guid id, Guid projectId, string name)
        {
            const string query = @"UPDATE public.""ProjectMeshLayers"" SET ""Name"" = @name WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId, name });
        }

        public async Task UpdateIndexAsync(Guid id, Guid projectId, int index)
        {
            const string query = @"UPDATE public.""ProjectMeshLayers"" SET ""Index"" = @index WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId, index });
        }

        public async Task ReorderAsync(Guid meshId, Guid projectId, List<Guid> orderedIds)
        {
            for (int i = 0; i < orderedIds.Count; i++)
            {
                const string query = @"UPDATE public.""ProjectMeshLayers"" SET ""Index"" = @index WHERE ""Id"" = @id AND ""ProjectMeshId"" = @meshId AND ""ProjectId"" = @projectId";
                await _dbConnection.ExecuteAsync(query, new { id = orderedIds[i], meshId, projectId, index = i });
            }
        }

        public async Task DeleteAsync(Guid id, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectMeshLayers"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId });
        }

        public async Task DeleteByMeshIdAsync(Guid meshId, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectMeshLayers"" WHERE ""ProjectMeshId"" = @meshId AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { meshId, projectId });
        }
    }
}
