namespace TextureGen3D.Data.Entities.Projects
{
    public class ProjectMeshReference
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public Guid ProjectMeshId { get; set; }
        public Guid ProjectReferenceId { get; set; }
        public bool Active { get; set; } = true;
        public DateTime Created { get; set; }
    }
}
