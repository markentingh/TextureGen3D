using TextureGen3D.Data.Services;
using Microsoft.AspNetCore.Builder;

namespace TextureGen3D.API.Services
{
    public static class ApiStartupService
    {
        public static void AddApiStartupService(this WebApplicationBuilder builder)
        {
            builder.AddDapperStartupService();
        }
    }
}
