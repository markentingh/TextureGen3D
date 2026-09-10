import { Api } from '@/api/Api';

const ProjectModels = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/project-models';
  return {
    getByProject: (projectId) => api.get(`${apiPath}/${projectId}`),
    upload: (projectId, file) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post(`${apiPath}/${projectId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
    },
    downloadUrl: (projectId, modelId) => `${apiPath}/${projectId}/${modelId}/download`,
    delete: (projectId, modelId) => api.post(`${apiPath}/${projectId}/${modelId}/delete`),
  };
});

export { ProjectModels };
