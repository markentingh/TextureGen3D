import { Api } from '@/api/Api';

// In-flight counter for layer texture-file saves (uvmap.png / orm.png /
// mask.png / emissive.png). Components subscribe with useSyncExternalStore
// (subscribeLayerSaves/getLayerSaveCount) — Layers.jsx shows a spinner
// next to its title while the count is > 0.
const TRACKED_SAVE_FILES = new Set(['uvmap.png', 'orm.png', 'mask.png', 'emissive.png']);
let layerSaveCount = 0;
const layerSaveListeners = new Set();
const emitLayerSaveCount = () => {
  for (const fn of layerSaveListeners) fn(layerSaveCount);
};
const trackLayerSave = (promise) => {
  layerSaveCount++;
  emitLayerSaveCount();
  const done = () => {
    layerSaveCount--;
    emitLayerSaveCount();
  };
  // then(done, done) — a .finally would leave a rejected derived promise
  // dangling unhandled whenever the save fails.
  promise.then(done, done);
  return promise;
};
export const getLayerSaveCount = () => layerSaveCount;
export const subscribeLayerSaves = (fn) => {
  layerSaveListeners.add(fn);
  return () => layerSaveListeners.delete(fn);
};

const ProjectMeshLayers = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/project-mesh-layers';
  return {
    getByMesh: (projectId, meshId) => api.get(`${apiPath}/${projectId}/mesh/${meshId}`),
    // type: 0 = plain, 1 = Generated, 2 = Inpainted, 3 = Flattened
    create: (projectId, meshId, name, cameraAngle, type = 0, referenceId = null) => api.post(`${apiPath}/${projectId}`, { meshId, name, cameraAngle, type, referenceId }),
    updateName: (projectId, layerId, name) => api.post(`${apiPath}/${projectId}/${layerId}/update-name`, { name }),
    reorder: (projectId, meshId, orderedIds) => api.post(`${apiPath}/${projectId}/reorder`, { meshId, orderedIds }),
    delete: (projectId, layerId) => api.post(`${apiPath}/${projectId}/${layerId}/delete`),
    saveImage: (projectId, layerId, meshId, base64Image) => api.post(`${apiPath}/${projectId}/${layerId}/save-image`, { meshId, base64Image }),
    saveUvMap: (projectId, layerId, meshId, base64UvMap) => trackLayerSave(api.post(`${apiPath}/${projectId}/${layerId}/save-uvmap`, { meshId, base64UvMap })),
    saveFile: (projectId, layerId, meshId, fileName, base64Image) => {
      const p = api.post(`${apiPath}/${projectId}/${layerId}/save-file`, { meshId, fileName, base64Image });
      return TRACKED_SAVE_FILES.has(fileName) ? trackLayerSave(p) : p;
    },
    saveMasks: (projectId, meshId, masks) => trackLayerSave(api.post(`${apiPath}/${projectId}/save-masks`, { meshId, masks })),
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
    cleanImage: (projectId, layerId, meshId) =>
      api.post(`${apiPath}/${projectId}/${layerId}/clean-image`, { meshId }),
    revertImage: (projectId, layerId, meshId) =>
      api.post(`${apiPath}/${projectId}/${layerId}/revert-image`, { meshId }),
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
    // Per-layer PBR map files — orm.png (roughness R / metallic B) +
    // emissive.png, saved via saveFile above.
    fileUrl: (projectId, meshId, layerId, fileName) => `${apiPath}/${projectId}/mesh/${meshId}/${layerId}/file/${fileName}`,
  };
});

export { ProjectMeshLayers };
