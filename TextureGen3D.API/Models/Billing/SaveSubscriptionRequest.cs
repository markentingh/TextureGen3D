namespace TextureGen3D.API.Models.Billing
{
    public class SaveSubscriptionRequest
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public int? MonthlyProductId { get; set; }
        public int? YearlyProductId { get; set; }
        public string? FeaturesJson { get; set; }
        public int Status { get; set; } = 1;
    }
}
