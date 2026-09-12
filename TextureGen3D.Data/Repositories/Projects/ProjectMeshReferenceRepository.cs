using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.Data.Repositories.Projects
{
    public class ProjectMeshReferenceRepository : IProjectMeshReferenceRepository
    {
        readonly IDbConnection _dbConnection;

        public ProjectMeshReferenceRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<ProjectMeshReference> CreateAsync(ProjectMeshReference meshRef)
        {
            if (meshRef.Id == Guid.Empty)
                meshRef.Id = Guid.NewGuid();
            if (meshRef.Created == default)
                meshRef.Created = DateTime.UtcNow;

            const string query = @"
                INSERT INTO public.""ProjectMeshReferences"" (""Id"", ""ProjectId"", ""ProjectMeshId"", ""ProjectReferenceId"", ""Active"", ""Created"")
                VALUES (@Id, @ProjectId, @ProjectMeshId, @ProjectReferenceId, @Active, @Created)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<ProjectMeshReference>(query, meshRef);
        }

        public async Task<IEnumerable<ProjectMeshReference>> GetByMeshIdAsync(Guid meshId, Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectMeshReferences"" WHERE ""ProjectMeshId"" = @meshId AND ""ProjectId"" = @projectId ORDER BY ""Created"" ASC";
            return await _dbConnection.QueryAsync<ProjectMeshReference>(query, new { meshId, projectId });
        }

        public async Task<ProjectMeshReference?> GetByMeshAndReferenceAsync(Guid meshId, Guid referenceId, Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectMeshReferences"" WHERE ""ProjectMeshId"" = @meshId AND ""ProjectReferenceId"" = @referenceId AND ""ProjectId"" = @projectId";
            return await _dbConnection.QueryFirstOrDefaultAsync<ProjectMeshReference>(query, new { meshId, referenceId, projectId });
        }

        public async Task UpdateActiveAsync(Guid id, Guid projectId, bool active)
        {
            const string query = @"UPDATE public.""ProjectMeshReferences"" SET ""Active"" = @active WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId, active });
        }

        public async Task DeleteAsync(Guid id, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectMeshReferences"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId });
        }

        public async Task DeleteByMeshIdAsync(Guid meshId, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectMeshReferences"" WHERE ""ProjectMeshId"" = @meshId AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { meshId, projectId });
        }

        public async Task DeleteByReferenceIdAsync(Guid referenceId, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectMeshReferences"" WHERE ""ProjectReferenceId"" = @referenceId AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { referenceId, projectId });
        }
    }
}
