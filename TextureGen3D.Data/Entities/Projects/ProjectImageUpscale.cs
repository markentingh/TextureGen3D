namespace TextureGen3D.Data.Entities.Projects
{
    public class ProjectImageUpscale
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public int Scale { get; set; }
        public DateTime Created { get; set; }
    }
}
