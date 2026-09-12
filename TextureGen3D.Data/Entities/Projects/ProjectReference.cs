namespace TextureGen3D.Data.Entities.Projects
{
    public class ProjectReference
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public string Filename { get; set; } = "";
        public string Extension { get; set; } = "png";
        public int FileSize { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public bool Active { get; set; } = true;
        public DateTime Created { get; set; }
    }
}
