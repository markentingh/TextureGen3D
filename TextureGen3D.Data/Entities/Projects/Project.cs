namespace TextureGen3D.Data.Entities.Projects
{
    public class Project
    {
        public Guid Id { get; set; }
        public Guid AppUserId { get; set; }
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string Key { get; set; } = "";
        public string Color { get; set; } = "";
        public int Status { get; set; }
        public DateTime Created { get; set; }
    }
}
