using System.ComponentModel.DataAnnotations.Schema;

namespace TextureGen3D.Data.Entities.Auth
{
    [Table("AppUserTokens")]
    public class AppUserTokens
    {
        public int Id { get; set; }
        public Guid? AppUserId { get; set; }
        public string Token { get; set; } = "";
        public DateTime Expiry { get; set; }
        public DateTime Created { get; set; }
        public string IPAddress { get; set; } = "";
        [NotMapped]
        public bool IsActive => Expiry > DateTime.UtcNow;
    }
}
