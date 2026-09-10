namespace TextureGen3D.API.Models.Billing
{
    public class StartUserSubscriptionRequest
    {
        public Guid AppUserId { get; set; }
        public int SubscriptionId { get; set; }
        public string Period { get; set; } = "monthly";
    }
}
