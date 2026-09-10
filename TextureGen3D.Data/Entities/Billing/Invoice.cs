namespace TextureGen3D.Data.Entities.Billing
{
    public class Invoice
    {
        public int Id { get; set; }
        public Guid AppUserId { get; set; }
        public int SubscriptionId { get; set; }
        public int ProductId { get; set; }
        public int Price { get; set; }
        public DateTime DateCreated { get; set; }
    }
}
