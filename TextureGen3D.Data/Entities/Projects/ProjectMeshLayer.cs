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
        // 0 = plain, 1 = Generated, 2 = Inpainted, 3 = Flattened
        public int Type { get; set; }
        public Guid? ReferenceId { get; set; }
        public DateTime Created { get; set; }
    }
}
