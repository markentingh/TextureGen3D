namespace TextureGen3D.API.Models.ImageGeneration
{
    public class SaveImageGenerationModelRequest
    {
        public int Id { get; set; }
        public string ModelKey { get; set; } = "";
        public string Name { get; set; } = "";
        public string Model { get; set; } = "";
        public decimal CPMITTokens { get; set; }
        public decimal CPMIITokens { get; set; }
        public decimal CPMOTokens { get; set; }
        public int Type { get; set; }
        public decimal CP1K { get; set; }
        public decimal CP2K { get; set; }
        public decimal CP4K { get; set; }
        public decimal CP8K { get; set; }
        public bool Active { get; set; } = true;
    }

    public class ToggleActiveRequest
    {
        public int Id { get; set; }
        public bool Active { get; set; }
    }

    public class DeleteImageGenerationModelRequest
    {
        public int Id { get; set; }
    }
}
