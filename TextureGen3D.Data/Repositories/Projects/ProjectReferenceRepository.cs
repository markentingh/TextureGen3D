using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.Data.Repositories.Projects
{
    public class ProjectReferenceRepository : IProjectReferenceRepository
    {
        readonly IDbConnection _dbConnection;

        public ProjectReferenceRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<ProjectReference> CreateAsync(ProjectReference reference)
        {
            if (reference.Id == Guid.Empty)
            {
                reference.Id = Guid.NewGuid();
            }
            if (reference.Created == default)
            {
                reference.Created = DateTime.UtcNow;
            }
            const string query = @"
                INSERT INTO public.""ProjectReferences"" (""Id"", ""ProjectId"", ""Filename"", ""Extension"", ""FileSize"", ""Width"", ""Height"", ""Active"", ""Created"")
                VALUES (@Id, @ProjectId, @Filename, @Extension, @FileSize, @Width, @Height, @Active, @Created)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<ProjectReference>(query, reference);
        }

        public async Task<ProjectReference?> GetByIdAsync(Guid id, Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectReferences"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            return await _dbConnection.QueryFirstOrDefaultAsync<ProjectReference>(query, new { id, projectId });
        }

        public async Task<IEnumerable<ProjectReference>> GetByProjectIdAsync(Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectReferences"" WHERE ""ProjectId"" = @projectId ORDER BY ""Created"" DESC";
            return await _dbConnection.QueryAsync<ProjectReference>(query, new { projectId });
        }

        public async Task UpdateActiveAsync(Guid id, Guid projectId, bool active)
        {
            const string query = @"UPDATE public.""ProjectReferences"" SET ""Active"" = @active WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId, active });
        }

        public async Task UpdateAsync(ProjectReference reference)
        {
            const string query = @"
                UPDATE public.""ProjectReferences"" 
                SET ""Filename"" = @Filename, ""Extension"" = @Extension, ""FileSize"" = @FileSize, 
                    ""Width"" = @Width, ""Height"" = @Height, ""Active"" = @Active
                WHERE ""Id"" = @Id AND ""ProjectId"" = @ProjectId";
            await _dbConnection.ExecuteAsync(query, reference);
        }

        public async Task DeleteAsync(Guid id, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectReferences"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId });
        }
    }
}
