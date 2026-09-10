using TextureGen3D.Upscaler.Services;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddHostedService<UpscalerWorker>();

builder.Services.Configure<UpscalerOptions>(
    builder.Configuration.GetSection("Upscaler"));

var host = builder.Build();

host.Run();
