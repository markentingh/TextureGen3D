namespace TextureGen3D.API.Models
{
    public class UpdateUser
    {
        public Guid Id { get; set; }
        public string FullName { get; set; } = "";
        public string Email { get; set; } = "";
        public int Status { get; set; }
        public string Password { get; set; } = "";
    }
}
