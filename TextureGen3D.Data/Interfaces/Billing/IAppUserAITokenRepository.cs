using TextureGen3D.Data.Entities.Billing;

namespace TextureGen3D.Data.Interfaces.Billing
{
    public interface IAppUserAITokenRepository
    {
        Task<AppUserAIToken> CreateAsync(AppUserAIToken token);
        Task<AppUserAIToken?> GetByIdAsync(int id);
        Task<IEnumerable<AppUserAIToken>> GetByAppUserIdAsync(Guid appUserId);
        Task<IEnumerable<AppUserAIToken>> GetByAppUserAndMonthAsync(Guid appUserId, DateTime billingMonth);
        Task UpdateTokensUsedAsync(int id, int tokensUsed);
        Task<(IEnumerable<AppUserAIToken> Items, int Total)> GetPagedByAppUserIdAsync(Guid appUserId, int page, int pageSize);
    }
}
