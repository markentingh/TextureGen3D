import { Api } from '@/api/Api';

const ImageGeneration = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/image-generation';
  return {
    getActiveModels: () => api.get(`${apiPath}/active-models`)
  };
});

export { ImageGeneration };
