import { Api } from '@/api/Api';

const ProjectCameraAngles = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/project-camera-angles';
  return {
    getByProject: (projectId) => api.get(`${apiPath}/${projectId}`),
    getByMesh: (projectId, meshId) => api.get(`${apiPath}/${projectId}/mesh/${meshId}`),
    create: (projectId, angle) => api.post(`${apiPath}/${projectId}`, angle),
    updatePrompt: (projectId, angleId, prompt) => api.post(`${apiPath}/${projectId}/${angleId}/update-prompt`, { prompt }),
    updateReference: (projectId, angleId, projectReferenceId) => api.post(`${apiPath}/${projectId}/${angleId}/update-reference`, { projectReferenceId }),
    delete: (projectId, angleId) => api.post(`${apiPath}/${projectId}/${angleId}/delete`),
    deleteAll: (projectId) => api.post(`${apiPath}/${projectId}/delete-all`),
    deleteAllByMesh: (projectId, meshId) => api.post(`${apiPath}/${projectId}/mesh/${meshId}/delete-all`),
  };
});

export { ProjectCameraAngles };
