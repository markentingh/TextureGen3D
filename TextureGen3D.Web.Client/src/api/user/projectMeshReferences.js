import { Api } from '@/api/Api';

const ProjectMeshReferences = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/project-mesh-references';
  return {
    getByMesh: (projectId, meshId) => api.get(`${apiPath}/${projectId}/mesh/${meshId}`),
    add: (projectId, meshId, referenceId) => api.post(`${apiPath}/${projectId}`, { meshId, referenceId }),
    delete: (projectId, meshRefId) => api.post(`${apiPath}/${projectId}/${meshRefId}/delete`),
    updateActive: (projectId, meshRefId, active) => api.post(`${apiPath}/${projectId}/${meshRefId}/update-active?active=${active}`),
  };
});

export { ProjectMeshReferences };
