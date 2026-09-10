namespace TextureGen3D.Data.Entities.Billing
{
    public class Subscription
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public int? MonthlyProductId { get; set; }
        public int? YearlyProductId { get; set; }
        public bool Archived { get; set; }
        public int Status { get; set; } = 1;
        public string? FeaturesJson { get; set; }
        public int SortIndex { get; set; }
        public bool Featured { get; set; }
        public DateTime DateCreated { get; set; }
    }
}
