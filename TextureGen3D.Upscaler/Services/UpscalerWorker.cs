using System.Net;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OpenCvSharp;

namespace TextureGen3D.Upscaler.Services;

public class UpscalerWorker : BackgroundService
{
    readonly ILogger<UpscalerWorker> _logger;
    readonly UpscalerOptions _options;
    readonly UpscaleEngine _engine;
    readonly SemaphoreSlim _upscaleLock = new(1, 1);
    HttpListener? _listener;

    public UpscalerWorker(ILogger<UpscalerWorker> logger, IOptions<UpscalerOptions> options)
    {
        _logger = logger;
        _options = options.Value;
        _engine = new UpscaleEngine(_logger, _options.ModelsDir);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _engine.EnsureModel();
        _engine.LoadModel();

        var prefix = $"http://localhost:{_options.Port}/";
        _listener = new HttpListener();
        _listener.Prefixes.Add(prefix);

        try
        {
            _listener.Start();
            _logger.LogInformation("TextureGen3D Upscaler listening on port {Port}", _options.Port);
        }
        catch (HttpListenerException ex)
        {
            _logger.LogError(ex, "Failed to start HttpListener on port {Port}. Try running as administrator.", _options.Port);
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            HttpListenerContext ctx;
            try
            {
                var getContextTask = _listener.GetContextAsync();
                var tcs = new TaskCompletionSource<HttpListenerContext>();
                stoppingToken.Register(() => tcs.TrySetCanceled());
                _ = getContextTask.ContinueWith(t => tcs.TrySetResult(t.Result), TaskContinuationOptions.NotOnFaulted | TaskContinuationOptions.NotOnCanceled);
                ctx = await tcs.Task;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (HttpListenerException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            _ = Task.Run(() => HandleRequestAsync(ctx, stoppingToken), stoppingToken);
        }

        _listener.Stop();
    }

    async Task HandleRequestAsync(HttpListenerContext ctx, CancellationToken ct)
    {
        var path = ctx.Request.Url?.AbsolutePath ?? "/";

        try
        {
            if (path == "/health" && ctx.Request.HttpMethod == "GET")
            {
                ctx.Response.StatusCode = 200;
                await ctx.Response.OutputStream.WriteAsync(System.Text.Encoding.UTF8.GetBytes("ok"), ct);
                ctx.Response.Close();
                return;
            }

            if (path == "/upscale" && ctx.Request.HttpMethod == "POST")
            {
                _logger.LogInformation("Connection received: POST {Path}", path);

                var scale = 2;
                var query = ctx.Request.QueryString;
                if (!string.IsNullOrWhiteSpace(query["scale"]) && int.TryParse(query["scale"], out var parsedScale))
                {
                    scale = parsedScale == 4 ? 4 : 2;
                }

                using var ms = new MemoryStream();
                await ctx.Request.InputStream.CopyToAsync(ms, ct);
                var inputBytes = ms.ToArray();

                if (inputBytes.Length == 0)
                {
                    ctx.Response.StatusCode = 400;
                    ctx.Response.Close();
                    return;
                }

                _logger.LogInformation("Received upscale request: {Bytes} bytes (scale={Scale})", inputBytes.Length, scale);

                await _upscaleLock.WaitAsync(ct);
                byte[] result;
                try
                {
                    result = _engine.Upscale(inputBytes, scale);
                }
                finally
                {
                    _upscaleLock.Release();
                }

                ctx.Response.StatusCode = 200;
                ctx.Response.ContentType = "application/octet-stream";
                ctx.Response.ContentLength64 = result.Length;
                await ctx.Response.OutputStream.WriteAsync(result, ct);
                ctx.Response.Close();

                _logger.LogInformation("Sent upscaled response: {Bytes} bytes", result.Length);
                return;
            }

            ctx.Response.StatusCode = 404;
            ctx.Response.Close();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling request {Path}", path);
            try
            {
                ctx.Response.StatusCode = 500;
                var msg = System.Text.Encoding.UTF8.GetBytes(ex.Message);
                await ctx.Response.OutputStream.WriteAsync(msg, ct);
            }
            catch { }
            ctx.Response.Close();
        }
    }

    public override void Dispose()
    {
        _engine.Dispose();
        _listener?.Close();
        _upscaleLock.Dispose();
        base.Dispose();
        GC.SuppressFinalize(this);
    }
}
