import { Api } from '@/api/Api';

const ProjectMeshLayers = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/project-mesh-layers';
  return {
    getByMesh: (projectId, meshId) => api.get(`${apiPath}/${projectId}/mesh/${meshId}`),
    create: (projectId, meshId, name) => api.post(`${apiPath}/${projectId}`, { meshId, name }),
    updateName: (projectId, layerId, name) => api.post(`${apiPath}/${projectId}/${layerId}/update-name`, { name }),
    reorder: (projectId, meshId, orderedIds) => api.post(`${apiPath}/${projectId}/reorder`, { meshId, orderedIds }),
    delete: (projectId, layerId) => api.post(`${apiPath}/${projectId}/${layerId}/delete`),
    saveImage: (projectId, layerId, meshId, base64Image) => api.post(`${apiPath}/${projectId}/${layerId}/save-image`, { meshId, base64Image }),
    saveUvMap: (projectId, layerId, meshId, base64UvMap) => api.post(`${apiPath}/${projectId}/${layerId}/save-uvmap`, { meshId, base64UvMap }),
    generate: (projectId, layerId, meshId, imageModelId, prompt, depthMap, cameraAngle, cameraAngleId) =>
      api.post(`${apiPath}/${projectId}/${layerId}/generate`, { meshId, imageModelId, prompt, depthMap, cameraAngle, cameraAngleId }),
    saveComfyUiResult: (projectId, layerId, meshId, generatedImage, depthMap) =>
      api.post(`${apiPath}/${projectId}/${layerId}/save-comfyui-result`, { meshId, generatedImage, depthMap }),
    saveDepthMap: (projectId, layerId, meshId, depthMap) =>
      api.post(`${apiPath}/${projectId}/${layerId}/save-depthmap`, { meshId, depthMap }),
    reproject: (projectId, layerId, meshId, cameraAngle) =>
      api.post(`${apiPath}/${projectId}/${layerId}/reproject`, { meshId, cameraAngle }),
    toggleVisible: (projectId, layerId, visible) =>
      api.post(`${apiPath}/${projectId}/${layerId}/toggle-visible`, { visible }),
    stitchLayers: (projectId, meshId, imageModelId, layerIds) =>
      api.post(`${apiPath}/${projectId}/stitch-layers`, { meshId, imageModelId, layerIds }),
    imageUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/image`,
    thumbUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/thumb`,
    uvmapUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/uvmap`,
    uvmapThumbUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/uvmap-thumb`,
  };
});

export { ProjectMeshLayers };
