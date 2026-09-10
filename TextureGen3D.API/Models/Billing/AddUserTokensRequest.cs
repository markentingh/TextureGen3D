namespace TextureGen3D.API.Models.Billing
{
    public class AddUserTokensRequest
    {
        public Guid AppUserId { get; set; }
        public int ProductId { get; set; }
    }
}
