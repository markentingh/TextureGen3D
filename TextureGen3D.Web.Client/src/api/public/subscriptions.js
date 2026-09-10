import { Api } from '@/api/Api';

const Subscriptions = (args) => Api({ ...args }).endpoints(({ api }) => {
  return {
    getActiveSubscriptions: () => api.get('/api/subscriptions'),
  };
});

export { Subscriptions };
