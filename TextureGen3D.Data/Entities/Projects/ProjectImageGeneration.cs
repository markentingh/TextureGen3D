namespace TextureGen3D.Data.Entities.Projects
{
    public class ProjectImageGeneration
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public Guid? AppUserId { get; set; }
        public int? ImageGenerationId { get; set; }
        public int InputTextTokens { get; set; }
        public int InputImageTokens { get; set; }
        public int OutputTokens { get; set; }
        public int Tokens { get; set; }
        public string Prompt { get; set; } = "";
        public string Filename { get; set; } = "";
        public string Resolution { get; set; } = "";
        public int InputImages { get; set; }
        public string InputImageJson { get; set; } = "[]";
        public int Type { get; set; }
        public int Cost { get; set; }
        public int DateYear { get; set; }
        public int DateMonth { get; set; }
        public int DateDay { get; set; }
        public DateTime DateCreated { get; set; }
    }
}
