using Microsoft.Extensions.Logging;
using OpenCvSharp;
using OpenCvSharp.DnnSuperres;

namespace TextureGen3D.Upscaler.Services;

public class UpscaleEngine : IDisposable
{
    readonly ILogger _logger;
    readonly string _modelsDir;
    readonly object _lock = new();
    DnnSuperResImpl? _superResX2;
    DnnSuperResImpl? _superResX4;
    bool _disposed;

    const string ModelUrlX2 = "https://github.com/fannymonori/TF-LapSRN/raw/refs/heads/master/export/LapSRN_x2.pb";
    const string ModelFileX2 = "LapSRN_x2.pb";
    const string ModelUrlX4 = "https://github.com/fannymonori/TF-LapSRN/raw/refs/heads/master/export/LapSRN_x4.pb";
    const string ModelFileX4 = "LapSRN_x4.pb";

    public UpscaleEngine(ILogger logger, string modelsDir)
    {
        _logger = logger;
        _modelsDir = modelsDir;
    }

    public void EnsureModel()
    {
        var dir = Path.GetFullPath(_modelsDir);
        if (!Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        EnsureSingleModel(dir, ModelUrlX2, ModelFileX2);
        EnsureSingleModel(dir, ModelUrlX4, ModelFileX4);
    }

    void EnsureSingleModel(string dir, string url, string file)
    {
        var modelPath = Path.Combine(dir, file);
        if (File.Exists(modelPath))
        {
            _logger.LogInformation("Model already exists at {Path}", modelPath);
            return;
        }

        _logger.LogInformation("Downloading model from {Url}", url);

        using var client = new HttpClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        var bytes = client.GetByteArrayAsync(url).GetAwaiter().GetResult();
        File.WriteAllBytes(modelPath, bytes);

        _logger.LogInformation("Model saved to {Path} ({Bytes} bytes)", modelPath, bytes.Length);
    }

    public void LoadModel()
    {
        var dir = Path.GetFullPath(_modelsDir);

        var x2Path = Path.Combine(dir, ModelFileX2);
        if (!File.Exists(x2Path))
            throw new FileNotFoundException($"Model file not found: {x2Path}");
        _superResX2 = new DnnSuperResImpl("lapsrn", 2);
        _superResX2.ReadModel(x2Path);
        _logger.LogInformation("LapSRN x2 model loaded");

        var x4Path = Path.Combine(dir, ModelFileX4);
        if (!File.Exists(x4Path))
            throw new FileNotFoundException($"Model file not found: {x4Path}");
        _superResX4 = new DnnSuperResImpl("lapsrn", 4);
        _superResX4.ReadModel(x4Path);
        _logger.LogInformation("LapSRN x4 model loaded");
    }

    public byte[] Upscale(byte[] inputBytes, int scale = 2)
    {
        lock (_lock)
        {
            var model = scale == 4 ? _superResX4 : _superResX2;
            if (model == null)
                throw new InvalidOperationException("Model not loaded. Call LoadModel() first.");

            using var inputMat = Cv2.ImDecode(inputBytes, ImreadModes.Color);
            if (inputMat.Empty())
                throw new ArgumentException("Failed to decode input image.");

            _logger.LogInformation("Decoded input image: {Width}x{Height} (scale={Scale})", inputMat.Width, inputMat.Height, scale);

            using var outputMat = new Mat();
            model.Upsample(inputMat, outputMat);

            if (outputMat.Empty())
                throw new InvalidOperationException("Upscaling produced an empty image.");

            _logger.LogInformation("Upscaled to {Width}x{Height}", outputMat.Width, outputMat.Height);

            Cv2.ImEncode(".png", outputMat, out var resultBytes);
            _logger.LogInformation("Encoded output to PNG: {Bytes} bytes", resultBytes.Length);

            return resultBytes;
        }
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _superResX2?.Dispose();
            _superResX4?.Dispose();
            _disposed = true;
        }
        GC.SuppressFinalize(this);
    }
}
