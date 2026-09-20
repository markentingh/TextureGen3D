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
    generateReference: (projectId, angleId, referenceId, modelId, pngBase64, prompt = '') =>
      api.post(
        `${apiPath}/${projectId}/${angleId}/generate-reference?referenceId=${referenceId}&modelId=${modelId}${prompt ? `&userPrompt=${encodeURIComponent(prompt)}` : ''}`,
        pngBase64,
        { headers: { 'Content-Type': 'text/plain' } }
      ),
    previewReference: (projectId, angleId, referenceId, modelId, pngBase64, prompt = '') =>
      api.post(
        `${apiPath}/${projectId}/${angleId}/preview-reference?referenceId=${referenceId}&modelId=${modelId}${prompt ? `&userPrompt=${encodeURIComponent(prompt)}` : ''}`,
        pngBase64,
        { headers: { 'Content-Type': 'text/plain' } }
      ),
  };
});

export { ProjectCameraAngles };
