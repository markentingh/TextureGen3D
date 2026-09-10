import { Api } from '@/api/Api';

const Billing = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/admin/billing';
  return {
    getProducts: () => api.get(`${apiPath}/products`),
    saveProduct: (product) => api.post(`${apiPath}/products/save`, product),
    archiveProduct: (id) => api.post(`${apiPath}/products/archive`, { id }),
    getSubscriptions: () => api.get(`${apiPath}/subscriptions`),
    saveSubscription: (subscription) => api.post(`${apiPath}/subscriptions/save`, subscription),
    archiveSubscription: (id) => api.post(`${apiPath}/subscriptions/archive`, { id }),
    reorderSubscriptions: (ids) => api.post(`${apiPath}/subscriptions/reorder`, { ids }),
    setFeaturedSubscription: (id) => api.post(`${apiPath}/subscriptions/set-featured`, { id }),
    getUserSubscriptions: () => api.get(`${apiPath}/user-subscriptions`),
    cancelUserSubscription: (id) => api.post(`${apiPath}/user-subscriptions/cancel`, { id }),
    startUserSubscription: (request) => api.post(`${apiPath}/user-subscriptions/start`, request),
    getUserSubscriptionDetails: (appUserId) => api.get(`${apiPath}/user-subscriptions/details`, { params: { appUserId } }),
    getUserAITokens: (appUserId, page = 1, pageSize = 10) => api.get(`${apiPath}/user-subscriptions/ai-tokens`, { params: { appUserId, page, pageSize } }),
    addUserTokens: (request) => api.post(`${apiPath}/user-subscriptions/add-tokens`, request),
    getInvoices: () => api.get(`${apiPath}/invoices`),
  };
});

export { Billing };
