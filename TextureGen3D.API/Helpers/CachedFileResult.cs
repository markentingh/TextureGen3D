using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace TextureGen3D.API.Helpers;

public static class CachedFileResult
{
    /// <summary>
    /// FileContentResult carrying a content-hash ETag + Cache-Control:
    /// no-cache — browsers revalidate with If-None-Match and get a cheap
    /// 304 instead of re-downloading unchanged images. The client busts
    /// genuinely-changed files via its ?r=&lt;version&gt; query param, so
    /// a stable URL always means the same bytes.
    /// </summary>
    public static FileContentResult CachedFile(this ControllerBase controller, byte[] data, string contentType)
    {
        controller.Response.Headers.CacheControl = "no-cache";
        return new FileContentResult(data, contentType)
        {
            EnableRangeProcessing = true,
            EntityTag = new EntityTagHeaderValue($"\"{Convert.ToHexString(SHA256.HashData(data))}\"")
        };
    }
}
