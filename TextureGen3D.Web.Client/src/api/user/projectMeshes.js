import { Api } from '@/api/Api';

const ProjectMeshes = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/project-meshes';
  return {
    getByProject: (projectId) => api.get(`${apiPath}/${projectId}`),
    getByModel: (projectId, modelId) => api.get(`${apiPath}/${projectId}/model/${modelId}`),
    create: (projectId, mesh) => api.post(`${apiPath}/${projectId}`, mesh),
    createBatch: (projectId, meshes) => api.post(`${apiPath}/${projectId}/batch`, meshes),
    delete: (projectId, meshId) => api.post(`${apiPath}/${projectId}/${meshId}/delete`),
    updatePrompt: (projectId, meshId, prompt) => api.post(`${apiPath}/${projectId}/${meshId}/update-prompt`, { prompt }),
  };
});

export { ProjectMeshes };
