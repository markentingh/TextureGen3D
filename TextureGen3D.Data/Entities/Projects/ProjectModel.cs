namespace TextureGen3D.Data.Entities.Projects
{
    public class ProjectModel
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public string Filename { get; set; } = "";
        public string Extension { get; set; } = "";
        public int FileSize { get; set; }
        public DateTime Created { get; set; }
    }
}
