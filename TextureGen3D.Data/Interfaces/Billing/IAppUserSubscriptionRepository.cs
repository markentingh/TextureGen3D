using TextureGen3D.Data.Entities.Billing;

namespace TextureGen3D.Data.Interfaces.Billing
{
    public interface IAppUserSubscriptionRepository
    {
        Task<AppUserSubscription> CreateAsync(AppUserSubscription subscription);
        Task<AppUserSubscription?> GetByIdAsync(int id);
        Task<IEnumerable<AppUserSubscription>> GetAllAsync();
        Task<IEnumerable<AppUserSubscription>> GetByAppUserIdAsync(Guid appUserId);
        Task<IEnumerable<AppUserSubscription>> GetActiveByAppUserIdAsync(Guid appUserId);
        Task CancelAsync(int id);
    }
}
