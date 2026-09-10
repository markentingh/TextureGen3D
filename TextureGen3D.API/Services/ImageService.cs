using Azure.Storage.Blobs;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Processing;

namespace TextureGen3D.API.Services
{
    public interface IImageService
    {
        Task<byte[]> GenerateThumbnailAsync(byte[] imageData, int size = 350);
        Task SaveProjectThumbAsync(Guid projectId, byte[] imageData);
        Task<byte[]> GetProjectThumbAsync(Guid projectId);
        Task<bool> HasProjectThumbAsync(Guid projectId);
        Task SaveProjectImageGenerationAsync(Guid projectId, Guid generationId, byte[] imageData);
        Task<byte[]> GetProjectImageGenerationAsync(Guid projectId, Guid generationId);
        Task SaveProjectModelAsync(Guid projectId, Guid modelId, string extension, byte[] fileData);
        Task<byte[]> GetProjectModelAsync(Guid projectId, Guid modelId, string extension);
        Task DeleteProjectModelAsync(Guid projectId, Guid modelId, string extension);
        Task<(int width, int height)?> GetImageDimensionsAsync(byte[] imageBytes);
        Task<byte[]> ResizeImageAsync(byte[] imageData, int maxWidth);
        Task<byte[]> ResizeImageMaxAsync(byte[] imageData, int maxSize);
    }

    public class ImageService : IImageService
    {
        readonly IConfiguration _configuration;
        readonly IWebHostEnvironment _environment;
        readonly string _activeStorage;

        public ImageService(IConfiguration configuration, IWebHostEnvironment environment)
        {
            _configuration = configuration;
            _environment = environment;
            _activeStorage = (_configuration["Storage:Active"] ?? "filesystem").ToLowerInvariant();
        }

        public async Task<byte[]> GenerateThumbnailAsync(byte[] imageData, int size = 350)
        {
            using var image = Image.Load(imageData);
            image.Mutate(x => x.Resize(new ResizeOptions
            {
                Size = new Size(size, size),
                Mode = ResizeMode.Max
            }));

            using var ms = new MemoryStream();
            await image.SaveAsync(ms, new JpegEncoder { Quality = 85 });
            return ms.ToArray();
        }

        public async Task SaveProjectThumbAsync(Guid projectId, byte[] imageData)
        {
            var relativePath = Path.Combine("projects", projectId.ToString(), "thumb.jpg");
            var thumbData = await GenerateThumbnailAsync(imageData);

            if (_activeStorage == "azure")
            {
                await SaveToAzureBlobAsync(relativePath, thumbData);
                return;
            }

            await SaveToFileSystemAsync(relativePath, thumbData);
        }

        public async Task<byte[]> GetProjectThumbAsync(Guid projectId)
        {
            var relativePath = Path.Combine("projects", projectId.ToString(), "thumb.jpg");

            if (_activeStorage == "azure")
                return await GetFromAzureBlobAsync(relativePath);

            return await GetFromFileSystemAsync(relativePath);
        }

        public async Task<bool> HasProjectThumbAsync(Guid projectId)
        {
            var relativePath = Path.Combine("projects", projectId.ToString(), "thumb.jpg");

            if (_activeStorage == "azure")
            {
                var blobClient = await GetAzureBlobClientAsync(relativePath);
                return await blobClient.ExistsAsync();
            }

            var fullPath = GetFileSystemPath(relativePath);
            return File.Exists(fullPath);
        }

        public async Task SaveProjectImageGenerationAsync(Guid projectId, Guid generationId, byte[] imageData)
        {
            var relativePath = Path.Combine("projects", projectId.ToString(), "generations", $"{generationId}.jpg");

            if (_activeStorage == "azure")
            {
                await SaveToAzureBlobAsync(relativePath, imageData);
                return;
            }

            await SaveToFileSystemAsync(relativePath, imageData);
        }

        public async Task<byte[]> GetProjectImageGenerationAsync(Guid projectId, Guid generationId)
        {
            var relativePath = Path.Combine("projects", projectId.ToString(), "generations", $"{generationId}.jpg");

            if (_activeStorage == "azure")
                return await GetFromAzureBlobAsync(relativePath);

            return await GetFromFileSystemAsync(relativePath);
        }

        public async Task SaveProjectModelAsync(Guid projectId, Guid modelId, string extension, byte[] fileData)
        {
            var relativePath = Path.Combine("projects", projectId.ToString(), "models", $"{modelId}.{extension}");

            if (_activeStorage == "azure")
            {
                await SaveToAzureBlobAsync(relativePath, fileData);
                return;
            }

            await SaveToFileSystemAsync(relativePath, fileData);
        }

        public async Task<byte[]> GetProjectModelAsync(Guid projectId, Guid modelId, string extension)
        {
            var relativePath = Path.Combine("projects", projectId.ToString(), "models", $"{modelId}.{extension}");

            if (_activeStorage == "azure")
                return await GetFromAzureBlobAsync(relativePath);

            return await GetFromFileSystemAsync(relativePath);
        }

        public async Task DeleteProjectModelAsync(Guid projectId, Guid modelId, string extension)
        {
            var relativePath = Path.Combine("projects", projectId.ToString(), "models", $"{modelId}.{extension}");

            if (_activeStorage == "azure")
            {
                await DeleteFromAzureBlobAsync(relativePath);
                return;
            }

            await DeleteFromFileSystemAsync(relativePath);
        }

        public async Task<(int width, int height)?> GetImageDimensionsAsync(byte[] imageBytes)
        {
            try
            {
                using var image = Image.Load(imageBytes);
                return (image.Width, image.Height);
            }
            catch
            {
                return null;
            }
        }

        public async Task<byte[]> ResizeImageAsync(byte[] imageData, int maxWidth)
        {
            using var image = Image.Load(imageData);
            if (image.Width <= maxWidth)
                return imageData;

            image.Mutate(x => x.Resize(new ResizeOptions
            {
                Size = new Size(maxWidth, 0),
                Mode = ResizeMode.Max
            }));

            using var ms = new MemoryStream();
            await image.SaveAsync(ms, new JpegEncoder { Quality = 90 });
            return ms.ToArray();
        }

        public async Task<byte[]> ResizeImageMaxAsync(byte[] imageData, int maxSize)
        {
            using var image = Image.Load(imageData);
            var maxDimension = Math.Max(image.Width, image.Height);
            if (maxDimension <= maxSize)
                return imageData;

            image.Mutate(x => x.Resize(new ResizeOptions
            {
                Size = new Size(maxSize, maxSize),
                Mode = ResizeMode.Max
            }));

            using var ms = new MemoryStream();
            await image.SaveAsync(ms, new PngEncoder());
            return ms.ToArray();
        }

        #region Storage helpers

        string GetFileSystemPath(string relativePath)
        {
            var storagePath = _configuration["Storage:FileSystem:Path"] ?? "storage";
            return Path.Combine(_environment.ContentRootPath, storagePath, relativePath);
        }

        async Task SaveToFileSystemAsync(string relativePath, byte[] data)
        {
            var fullPath = GetFileSystemPath(relativePath);
            var dir = Path.GetDirectoryName(fullPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            await File.WriteAllBytesAsync(fullPath, data);
        }

        async Task<byte[]> GetFromFileSystemAsync(string relativePath)
        {
            var fullPath = GetFileSystemPath(relativePath);
            if (!File.Exists(fullPath))
                return Array.Empty<byte>();
            return await File.ReadAllBytesAsync(fullPath);
        }

        async Task DeleteFromFileSystemAsync(string relativePath)
        {
            var fullPath = GetFileSystemPath(relativePath);
            if (File.Exists(fullPath))
                File.Delete(fullPath);
            await Task.CompletedTask;
        }

        string GetAzureConnectionString() => _configuration["Storage:Azure:ConnectionString"] ?? "";
        string GetAzureContainerName() => _configuration["Storage:Azure:Container"] ?? "texturegen3d";

        async Task<BlobClient> GetAzureBlobClientAsync(string relativePath)
        {
            var blobServiceClient = new BlobServiceClient(GetAzureConnectionString());
            var containerClient = blobServiceClient.GetBlobContainerClient(GetAzureContainerName());
            await containerClient.CreateIfNotExistsAsync();
            return containerClient.GetBlobClient(relativePath.Replace('\\', '/'));
        }

        async Task SaveToAzureBlobAsync(string relativePath, byte[] data)
        {
            var blobClient = await GetAzureBlobClientAsync(relativePath);
            using var ms = new MemoryStream(data);
            await blobClient.UploadAsync(ms, overwrite: true);
        }

        async Task<byte[]> GetFromAzureBlobAsync(string relativePath)
        {
            var blobClient = await GetAzureBlobClientAsync(relativePath);
            if (!await blobClient.ExistsAsync())
                return Array.Empty<byte>();

            var response = await blobClient.DownloadContentAsync();
            return response.Value.Content.ToArray();
        }

        async Task DeleteFromAzureBlobAsync(string relativePath)
        {
            var blobClient = await GetAzureBlobClientAsync(relativePath);
            await blobClient.DeleteIfExistsAsync();
        }

        #endregion
    }
}
