import { Api } from '@/api/Api';

const Projects = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/projects';
  return {
    getAll: () => api.get(`${apiPath}`),
    getArchived: () => api.get(`${apiPath}/archived`),
    getById: (id) => api.get(`${apiPath}/${id}`),
    load: (id) => api.get(`${apiPath}/${id}/load`),
    getThumbUrl: (id) => `${apiPath}/${id}/thumb`,
    create: (project) => api.post(`${apiPath}/create`, project),
    updateTitle: (request) => api.post(`${apiPath}/update-title`, request),
    updateKey: (request) => api.post(`${apiPath}/update-key`, request),
    updateImageModel: (request) => api.post(`${apiPath}/update-image-model`, request),
    saveThumb: (id, base64Image) => api.post(`${apiPath}/${id}/save-thumb`, { base64Image }),
    archive: (request) => api.post(`${apiPath}/archive`, request),
    unarchive: (request) => api.post(`${apiPath}/unarchive`, request),
  };
});

export { Projects };
