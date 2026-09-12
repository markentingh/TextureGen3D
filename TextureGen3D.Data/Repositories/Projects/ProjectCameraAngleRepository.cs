using Dapper;
using System.Data;
using TextureGen3D.Data.Entities.Projects;
using TextureGen3D.Data.Interfaces.Projects;

namespace TextureGen3D.Data.Repositories.Projects
{
    public class ProjectCameraAngleRepository : IProjectCameraAngleRepository
    {
        readonly IDbConnection _dbConnection;

        public ProjectCameraAngleRepository(IDbConnection dbConnection)
        {
            _dbConnection = dbConnection;
        }

        public async Task<ProjectCameraAngle> CreateAsync(ProjectCameraAngle angle)
        {
            if (angle.Id == Guid.Empty)
                angle.Id = Guid.NewGuid();
            if (angle.Created == default)
                angle.Created = DateTime.UtcNow;

            const string query = @"
                INSERT INTO public.""ProjectCameraAngles"" (""Id"", ""ProjectId"", ""ModelId"", ""MeshId"", ""Rotation"", ""Created"")
                VALUES (@Id, @ProjectId, @ModelId, @MeshId, @Rotation, @Created)
                RETURNING *";
            return await _dbConnection.QueryFirstAsync<ProjectCameraAngle>(query, angle);
        }

        public async Task<ProjectCameraAngle?> GetByIdAsync(Guid id, Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectCameraAngles"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            return await _dbConnection.QueryFirstOrDefaultAsync<ProjectCameraAngle>(query, new { id, projectId });
        }

        public async Task<IEnumerable<ProjectCameraAngle>> GetByMeshIdAsync(Guid meshId, Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectCameraAngles"" WHERE ""MeshId"" = @meshId AND ""ProjectId"" = @projectId ORDER BY ""Created"" ASC";
            return await _dbConnection.QueryAsync<ProjectCameraAngle>(query, new { meshId, projectId });
        }

        public async Task<IEnumerable<ProjectCameraAngle>> GetByProjectIdAsync(Guid projectId)
        {
            const string query = @"SELECT * FROM public.""ProjectCameraAngles"" WHERE ""ProjectId"" = @projectId ORDER BY ""Created"" ASC";
            return await _dbConnection.QueryAsync<ProjectCameraAngle>(query, new { projectId });
        }

        public async Task DeleteAsync(Guid id, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectCameraAngles"" WHERE ""Id"" = @id AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { id, projectId });
        }

        public async Task DeleteByMeshIdAsync(Guid meshId, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectCameraAngles"" WHERE ""MeshId"" = @meshId AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { meshId, projectId });
        }

        public async Task DeleteByModelIdAsync(Guid modelId, Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectCameraAngles"" WHERE ""ModelId"" = @modelId AND ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { modelId, projectId });
        }

        public async Task DeleteByProjectIdAsync(Guid projectId)
        {
            const string query = @"DELETE FROM public.""ProjectCameraAngles"" WHERE ""ProjectId"" = @projectId";
            await _dbConnection.ExecuteAsync(query, new { projectId });
        }
    }
}
