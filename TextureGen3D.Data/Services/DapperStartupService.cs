using TextureGen3D.Data.Interfaces;
using TextureGen3D.Data.Interfaces.Auth;
using TextureGen3D.Data.Interfaces.Billing;
using TextureGen3D.Data.Interfaces.Projects;
using TextureGen3D.Data.Repositories;
using TextureGen3D.Data.Repositories.Auth;
using TextureGen3D.Data.Repositories.Billing;
using TextureGen3D.Data.Repositories.Projects;
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

            // Auth
            builder.Services.AddTransient<IAppUserRepository, AppUserRepository>();
            builder.Services.AddTransient<IAppRoleRepository, AppRoleRepository>();
            builder.Services.AddTransient<IAppUserRolesRepository, AppUserRolesRepository>();
            builder.Services.AddTransient<IAppUserTokenRepository, AppUserTokenRepository>();

            // Projects
            builder.Services.AddTransient<IProjectRepository, ProjectRepository>();
            builder.Services.AddTransient<IProjectImageGenerationRepository, ProjectImageGenerationRepository>();
            builder.Services.AddTransient<IProjectImageUpscaleRepository, ProjectImageUpscaleRepository>();
            builder.Services.AddTransient<IProjectModelRepository, ProjectModelRepository>();
            builder.Services.AddTransient<IProjectMeshRepository, ProjectMeshRepository>();
            builder.Services.AddTransient<IProjectCameraAngleRepository, ProjectCameraAngleRepository>();
            builder.Services.AddTransient<IProjectReferenceRepository, ProjectReferenceRepository>();
            builder.Services.AddTransient<IProjectMeshReferenceRepository, ProjectMeshReferenceRepository>();
            builder.Services.AddTransient<IProjectMeshLayerRepository, ProjectMeshLayerRepository>();

            // Billing
            builder.Services.AddTransient<IProductRepository, ProductRepository>();
            builder.Services.AddTransient<ISubscriptionRepository, SubscriptionRepository>();
            builder.Services.AddTransient<IInvoiceRepository, InvoiceRepository>();
            builder.Services.AddTransient<IAppUserSubscriptionRepository, AppUserSubscriptionRepository>();
            builder.Services.AddTransient<IAppUserAITokenRepository, AppUserAITokenRepository>();

            // LLM / Image Generation Models
            builder.Services.AddTransient<ILLMModelsRepository, LLMModelsRepository>();
            builder.Services.AddTransient<IImageGenerationModelRepository, ImageGenerationModelRepository>();
        }
    }
}
