namespace TextureGen3D.API.Models.Billing
{
    public class SaveProductRequest
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public int Price { get; set; }
        public int Tokens { get; set; }
    }
}
