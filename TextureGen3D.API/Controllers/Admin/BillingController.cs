using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TextureGen3D.API.Models;
using TextureGen3D.API.Models.Billing;
using TextureGen3D.Auth.Policies;
using TextureGen3D.Data.Entities;
using TextureGen3D.Data.Interfaces;
using TextureGen3D.Data.Interfaces.Auth;
using TextureGen3D.Data.Interfaces.Billing;

namespace TextureGen3D.API.Controllers.Admin
{
    [Route("/api/admin/billing")]
    [Authorize(Policy = nameof(AuthConstants.Policy.ManageUsers))]
    public class BillingController : ApiController
    {
        readonly IProductRepository _productRepository;
        readonly ISubscriptionRepository _subscriptionRepository;
        readonly IInvoiceRepository _invoiceRepository;
        readonly IAppUserSubscriptionRepository _appUserSubscriptionRepository;
        readonly IAppUserAITokenRepository _appUserAITokenRepository;
        readonly IAppUserRepository _appUserRepository;

        public BillingController(
            IProductRepository productRepository,
            ISubscriptionRepository subscriptionRepository,
            IInvoiceRepository invoiceRepository,
            IAppUserSubscriptionRepository appUserSubscriptionRepository,
            IAppUserAITokenRepository appUserAITokenRepository,
            IAppUserRepository appUserRepository)
        {
            _productRepository = productRepository;
            _subscriptionRepository = subscriptionRepository;
            _invoiceRepository = invoiceRepository;
            _appUserSubscriptionRepository = appUserSubscriptionRepository;
            _appUserAITokenRepository = appUserAITokenRepository;
            _appUserRepository = appUserRepository;
        }

        #region Products
        [HttpGet("products")]
        public async Task<IActionResult> GetProducts()
        {
            try
            {
                var products = await _productRepository.GetAllAsync();
                return Json(new ApiResponse { success = true, data = products });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("products/save")]
        public async Task<IActionResult> SaveProduct([FromBody] SaveProductRequest request)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(request.Title))
                    return Json(new ApiResponse { success = false, message = "Title is required." });

                if (request.Id > 0)
                {
                    var existing = await _productRepository.GetByIdAsync(request.Id);
                    if (existing == null)
                        return Json(new ApiResponse { success = false, message = "Product not found." });

                    existing.Title = request.Title;
                    existing.Price = request.Price;
                    existing.Tokens = request.Tokens;
                    await _productRepository.UpdateDetailsAsync(existing.Id, existing.Title, existing.Price, existing.Tokens);
                    return Json(new ApiResponse { success = true, data = existing });
                }
                else
                {
                    var product = await _productRepository.CreateAsync(new Data.Entities.Billing.Product
                    {
                        Title = request.Title,
                        Price = request.Price,
                        Tokens = request.Tokens
                    });
                    return Json(new ApiResponse { success = true, data = product });
                }
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("products/archive")]
        public async Task<IActionResult> ArchiveProduct([FromBody] ArchiveRequest request)
        {
            try
            {
                await _productRepository.ArchiveAsync(request.Id);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
        #endregion

        #region Subscriptions
        [HttpGet("subscriptions")]
        public async Task<IActionResult> GetSubscriptions()
        {
            try
            {
                var subscriptions = await _subscriptionRepository.GetAllAsync();
                return Json(new ApiResponse { success = true, data = subscriptions });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("subscriptions/save")]
        public async Task<IActionResult> SaveSubscription([FromBody] SaveSubscriptionRequest request)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(request.Title))
                    return Json(new ApiResponse { success = false, message = "Title is required." });

                if (request.Id > 0)
                {
                    var existing = await _subscriptionRepository.GetByIdAsync(request.Id);
                    if (existing == null)
                        return Json(new ApiResponse { success = false, message = "Subscription not found." });

                    existing.Title = request.Title;
                    existing.MonthlyProductId = request.MonthlyProductId;
                    existing.YearlyProductId = request.YearlyProductId;
                    existing.FeaturesJson = request.FeaturesJson;
                    existing.Status = request.Status;
                    await _subscriptionRepository.UpdateAsync(existing);
                    return Json(new ApiResponse { success = true, data = existing });
                }
                else
                {
                    var subscription = await _subscriptionRepository.CreateAsync(new Data.Entities.Billing.Subscription
                    {
                        Title = request.Title,
                        MonthlyProductId = request.MonthlyProductId,
                        YearlyProductId = request.YearlyProductId,
                        FeaturesJson = request.FeaturesJson,
                        Status = request.Status
                    });
                    return Json(new ApiResponse { success = true, data = subscription });
                }
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("subscriptions/archive")]
        public async Task<IActionResult> ArchiveSubscription([FromBody] ArchiveRequest request)
        {
            try
            {
                await _subscriptionRepository.ArchiveAsync(request.Id);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("subscriptions/reorder")]
        public async Task<IActionResult> ReorderSubscriptions([FromBody] ReorderSubscriptionsRequest request)
        {
            try
            {
                await _subscriptionRepository.ReorderAsync(request.Ids);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("subscriptions/set-featured")]
        public async Task<IActionResult> SetFeaturedSubscription([FromBody] ArchiveRequest request)
        {
            try
            {
                await _subscriptionRepository.SetFeaturedAsync(request.Id);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
        #endregion

        #region AppUserSubscriptions
        [HttpGet("user-subscriptions")]
        public async Task<IActionResult> GetUserSubscriptions()
        {
            try
            {
                var subscriptions = await _appUserSubscriptionRepository.GetAllAsync();
                var users = await _appUserRepository.GetAll();
                var userLookup = users.ToDictionary(u => u.Id!.Value);
                var result = subscriptions.Select(s => new
                {
                    s.Id,
                    s.AppUserId,
                    email = userLookup.TryGetValue(s.AppUserId, out var user) ? user.Email : "",
                    s.SubscriptionId,
                    s.StartDate,
                    s.EndDate,
                    s.Cancelled,
                    s.DateCreated
                });
                return Json(new ApiResponse { success = true, data = result });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("user-subscriptions/cancel")]
        public async Task<IActionResult> CancelUserSubscription([FromBody] CancelUserSubscriptionRequest request)
        {
            try
            {
                await _appUserSubscriptionRepository.CancelAsync(request.Id);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("user-subscriptions/start")]
        public async Task<IActionResult> StartUserSubscription([FromBody] StartUserSubscriptionRequest request)
        {
            try
            {
                var user = await _appUserRepository.FindByGuidAsync(request.AppUserId, true);
                if (user == null)
                    return Json(new ApiResponse { success = false, message = "User not found." });

                var subscription = await _subscriptionRepository.GetByIdAsync(request.SubscriptionId);
                if (subscription == null)
                    return Json(new ApiResponse { success = false, message = "Subscription not found." });

                var productId = request.Period == "yearly" ? subscription.YearlyProductId : subscription.MonthlyProductId;
                if (!productId.HasValue)
                    return Json(new ApiResponse { success = false, message = "Selected plan product not configured." });

                var product = await _productRepository.GetByIdAsync(productId.Value);
                if (product == null)
                    return Json(new ApiResponse { success = false, message = "Product not found." });

                var startDate = DateTime.UtcNow;
                var endDate = request.Period == "yearly" ? startDate.AddYears(1) : startDate.AddMonths(1);

                await _appUserSubscriptionRepository.CreateAsync(new Data.Entities.Billing.AppUserSubscription
                {
                    AppUserId = user.Id!.Value,
                    SubscriptionId = subscription.Id,
                    StartDate = startDate,
                    EndDate = endDate,
                    Cancelled = false
                });

                var invoice = await _invoiceRepository.CreateAsync(new Data.Entities.Billing.Invoice
                {
                    AppUserId = user.Id!.Value,
                    SubscriptionId = subscription.Id,
                    ProductId = product.Id,
                    Price = product.Price
                });

                var billingMonth = new DateTime(startDate.Year, startDate.Month, 1);
                await _appUserAITokenRepository.CreateAsync(new Data.Entities.Billing.AppUserAIToken
                {
                    AppUserId = user.Id!.Value,
                    InvoiceId = invoice.Id,
                    BillingMonth = billingMonth,
                    Tokens = product.Tokens,
                    TokensUsed = 0
                });

                return Json(new ApiResponse
                {
                    success = true,
                    data = new
                    {
                        subscriptionTitle = subscription.Title,
                        email = user.Email,
                        period = request.Period,
                        tokens = product.Tokens,
                        invoiceId = invoice.Id
                    }
                });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
        #endregion

        #region AppUserSubscriptionDetails
        [HttpGet("user-subscriptions/details")]
        public async Task<IActionResult> GetUserSubscriptionDetails([FromQuery] Guid appUserId)
        {
            try
            {
                var user = await _appUserRepository.FindByGuidAsync(appUserId, true);
                if (user == null)
                    return Json(new ApiResponse { success = false, message = "User not found." });

                var subscription = (await _appUserSubscriptionRepository.GetAllAsync())
                    .Where(s => s.AppUserId == appUserId && !s.Cancelled)
                    .OrderByDescending(s => s.DateCreated)
                    .FirstOrDefault();

                if (subscription == null)
                    return Json(new ApiResponse { success = false, message = "No active subscription found." });

                var subPlan = await _subscriptionRepository.GetByIdAsync(subscription.SubscriptionId);
                var product = subPlan != null
                    ? (await _productRepository.GetAllAsync()).FirstOrDefault(p => p.Id == subPlan.MonthlyProductId || p.Id == subPlan.YearlyProductId)
                    : null;

                var billingMonth = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
                var monthTokens = await _appUserAITokenRepository.GetByAppUserAndMonthAsync(appUserId, billingMonth);
                var monthTokensList = monthTokens.ToList();
                var totalTokens = monthTokensList.Sum(t => t.Tokens);
                var totalUsed = monthTokensList.Sum(t => t.TokensUsed);
                var unusedTokens = totalTokens - totalUsed;

                return Json(new ApiResponse
                {
                    success = true,
                    data = new
                    {
                        subscriptionId = subscription.Id,
                        appUserId = subscription.AppUserId,
                        email = user.Email,
                        subscriptionTitle = subPlan?.Title ?? "",
                        startDate = subscription.StartDate,
                        endDate = subscription.EndDate,
                        cancelled = subscription.Cancelled,
                        dateCreated = subscription.DateCreated,
                        tokens = product?.Tokens ?? 0,
                        unusedTokens,
                        price = product?.Price ?? 0,
                        productTitle = product?.Title ?? ""
                    }
                });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("user-subscriptions/ai-tokens")]
        public async Task<IActionResult> GetUserAITokens([FromQuery] Guid appUserId, [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
        {
            try
            {
                if (appUserId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "AppUserId is required." });

                if (page < 1) page = 1;
                if (pageSize < 1) pageSize = 10;
                if (pageSize > 100) pageSize = 100;

                var (items, total) = await _appUserAITokenRepository.GetPagedByAppUserIdAsync(appUserId, page, pageSize);

                return Json(new ApiResponse
                {
                    success = true,
                    data = new
                    {
                        items = items.Select(t => new
                        {
                            t.Id,
                            t.AppUserId,
                            t.InvoiceId,
                            billingMonth = t.BillingMonth,
                            tokens = t.Tokens,
                            tokensUsed = t.TokensUsed,
                            dateCreated = t.DateCreated
                        }),
                        total,
                        page,
                        pageSize,
                        totalPages = (int)Math.Ceiling((double)total / pageSize)
                    }
                });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("user-subscriptions/add-tokens")]
        public async Task<IActionResult> AddUserTokens([FromBody] AddUserTokensRequest request)
        {
            try
            {
                if (request.AppUserId == Guid.Empty)
                    return Json(new ApiResponse { success = false, message = "AppUserId is required." });

                var user = await _appUserRepository.FindByGuidAsync(request.AppUserId, true);
                if (user == null)
                    return Json(new ApiResponse { success = false, message = "User not found." });

                var product = await _productRepository.GetByIdAsync(request.ProductId);
                if (product == null)
                    return Json(new ApiResponse { success = false, message = "Product not found." });

                var subscription = (await _appUserSubscriptionRepository.GetAllAsync())
                    .Where(s => s.AppUserId == request.AppUserId && !s.Cancelled)
                    .OrderByDescending(s => s.DateCreated)
                    .FirstOrDefault();

                var invoice = await _invoiceRepository.CreateAsync(new Data.Entities.Billing.Invoice
                {
                    AppUserId = request.AppUserId,
                    SubscriptionId = subscription?.SubscriptionId ?? 0,
                    ProductId = product.Id,
                    Price = product.Price
                });

                var billingMonth = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
                var tokenRecord = await _appUserAITokenRepository.CreateAsync(new Data.Entities.Billing.AppUserAIToken
                {
                    AppUserId = request.AppUserId,
                    InvoiceId = invoice.Id,
                    BillingMonth = billingMonth,
                    Tokens = product.Tokens,
                    TokensUsed = 0
                });

                return Json(new ApiResponse
                {
                    success = true,
                    data = new
                    {
                        id = tokenRecord.Id,
                        invoiceId = invoice.Id,
                        tokens = product.Tokens,
                        productTitle = product.Title
                    }
                });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
        #endregion

        #region Invoices
        [HttpGet("invoices")]
        public async Task<IActionResult> GetInvoices()
        {
            try
            {
                var invoices = await _invoiceRepository.GetAllAsync();
                return Json(new ApiResponse { success = true, data = invoices });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
        #endregion
    }
}
