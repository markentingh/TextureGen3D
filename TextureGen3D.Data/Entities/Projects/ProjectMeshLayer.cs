namespace TextureGen3D.Data.Entities.Projects
{
    public class ProjectMeshLayer
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public Guid ProjectMeshId { get; set; }
        public string Name { get; set; } = "";
        public int Index { get; set; }
        public string CameraAngle { get; set; } = "";
        public bool Visible { get; set; } = true;
        public DateTime Created { get; set; }
    }
}
