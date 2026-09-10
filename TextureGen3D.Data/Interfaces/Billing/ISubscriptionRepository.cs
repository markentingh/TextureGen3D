using TextureGen3D.Data.Entities.Billing;

namespace TextureGen3D.Data.Interfaces.Billing
{
    public interface ISubscriptionRepository
    {
        Task<Subscription> CreateAsync(Subscription subscription);
        Task<Subscription?> GetByIdAsync(int id);
        Task<IEnumerable<Subscription>> GetAllAsync();
        Task<IEnumerable<Subscription>> GetActiveAsync();
        Task UpdateAsync(Subscription subscription);
        Task ArchiveAsync(int id);
        Task ReorderAsync(IEnumerable<int> ids);
        Task SetFeaturedAsync(int id);
    }
}
