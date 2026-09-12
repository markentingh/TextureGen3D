import { Api } from '@/api/Api';

const ProjectReferences = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/project-references';
  return {
    getByProject: (projectId) => api.get(`${apiPath}/${projectId}`),
    upload: (projectId, file) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post(`${apiPath}/${projectId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
    },
    imageUrl: (projectId, referenceId) => `${apiPath}/${projectId}/${referenceId}/image`,
    thumbUrl: (projectId, referenceId) => `${apiPath}/${projectId}/${referenceId}/thumb`,
    delete: (projectId, referenceId) => api.post(`${apiPath}/${projectId}/${referenceId}/delete`),
    updateActive: (projectId, referenceId, active) => api.post(`${apiPath}/${projectId}/${referenceId}/update-active?active=${active}`),
    generate: (projectId, data) => api.post(`${apiPath}/${projectId}/generate`, data),
    saveGenerated: (projectId, imageBase64, mode, referenceId) =>
      api.post(`${apiPath}/${projectId}/save-generated?mode=${mode}&referenceId=${referenceId || ''}`, imageBase64, {
        headers: { 'Content-Type': 'text/plain' }
      }),
  };
});

export { ProjectReferences };
