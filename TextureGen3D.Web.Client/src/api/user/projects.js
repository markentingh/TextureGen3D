import { Api } from '@/api/Api';

const Projects = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/projects';
  return {
    getAll: () => api.get(`${apiPath}`),
    getArchived: () => api.get(`${apiPath}/archived`),
    getById: (id) => api.get(`${apiPath}/${id}`),
    getThumbUrl: (id) => `${apiPath}/${id}/thumb`,
    create: (project) => api.post(`${apiPath}/create`, project),
    updateTitle: (request) => api.post(`${apiPath}/update-title`, request),
    updateKey: (request) => api.post(`${apiPath}/update-key`, request),
    archive: (request) => api.post(`${apiPath}/archive`, request),
    unarchive: (request) => api.post(`${apiPath}/unarchive`, request),
  };
});

export { Projects };
