using System.ComponentModel.DataAnnotations.Schema;

namespace TextureGen3D.Data.Entities.Auth
{
    [Table("AppUserRoles")]
    public class AppUserRole
    {
        public int Id { get; set; }
        public Guid AppUserId { get; set; }
        public int AppRoleId { get; set; }
        [NotMapped]
        public AppRole AppRole { get; set; } = new AppRole();
    }
}
