using TextureGen3D.Data.Entities.Billing;
using TextureGen3D.Data.Interfaces.Billing;

namespace TextureGen3D.API.Services
{
    public interface IAITokenService
    {
        Task<int> GetAvailableTokensAsync(Guid appUserId);
        Task<bool> HasEnoughTokensAsync(Guid appUserId, int tokensNeeded);
        Task<bool> UseTokensAsync(Guid appUserId, int tokensToUse);
    }

    public class AITokenService : IAITokenService
    {
        readonly IAppUserAITokenRepository _appUserAITokenRepository;

        public AITokenService(IAppUserAITokenRepository appUserAITokenRepository)
        {
            _appUserAITokenRepository = appUserAITokenRepository;
        }

        public async Task<int> GetAvailableTokensAsync(Guid appUserId)
        {
            var billingMonth = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
            var tokens = await _appUserAITokenRepository.GetByAppUserAndMonthAsync(appUserId, billingMonth);
            return tokens.Sum(t => t.Tokens - t.TokensUsed);
        }

        public async Task<bool> HasEnoughTokensAsync(Guid appUserId, int tokensNeeded)
        {
            var available = await GetAvailableTokensAsync(appUserId);
            return available >= tokensNeeded;
        }

        public async Task<bool> UseTokensAsync(Guid appUserId, int tokensToUse)
        {
            if (tokensToUse <= 0)
                return true;

            var billingMonth = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
            var tokens = (await _appUserAITokenRepository.GetByAppUserAndMonthAsync(appUserId, billingMonth))
                .OrderBy(t => t.DateCreated)
                .ToList();

            var totalAvailable = tokens.Sum(t => t.Tokens - t.TokensUsed);
            if (totalAvailable < tokensToUse)
                return false;

            var remaining = tokensToUse;
            foreach (var token in tokens)
            {
                if (remaining <= 0) break;

                var available = token.Tokens - token.TokensUsed;
                if (available <= 0) continue;

                var toUse = Math.Min(available, remaining);
                token.TokensUsed += toUse;
                remaining -= toUse;

                await _appUserAITokenRepository.UpdateTokensUsedAsync(token.Id, token.TokensUsed);
            }

            return remaining == 0;
        }
    }
}
