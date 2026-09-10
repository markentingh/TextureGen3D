using TextureGen3D.Data.Entities.Billing;

namespace TextureGen3D.Data.Interfaces.Billing
{
    public interface IProductRepository
    {
        Task<Product> CreateAsync(Product product);
        Task<Product?> GetByIdAsync(int id);
        Task<IEnumerable<Product>> GetAllAsync();
        Task<IEnumerable<Product>> GetActiveAsync();
        Task UpdateAsync(Product product);
        Task UpdateDetailsAsync(int id, string title, int price, int tokens);
        Task ArchiveAsync(int id);
    }
}
