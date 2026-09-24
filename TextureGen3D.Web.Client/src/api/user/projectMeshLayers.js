import { Api } from '@/api/Api';

const ProjectMeshLayers = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/project-mesh-layers';
  return {
    getByMesh: (projectId, meshId) => api.get(`${apiPath}/${projectId}/mesh/${meshId}`),
    create: (projectId, meshId, name, cameraAngle, inpaint = false, referenceId = null) => api.post(`${apiPath}/${projectId}`, { meshId, name, cameraAngle, inpaint, referenceId }),
    updateName: (projectId, layerId, name) => api.post(`${apiPath}/${projectId}/${layerId}/update-name`, { name }),
    reorder: (projectId, meshId, orderedIds) => api.post(`${apiPath}/${projectId}/reorder`, { meshId, orderedIds }),
    delete: (projectId, layerId) => api.post(`${apiPath}/${projectId}/${layerId}/delete`),
    saveImage: (projectId, layerId, meshId, base64Image) => api.post(`${apiPath}/${projectId}/${layerId}/save-image`, { meshId, base64Image }),
    saveUvMap: (projectId, layerId, meshId, base64UvMap) => api.post(`${apiPath}/${projectId}/${layerId}/save-uvmap`, { meshId, base64UvMap }),
    saveMasks: (projectId, meshId, masks) => api.post(`${apiPath}/${projectId}/save-masks`, { meshId, masks }),
    saveAngleThumb: (projectId, layerId, meshId, base64Image) =>
      api.post(`${apiPath}/${projectId}/${layerId}/save-angle-thumb`, { meshId, base64Image }),
    generate: (projectId, layerId, meshId, imageModelId, prompt, depthMap, cameraAngle, cameraAngleId, inputImage, resolution) =>
      api.post(`${apiPath}/${projectId}/${layerId}/generate`, { meshId, imageModelId, prompt, depthMap, cameraAngle, cameraAngleId, inputImage, resolution }),
    inpaint: (projectId, meshId, image, mask, prompt, referenceIds, imageModelId, resolution) =>
      api.post(`${apiPath}/${projectId}/inpaint`, { meshId, image, mask, prompt, referenceIds, imageModelId, resolution }),
    saveComfyUiResult: (projectId, layerId, meshId, generatedImage, depthMap) =>
      api.post(`${apiPath}/${projectId}/${layerId}/save-comfyui-result`, { meshId, generatedImage, depthMap }),
    saveDepthMap: (projectId, layerId, meshId, depthMap) =>
      api.post(`${apiPath}/${projectId}/${layerId}/save-depthmap`, { meshId, depthMap }),
    saveProjectionImage: (projectId, image) =>
      api.post(`${apiPath}/${projectId}/projection-image`, { image }),
    reproject: (projectId, layerId, meshId, cameraAngle) =>
      api.post(`${apiPath}/${projectId}/${layerId}/reproject`, { meshId, cameraAngle }),
    toggleVisible: (projectId, layerId, visible) =>
      api.post(`${apiPath}/${projectId}/${layerId}/toggle-visible`, { visible }),
    stitchLayers: (projectId, meshId, imageModelId, layerIds) =>
      api.post(`${apiPath}/${projectId}/stitch-layers`, { meshId, imageModelId, layerIds }),
    getLayerReferenceImage: (projectId, meshId, layerId) =>
      api.get(`${apiPath}/${projectId}/mesh/${meshId}/${layerId}/image`, { responseType: 'blob' }),
    imageUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/image`,
    thumbUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/thumb`,
    uvmapUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/uvmap`,
    uvmapThumbUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/uvmap-thumb`,
    maskUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/mask`,
    maskThumbUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/mask-thumb`,
    angleThumbUrl: (projectId, meshId, layerId) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/angle-thumb`,
  };
});

export { ProjectMeshLayers };
