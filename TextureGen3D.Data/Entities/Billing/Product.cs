namespace TextureGen3D.Data.Entities.Billing
{
    public class Product
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public int Price { get; set; }
        public int Tokens { get; set; }
        public bool Archived { get; set; }
        public DateTime DateCreated { get; set; }
    }
}
