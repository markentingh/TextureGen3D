namespace TextureGen3D.Data.Entities.Billing
{
    public class AppUserAIToken
    {
        public int Id { get; set; }
        public Guid AppUserId { get; set; }
        public int? InvoiceId { get; set; }
        public DateTime BillingMonth { get; set; }
        public int Tokens { get; set; }
        public int TokensUsed { get; set; }
        public DateTime DateCreated { get; set; }
    }
}
