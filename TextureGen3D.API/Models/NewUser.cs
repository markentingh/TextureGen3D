namespace TextureGen3D.API.Models
{
    public class NewUser
    {
        public string Email { get; set; } = "";
        public string FullName { get; set; } = "";
        public string Password { get; set; } = "";
        public bool IsAdmin { get; set; } = false;
    }
}
