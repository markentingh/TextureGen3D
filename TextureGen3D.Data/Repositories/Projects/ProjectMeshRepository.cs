using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.Data.Repositories.Projects
{
    public class ProjectMeshRepository : IProjectMeshRepository
    {
        readonly IDbConnection _dbConnection;

        public ProjectMeshRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<ProjectMesh> CreateAsync(ProjectMesh mesh)
        {
            if (mesh.Id == Guid.Empty)
                mesh.Id = Guid.NewGuid();
            if (mesh.Created == default)
                mesh.Created = DateTime.UtcNow;

            const string query = @"
                INSERT INTO public.""ProjectMeshes"" (""Id"", ""ProjectId"", ""ModelId"", ""Name"", ""MeshData"", ""UVMapData"", ""Triangles"", ""Vertices"", ""Created"")
                VALUES (@Id, @ProjectId, @ModelId, @Name, @MeshData, @UVMapData, @Triangles, @Vertices, @Created)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<ProjectMesh>(query, mesh);
        }

        public async Task<ProjectMesh?> GetByIdAsync(Guid id, Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectMeshes"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            return await _dbConnection.QueryFirstOrDefaultAsync<ProjectMesh>(query, new { id, projectId });
        }

        public async Task<IEnumerable<ProjectMesh>> GetByProjectIdAsync(Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectMeshes"" WHERE ""ProjectId"" = @projectId ORDER BY ""Created"" ASC";
            return await _dbConnection.QueryAsync<ProjectMesh>(query, new { projectId });
        }

        public async Task<IEnumerable<ProjectMesh>> GetByModelIdAsync(Guid modelId, Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectMeshes"" WHERE ""ModelId"" = @modelId AND ""ProjectId"" = @projectId ORDER BY ""Created"" ASC";
            return await _dbConnection.QueryAsync<ProjectMesh>(query, new { modelId, projectId });
        }

        public async Task DeleteAsync(Guid id, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectMeshes"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId });
        }

        public async Task DeleteByModelIdAsync(Guid modelId, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectMeshes"" WHERE ""ModelId"" = @modelId AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { modelId, projectId });
        }

        public async Task UpdatePromptAsync(Guid id, Guid projectId, string prompt)
        {
            const string query = @"UPDATE public.""ProjectMeshes"" SET ""Prompt"" = @prompt WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId, prompt });
        }
    }
}
