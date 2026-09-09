using TextureGen3D.Data.Interfaces.Auth;
using TextureGen3D.Data.Repositories.Auth;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using System.Data;

namespace TextureGen3D.Data.Services
{
    public static class DapperStartupService
    {
        public static void AddDapperStartupService(this WebApplicationBuilder builder)
        {
            builder.Services.AddTransient<IDbConnection>((sp) => new NpgsqlConnection(builder.Configuration["ConnectionStrings:Database"] ?? ""));

            builder.Services.AddTransient<IAppUserRepository, AppUserRepository>();
            builder.Services.AddTransient<IAppRoleRepository, AppRoleRepository>();
            builder.Services.AddTransient<IAppUserRolesRepository, AppUserRolesRepository>();
            builder.Services.AddTransient<IAppUserTokenRepository, AppUserTokenRepository>();
        }
    }
}
