namespace TextureGen3D.Data.Entities.Projects
{
    public class DailyCostResult
    {
        public DateTime Date { get; set; }
        public int TotalCost { get; set; }
        public int UpscaleCost { get; set; }
        public int TotalTokens { get; set; }
        public int TotalInputTextTokens { get; set; }
        public int TotalInputImageTokens { get; set; }
        public int TotalOutputTokens { get; set; }
        public int TotalGenerations { get; set; }
    }
}
