using Microsoft.ML.Tokenizers;

namespace TextureGen3D.API.Services
{
    public class ImageTokensForOpenAI : IImageTokens
    {
        readonly decimal _textInputPricePerMillion;
        readonly decimal _imageInputPricePerMillion;
        readonly decimal _imageOutputPricePerMillion;
        readonly Tokenizer _tokenizer;

        const int StepPx = 16;
        const long MinPixels = 655_360;
        const long MaxPixels = 8_294_400;
        const int MaxDimensionPx = 3_840;
        const double MaxAspectRatio = 3.0;
        const long TokenAreaOffsetPixels = 2_000_000;
        const long TokenAreaScaleDenominator = 4_000_000;

        public ImageTokensForOpenAI(decimal textInputPricePerMillion, decimal imageInputPricePerMillion, decimal imageOutputPricePerMillion)
        {
            _textInputPricePerMillion = textInputPricePerMillion;
            _imageInputPricePerMillion = imageInputPricePerMillion;
            _imageOutputPricePerMillion = imageOutputPricePerMillion;
            _tokenizer = TiktokenTokenizer.CreateForModel("gpt-4o");
        }

        public TokenCalculationResult CalculateTokens(string prompt, int width, int height, string quality, IReadOnlyList<(int width, int height)> inputImages = null, string inputDetail = "auto", decimal tokenCost = 0.01m)
        {
            int textInputTokens = _tokenizer.CountTokens(prompt ?? "");

            int qualityFactor = quality?.ToLowerInvariant() switch
            {
                "low" => 16,
                "medium" => 48,
                "high" => 96,
                _ => 48
            };

            int outputTokens = CalculateOutputTokens(width, height, qualityFactor);

            int imageInputTokens = 0;
            if (inputImages != null && inputImages.Count > 0)
            {
                foreach (var img in inputImages)
                {
                    imageInputTokens += CountInputImageTokens(img.width, img.height, inputDetail);
                }
            }

            decimal inputCost = ((decimal)textInputTokens / 1_000_000m) * _textInputPricePerMillion;
            decimal imageInputCost = ((decimal)imageInputTokens / 1_000_000m) * _imageInputPricePerMillion;
            decimal outputCost = ((decimal)outputTokens / 1_000_000m) * _imageOutputPricePerMillion;

            decimal estimatedCostUSD = inputCost + imageInputCost + outputCost;
            decimal effectiveTokenCost = tokenCost > 0 ? tokenCost : 0.01m;
            int platformTokens = Math.Max(1, (int)Math.Ceiling(estimatedCostUSD / effectiveTokenCost));

            return new TokenCalculationResult
            {
                TextInputTokens = textInputTokens,
                ImageInputTokens = imageInputTokens,
                ImageOutputTokens = outputTokens,
                EstimatedCostUSD = estimatedCostUSD,
                PlatformTokens = platformTokens
            };
        }

        static int CalculateOutputTokens(int width, int height, int qualityFactor)
        {
            if (width % StepPx != 0 || height % StepPx != 0)
                throw new ArgumentException($"Dimensions must be divisible by {StepPx}.");

            long totalPixels = (long)width * height;
            if (totalPixels < MinPixels || totalPixels > MaxPixels)
                throw new ArgumentException("Total pixels out of model boundaries.");

            if (width > MaxDimensionPx || height > MaxDimensionPx)
                throw new ArgumentException($"Dimensions cannot exceed {MaxDimensionPx}px.");

            long longEdge = Math.Max(width, height);
            long shortEdge = Math.Min(width, height);

            if ((double)longEdge / shortEdge > MaxAspectRatio)
                throw new ArgumentException($"Aspect ratio exceeds {MaxAspectRatio}:1 limit.");

            long shortAxisFactor = (2L * qualityFactor * shortEdge + longEdge) / (2L * longEdge);

            long tokenCount = qualityFactor * shortAxisFactor * (TokenAreaOffsetPixels + totalPixels) + TokenAreaScaleDenominator - 1;
            tokenCount /= TokenAreaScaleDenominator;

            return (int)tokenCount;
        }

        static int CountInputImageTokens(int width, int height, string detail)
        {
            if ("low".Equals(detail, StringComparison.OrdinalIgnoreCase))
                return 85;

            int w = width;
            int h = height;

            if (w > 2048 || h > 2048)
            {
                double scale = 2048.0 / Math.Max(w, h);
                w = (int)(w * scale);
                h = (int)(h * scale);
            }

            int patchesW = (int)Math.Ceiling(w / 32.0);
            int patchesH = (int)Math.Ceiling(h / 32.0);
            int totalPatches = patchesW * patchesH;

            if (totalPatches > 1536)
                totalPatches = 1536;

            return (int)Math.Ceiling(totalPatches * 1.20);
        }
    }
}
