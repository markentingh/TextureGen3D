using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.Data.Interfaces;
using TextureGen3D.Data.Interfaces.Billing;

namespace TextureGen3D.API.Controllers
{
    [Route("api/subscriptions")]
    public class SubscriptionsController : ApiController
    {
        readonly ISubscriptionRepository _subscriptionRepository;
        readonly IProductRepository _productRepository;

        public SubscriptionsController(ISubscriptionRepository subscriptionRepository, IProductRepository productRepository)
        {
            _subscriptionRepository = subscriptionRepository;
            _productRepository = productRepository;
        }

        [HttpGet]
        public async Task<IActionResult> GetActiveSubscriptions()
        {
            try
            {
                var subscriptions = await _subscriptionRepository.GetActiveAsync();
                var productIds = subscriptions
                    .SelectMany(s => new[] { s.MonthlyProductId, s.YearlyProductId })
                    .Where(id => id.HasValue)
                    .Select(id => id!.Value)
                    .Distinct()
                    .ToList();

                var products = new List<object>();
                if (productIds.Count > 0)
                {
                    var allProducts = await _productRepository.GetAllAsync();
                    products = allProducts.Where(p => productIds.Contains(p.Id))
                        .Select(p => new { p.Id, p.Title, p.Price, p.Tokens })
                        .Cast<object>()
                        .ToList();
                }

                return Json(new ApiResponse
                {
                    success = true,
                    data = new
                    {
                        subscriptions = subscriptions.Select(s => new
                        {
                            s.Id,
                            s.Title,
                            s.MonthlyProductId,
                            s.YearlyProductId,
                            s.FeaturesJson,
                            s.Featured,
                            s.SortIndex,
                            s.Status
                        }),
                        products
                    }
                });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
