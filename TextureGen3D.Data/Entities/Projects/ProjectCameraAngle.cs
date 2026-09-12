namespace TextureGen3D.Data.Entities.Projects
{
    public class ProjectCameraAngle
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public Guid ModelId { get; set; }
        public Guid MeshId { get; set; }
        public string Rotation { get; set; } = "{}";
        public DateTime Created { get; set; }
    }
}
