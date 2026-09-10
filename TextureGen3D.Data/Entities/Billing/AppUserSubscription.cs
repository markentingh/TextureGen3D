namespace TextureGen3D.Data.Entities.Billing
{
    public class AppUserSubscription
    {
        public int Id { get; set; }
        public Guid AppUserId { get; set; }
        public int SubscriptionId { get; set; }
        public DateTime StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public bool Cancelled { get; set; }
        public DateTime DateCreated { get; set; }
    }
}
