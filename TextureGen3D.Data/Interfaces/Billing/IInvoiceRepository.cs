using TextureGen3D.Data.Entities.Billing;

namespace TextureGen3D.Data.Interfaces.Billing
{
    public interface IInvoiceRepository
    {
        Task<Invoice> CreateAsync(Invoice invoice);
        Task<Invoice?> GetByIdAsync(int id);
        Task<IEnumerable<Invoice>> GetAllAsync();
        Task<IEnumerable<Invoice>> GetByAppUserIdAsync(Guid appUserId);
    }
}
