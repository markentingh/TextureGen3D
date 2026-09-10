using TextureGen3D.Data.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

namespace TextureGen3D.API.Services
{
    public static class ApiStartupService
    {
        public static void AddApiStartupService(this WebApplicationBuilder builder)
        {
            builder.AddDapperStartupService();

            builder.Services.AddHttpClient("ImageGeneration", c => c.Timeout = TimeSpan.FromMinutes(5));
            builder.Services.AddHttpClient("Upscaler", c => c.Timeout = TimeSpan.FromMinutes(5));

            builder.Services.Configure<ImageGenerationOptions>(builder.Configuration.GetSection("ImageGeneration"));
            builder.Services.Configure<TokenCostOptions>(builder.Configuration.GetSection("Tokens"));
            builder.Services.Configure<UpscalerOptions>(builder.Configuration.GetSection("Upscaler"));

            builder.Services.AddTransient<IImageGeneration, ImageGenerationForOpenAI>();
            builder.Services.AddTransient<IImageUpscaler, ImageUpscaler>();
            builder.Services.AddTransient<IImageTokens>(sp => new ImageTokensForOpenAI(0m, 0m, 0m));
            builder.Services.AddScoped<IImageService, ImageService>();
            builder.Services.AddScoped<IAITokenService, AITokenService>();
        }
    }
}
