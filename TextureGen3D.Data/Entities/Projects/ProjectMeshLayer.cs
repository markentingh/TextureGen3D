namespace TextureGen3D.Data.Entities.Projects
{
    public class ProjectMeshLayer
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public Guid ProjectMeshId { get; set; }
        public string Name { get; set; } = "";
        public int Index { get; set; }
        public DateTime Created { get; set; }
    }
}
