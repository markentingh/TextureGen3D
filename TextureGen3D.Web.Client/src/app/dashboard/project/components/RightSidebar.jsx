import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { generateAngleThumbnails } from '@/helpers/camera-angle';
import { useProject } from '@/context/project';
import { ProjectModels } from '@/api/user/projectModels';
import { ProjectMeshes } from '@/api/user/projectMeshes';
import { ProjectMeshReferences } from '@/api/user/projectMeshReferences';
import { ProjectCameraAngles } from '@/api/user/projectCameraAngles';
import { ProjectReferences } from '@/api/user/projectReferences';
import { Projects } from '@/api/user/projects';
import Icon from '@/components/ui/icon';
import Spinner from '@/components/ui/spinner';
import Select from '@/components/forms/select';
import ToggleButtons from '@/components/ui/toggle-buttons';
import { useModal } from '@/context/modal';
import StitchLayersModal from './StitchLayersModal';
import MaskThumb, { CHECKERBOARD_BG } from './MaskThumb';
import { useHubGeneration } from './useHubGeneration';

// Union two mask images (white = painted) — 'lighten' composites per-channel
// max, so painted regions from either mask stay painted. Returns a Blob.
async function mergeMaskImages(baseDataUrl, layerBlob) {
  const loadImg = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  const layerUrl = URL.createObjectURL(layerBlob);
  try {
    const [baseImg, layerImg] = await Promise.all([
      loadImg(baseDataUrl),
      loadImg(layerUrl),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = baseImg.width;
    canvas.height = baseImg.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighten';
    ctx.drawImage(layerImg, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(layerUrl);
  }
}

export default function RightSidebar() {
  const {
    id,
    token,
    project,
    setProject,
    textureResolution,
    allMeshes,
    selectedMesh,
    setSelectedMesh,
    parsingModels,
    models,
    setModels,
    meshData,
    setMeshData,
    parseErrors,
    setParseErrors,
    meshDbIds,
    setMeshDbIds,
    meshLayers,
    setMeshLayers,
    allMeshLayers,
    setAllMeshLayers,
    layerApi,
    layerThumbVersion,
    maskThumbVersions,
    setMaskThumbVersions,
    assetGeneratingLayerIds,
    selectedLayerId,
    setSelectedLayerId,
    selectedLayerIds,
    toggleLayerSelected,
    imageModels,
    refImageModels,
    layerMasksRef,
    viewerRef,
    meshPrompts,
    setMeshPrompts,
    cameraAngles,
    setCameraAngles,
    selectedAngleId,
    setSelectedAngleId,
    angleRefView,
    setAngleRefView,
    meshRefView,
    setMeshReferences,
    allCameraAngles,
    setAllCameraAngles,
    thumbnailCache,
    setThumbnailCache,
    projectRefs,
    prompt,
    setPrompt,
    generationMode,
    loadProject,
    parseUploadedFile,
    reuploadModelFile,
    loadMeshLayers,
    removeMeshLayer,
    refreshLayerTextures,
    formatTriangleCount,
    maskTool,
    setMaskTool,
    setInpaintMaskVisible,
  } = useProject();
  const { showModal, hideModal } = useModal();
  const { removeBackground } = useHubGeneration();

  // ── Local state ──
  const [editingLayerId, setEditingLayerId] = useState(null);
  const [editingLayerName, setEditingLayerName] = useState('');
  const [layerMenuOpenId, setLayerMenuOpenId] = useState(null);
  const [layerMenuPos, setLayerMenuPos] = useState({ top: 0, right: 0 });
  const dragLayerIndexRef = useRef(null);
  const [draggingLayerIdx, setDraggingLayerIdx] = useState(null);
  const [dropIndicatorIdx, setDropIndicatorIdx] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const reuploadInputRef = useRef(null);
  const reuploadModelIdRef = useRef(null);
  const [projectionMode, setProjectionMode] = useState('orthographic');
  const [downloadingUvmap, setDownloadingUvmap] = useState(false);
  const [layersMenuOpen, setLayersMenuOpen] = useState(false);
  const [layersMenuPos, setLayersMenuPos] = useState({ top: 0, right: 0 });
  const [reprojectingAll, setReprojectingAll] = useState(false);
  const [removingBgLayerId, setRemovingBgLayerId] = useState(null);

  // ── formatFileSize ──
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // ── getAngleThumbForLayer ──
  // Match a layer's CameraAngle (JSON rotation string) to a camera angle's thumbnail
  const getAngleThumbForLayer = (layer) => {
    if (!layer.cameraAngle) return null;
    try {
      const layerRot = JSON.parse(layer.cameraAngle);
      const rotKey = JSON.stringify(layerRot);
      return cameraAngles.find((a) => JSON.stringify(a.rotation) === rotKey)?.thumbnail || null;
    } catch {
      return null;
    }
  };

  // ── handleMeshDownload ──
  const handleMeshDownload = useCallback(
    async (mesh, event) => {
      event.stopPropagation();
      if (!mesh?.object) return;

      const exporter = new GLTFExporter();
      const clone = mesh.object.clone(true);

      exporter.parse(
        clone,
        (result) => {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(mesh.name || 'mesh').replace(/[^a-zA-Z0-9_-]/g, '_')}.glb`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        },
        (error) => {
          console.error('GLB export failed:', error);
        },
        { binary: true }
      );
    },
    []
  );

  // ── handleReuploadClick / handleReuploadSelect ──
  // Upload a newer version of a model. Mesh records are matched by name
  // server-side and updated in place — layers, camera angles and references
  // keep pointing at the same record ids.
  const handleReuploadClick = (model, e) => {
    e.stopPropagation();
    reuploadModelIdRef.current = model.id;
    reuploadInputRef.current?.click();
  };

  const handleReuploadSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const modelId = reuploadModelIdRef.current;
    reuploadModelIdRef.current = null;
    if (!file || !modelId) return;
    const allowedExtensions = ['fbx', 'obj', 'abc', 'usd', 'ply', 'stl'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      setUploadError(`Unsupported file type. Allowed: .fbx, .obj, .abc, .usd, .ply, .stl`);
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const res = await reuploadModelFile(modelId, file);
      if (!res?.success) setUploadError(res?.message || 'Re-upload failed');
    } finally {
      setUploading(false);
    }
  };

  // ── handleMeshSelect ──
  const handleMeshSelect = useCallback(
    async (mesh) => {
      setSelectedMesh(mesh);
      const meshDbId = meshDbIds[mesh.key];
      if (meshDbId) {
        setPrompt(meshPrompts[meshDbId] || '');
      } else {
        setPrompt('');
      }

      loadMeshLayers(meshDbId);

      if (meshDbId) {
        const savedAngles = allCameraAngles[meshDbId] || [];
        const cached = thumbnailCache[mesh.key] || {};
        const anglesNeedingThumbs = savedAngles.filter((a) => !cached[a.id]);
        const newThumbs =
          anglesNeedingThumbs.length > 0
            ? await generateAngleThumbnails(mesh, anglesNeedingThumbs)
            : [];

        const thumbMap = { ...cached };
        anglesNeedingThumbs.forEach((angle, i) => {
          thumbMap[angle.id] = newThumbs[i];
        });

        if (anglesNeedingThumbs.length > 0) {
          setThumbnailCache((prev) => ({ ...prev, [mesh.key]: thumbMap }));
        }

        const mappedAngles = savedAngles.map((angle) => ({
          id: angle.id,
          dbId: angle.id,
          thumbnail: thumbMap[angle.id] || null,
          rotation: JSON.parse(angle.rotation || '{}'),
          prompt: angle.prompt || '',
          projectReferenceId: angle.projectReferenceId || null,
        }));
        setCameraAngles(mappedAngles);
        if (mappedAngles.length > 0) {
          setSelectedAngleId(mappedAngles[0].id);
          if (generationMode === 'angles') {
            setPrompt(mappedAngles[0].prompt || '');
          }
          if (mappedAngles[0].projectReferenceId) {
            const ref = projectRefs.find((r) => r.id === mappedAngles[0].projectReferenceId);
            setAngleRefView(ref ? [{ ...ref, active: true }] : []);
          } else {
            setAngleRefView([]);
          }
        } else {
          setSelectedAngleId(null);
          setAngleRefView([]);
        }
        return;
      }
      setCameraAngles([]);
    },
    [
      meshDbIds,
      meshPrompts,
      setPrompt,
      loadMeshLayers,
      allCameraAngles,
      thumbnailCache,
      setThumbnailCache,
      setCameraAngles,
      setSelectedAngleId,
      generationMode,
      projectRefs,
      setAngleRefView,
      setSelectedMesh,
    ]
  );

  // ── File upload handlers ──

  // Select the first mesh when mesh data becomes available
  useEffect(() => {
    if (selectedMesh || allMeshes.length === 0) return;
    handleMeshSelect(allMeshes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMeshes.length, selectedMesh]);
  const handleFileUpload = async (file) => {
    if (!file) return;
    const allowedExtensions = ['fbx', 'obj', 'abc', 'usd', 'ply', 'stl'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      setUploadError(`Unsupported file type. Allowed: .fbx, .obj, .abc, .usd, .ply, .stl`);
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const api = ProjectModels({ token });
      const res = await api.upload(id, file);
      if (res.data.success) {
        const newModel = res.data.data;
        const modelsApi = ProjectModels({ token });
        const modelsRes = await modelsApi.getByProject(id);
        if (modelsRes.data.success) {
          setModels(modelsRes.data.data || []);
        }
        if (newModel) {
          await parseUploadedFile(newModel.id, file);
        }
      } else {
        setUploadError(res.data.message || 'Upload failed');
      }
    } catch (err) {
      setUploadError(err.response?.data?.message || err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  // ── handleDeleteModelClick — confirm modal, then delete ──
  const handleDeleteModelClick = (model) => {
    showModal({
      title: 'Delete 3D Model',
      onClose: hideModal,
      body: (
        <>
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            Do you really want to delete this 3D model {model.filename}? All related meshes will be deleted as well.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={hideModal}
              className="px-4 py-2 border-2 border-gray-400 text-gray-600 dark:text-gray-300 dark:border-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                hideModal();
                handleDeleteModel(model.id);
              }}
              className="px-4 py-2 border-2 border-green-600 text-green-600 dark:text-green-400 dark:border-green-500 rounded-lg hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white transition font-medium text-sm"
            >
              Delete 3D Model
            </button>
          </div>
        </>
      ),
    });
  };

  // ── handleDeleteModel ──
  const handleDeleteModel = async (modelId) => {
    try {
      const api = ProjectModels({ token });
      const res = await api.delete(id, modelId);
      if (res.data.success) {
        setMeshData((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
        setParseErrors((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
        if (selectedMesh && selectedMesh.modelId === modelId) {
          setSelectedMesh(null);
        }
        await loadProject();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // ── handleDeleteMeshClick / handleDeleteMesh ──
  const handleDeleteMeshClick = (mesh, e) => {
    e.stopPropagation();
    showModal({
      title: 'Delete Mesh',
      onClose: hideModal,
      body: (
        <>
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            Do you really want to delete the mesh "{mesh.name}"? Its layers will be deleted as well.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={hideModal}
              className="px-4 py-2 border-2 border-gray-400 text-gray-600 dark:text-gray-300 dark:border-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                hideModal();
                handleDeleteMesh(mesh);
              }}
              className="px-4 py-2 border-2 border-red-600 text-red-600 dark:text-red-400 dark:border-red-500 rounded-lg hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white transition font-medium text-sm"
            >
              Delete Mesh
            </button>
          </div>
        </>
      ),
    });
  };

  const handleDeleteMesh = async (mesh) => {
    const meshDbId = meshDbIds[mesh.key];
    if (!meshDbId) return;
    try {
      const api = ProjectMeshes({ token });
      const res = await api.delete(id, meshDbId);
      if (res.data.success) {
        if (selectedMesh?.key === mesh.key) {
          setSelectedMesh(null);
        }
        await loadProject();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // ── Layer handlers ──
  // Download the combined uvmap.png — every visible layer's uvmap with its
  // mask applied to the alpha channel, flattened via the same compositor the
  // shader path uses.
  const handleDownloadUvmap = async () => {
    if (!selectedMesh || downloadingUvmap || !viewerRef.current) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    setDownloadingUvmap(true);
    const items = [];
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      for (const layer of meshLayers.filter((l) => l.visible !== false)) {
        const res = await fetch(layerApi.uvmapUrl(id, meshDbId, layer.id), { headers });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob.size) continue;

        // Live mask RT first (covers unsaved strokes), else saved mask.png
        let maskDataUrl = null;
        const entry = layerMasksRef.current?.get(layer.id);
        if (entry?.initialized) {
          try {
            maskDataUrl = viewerRef.current.maskToDataURL?.(entry) || null;
          } catch {
            /* readback failed — fall through to the saved mask */
          }
        }
        if (!maskDataUrl) {
          try {
            const mres = await fetch(layerApi.maskUrl(id, meshDbId, layer.id), { headers });
            if (mres.ok) {
              const mblob = await mres.blob();
              if (mblob.size) {
                maskDataUrl = await new Promise((res2, rej) => {
                  const fr = new FileReader();
                  fr.onload = () => res2(fr.result);
                  fr.onerror = rej;
                  fr.readAsDataURL(mblob);
                });
              }
            }
          } catch {
            /* no mask — layer composites unmasked */
          }
        }
        items.push({ url: URL.createObjectURL(blob), maskDataUrl });
      }

      const canvas = await viewerRef.current.compositeLayersToCanvas?.(items);
      if (!canvas) return;
      const pngBlob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!pngBlob) return;
      const meshName = (selectedMesh.name || 'mesh').replace(/[^\w.-]+/g, '_');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(pngBlob);
      a.download = `${meshName}_uvmap.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      console.error('Failed to download combined uvmap:', err);
    } finally {
      items.forEach((it) => URL.revokeObjectURL(it.url));
      setDownloadingUvmap(false);
    }
  };

  const handleEditLayerName = (layer) => {
    setEditingLayerId(layer.id);
    setEditingLayerName(layer.name);
  };

  // Keep the allMeshLayers cache in sync with local meshLayers edits —
  // loadMeshLayers reads from the cache, so a setMeshLayers-only change
  // (visibility, rename, reorder) would be silently reverted on the next
  // layer reload.
  const syncAllMeshLayers = (layers) => {
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (!meshDbId) return;
    setAllMeshLayers((prev) => ({ ...prev, [meshDbId]: layers }));
  };

  const handleSaveLayerName = async (layerId) => {
    const name = editingLayerName.trim();
    setEditingLayerId(null);
    setEditingLayerName('');
    if (!name) return;
    try {
      await layerApi.updateName(id, layerId, name);
      const updatedLayers = meshLayers.map((l) => (l.id === layerId ? { ...l, name } : l));
      setMeshLayers(updatedLayers);
      syncAllMeshLayers(updatedLayers);
    } catch (err) {
      console.error('Failed to update layer name:', err);
    }
  };

  const handleToggleLayerVisible = async (layer) => {
    const newVisible = !layer.visible;
    const updatedLayers = meshLayers.map((l) =>
      l.id === layer.id ? { ...l, visible: newVisible } : l
    );
    setMeshLayers(updatedLayers);
    syncAllMeshLayers(updatedLayers);
    try {
      await refreshLayerTextures(updatedLayers);
      await layerApi.toggleVisible(id, layer.id, newVisible);
    } catch (err) {
      console.error('Failed to toggle layer visibility:', err);
      setMeshLayers(meshLayers);
      syncAllMeshLayers(meshLayers);
    }
  };

  const handleDeleteLayer = async (layer) => {
    if (!layer || !selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    removeMeshLayer(meshDbId, layer.id);
    try {
      await layerApi.delete(id, layer.id);
      const updatedLayers = await loadMeshLayers(meshDbId);
      await refreshLayerTextures(updatedLayers);
    } catch (err) {
      console.error('Failed to delete layer:', err);
      await loadMeshLayers(meshDbId);
    }
  };

  // Fetch the layer's source image and re-project it onto the mesh's UV map
  // at the layer's stored camera angle. Shared by single + reproject-all.
  const reprojectLayer = async (layer, meshDbId) => {
    const imageUrl = layerApi.imageUrl(id, meshDbId, layer.id);
    const response = await fetch(imageUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Failed to fetch layer image');
    const imageBlob = await response.blob();
    const reader = new FileReader();
    const imageDataUrl = await new Promise((resolve) => {
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(imageBlob);
    });

    let rotation = null;
    if (layer.cameraAngle) {
      try {
        rotation = JSON.parse(layer.cameraAngle);
      } catch {
        /* ignore */
      }
    }

    const projectPromise = viewerRef.current?.projectImageToUvMap(
      imageDataUrl,
      rotation,
      textureResolution
    );
    if (!projectPromise) throw new Error('Failed to project image (viewer returned null)');
    const projected = await projectPromise;
    if (!projected?.uvMap) throw new Error('Failed to generate UV map');

    await layerApi.saveUvMap(id, layer.id, meshDbId, projected.uvMap);
    // Reprojection changes the coverage footprint — refresh the mask, but
    // never overwrite an inpaint layer's painted mask.
    if (projected.mask && !layer.inpaint) {
      await layerApi.saveMasks(id, meshDbId, [{ layerId: layer.id, base64Mask: projected.mask }]);
      setMaskThumbVersions((prev) => ({ ...prev, [layer.id]: (prev[layer.id] || 0) + 1 }));
    }
  };

  const handleReprojectLayer = async (layer) => {
    if (!layer || !selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    try {
      await reprojectLayer(layer, meshDbId);
      const updatedLayers = await loadMeshLayers(meshDbId);
      await refreshLayerTextures(updatedLayers);
    } catch (err) {
      console.error('Reprojection failed:', err);
    }
  };

  // Reproject every layer of the selected mesh — a single layer failing
  // doesn't abort the rest; textures reload once at the end.
  const handleReprojectAllLayers = async () => {
    if (!selectedMesh || reprojectingAll) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    setReprojectingAll(true);
    try {
      for (const layer of meshLayers) {
        try {
          await reprojectLayer(layer, meshDbId);
        } catch (err) {
          console.error(`Reprojection failed for layer "${layer.name}":`, err);
        }
      }
      const updatedLayers = await loadMeshLayers(meshDbId);
      await refreshLayerTextures(updatedLayers);
    } finally {
      setReprojectingAll(false);
    }
  };

  // Load the layer's saved mask.png into the inpaint overlay mask and switch
  // to the inpaint tool — the mask becomes the painted region. Ctrl/Cmd+click
  // adds the mask to the existing inpaint mask (union) instead of replacing.
  // No stopPropagation: the click also selects the layer like the angle thumb.
  const handleMaskThumbClick = async (layer, e) => {
    if (!layer || !selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    try {
      const res = await fetch(layerApi.maskUrl(id, meshDbId, layer.id), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      let blob = await res.blob();
      if (blob.size === 0) return;

      const additive = e?.ctrlKey || e?.metaKey;
      if (additive) {
        // Merge with the current inpaint mask — 'lighten' gives the union of
        // both painted regions (per-channel max). Both are PNG-orientation.
        const curDataUrl = viewerRef.current?.inpaintMaskToDataURL?.();
        if (curDataUrl) blob = await mergeMaskImages(curDataUrl, blob);
      }

      const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
      viewerRef.current?.loadInpaintMask?.(bitmap);
      bitmap.close();
      setInpaintMaskVisible(true);
      setMaskTool('inpaint');
    } catch (err) {
      console.warn('Failed to load layer mask into inpaint:', err);
    }
  };

  // Run the layer's existing image through the active Background Removal
  // (type-4) model, save it back as the layer image, then reproject so the
  // removed background shows through to the checkerboard on the mesh.
  const handleRemoveBackgroundLayer = async (layer) => {
    if (!layer || !selectedMesh || removingBgLayerId) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    setRemovingBgLayerId(layer.id);
    try {
      const imageUrl = layerApi.imageUrl(id, meshDbId, layer.id);
      const response = await fetch(imageUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Failed to fetch layer image');
      const imageBlob = await response.blob();
      const reader = new FileReader();
      const imageDataUrl = await new Promise((resolve) => {
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(imageBlob);
      });

      const processed = await removeBackground({
        generatedImage: imageDataUrl,
        layer,
        meshDbId,
        cameraAngleJson: layer.cameraAngle,
      });
      if (!processed) throw new Error('Background removal returned no image');

      let rotation = null;
      if (layer.cameraAngle) {
        try {
          rotation = JSON.parse(layer.cameraAngle);
        } catch {
          /* ignore */
        }
      }
      const uvMapDataUrl = await viewerRef.current?.projectImageToUvMap(
        processed,
        rotation,
        textureResolution
      );
      if (uvMapDataUrl) await layerApi.saveUvMap(id, layer.id, meshDbId, uvMapDataUrl);

      const updatedLayers = await loadMeshLayers(meshDbId);
      await refreshLayerTextures(updatedLayers);
    } catch (err) {
      console.error('Background removal failed:', err);
    } finally {
      setRemovingBgLayerId(null);
    }
  };

  const handleLayerDragStart = (e, index) => {
    dragLayerIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index)); // required by Firefox
    // Drag ghost = a snapshot of the whole row, grabbed at the pointer's
    // position within the row so it follows the cursor naturally.
    const row = e.currentTarget.closest('li');
    if (row) {
      const rect = row.getBoundingClientRect();
      e.dataTransfer.setDragImage(row, e.clientX - rect.left, e.clientY - rect.top);
    }
    // The snapshot is taken synchronously, so hiding the row via state is
    // safe — React flushes it after this handler returns.
    setDraggingLayerIdx(index);
  };

  // Track the gap (0..length) the dragged layer would drop into — the row's
  // top half maps to the gap above it, bottom half to the gap below.
  const handleLayerDragOver = (e, index) => {
    e.preventDefault();
    if (dragLayerIndexRef.current === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDropIndicatorIdx(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
  };

  const endLayerDrag = () => {
    dragLayerIndexRef.current = null;
    setDraggingLayerIdx(null);
    setDropIndicatorIdx(null);
  };

  const handleLayerDrop = async (e) => {
    e.preventDefault();
    const dragIndex = dragLayerIndexRef.current;
    const dropGap = dropIndicatorIdx;
    endLayerDrag();
    if (dragIndex === null || dropGap === null) return;
    if (dropGap === dragIndex || dropGap === dragIndex + 1) return; // same spot

    const reordered = [...meshLayers];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropGap > dragIndex ? dropGap - 1 : dropGap, 0, moved);
    setMeshLayers(reordered);
    syncAllMeshLayers(reordered);

    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (meshDbId) {
      try {
        await layerApi.reorder(id, meshDbId, reordered.map((l) => l.id));
      } catch (err) {
        console.error('Failed to reorder layers:', err);
      }
    }
    refreshLayerTextures(reordered);
  };

  const openStitchModal = () => {
    if (!selectedMesh) return;
    showModal({
      title: 'Stitch Layers',
      className: 'w-full max-w-2xl',
      onClose: hideModal,
      body: (
        <StitchLayersModal
          layers={meshLayers}
          projectId={id}
          meshDbId={meshDbIds[selectedMesh.key]}
          token={token}
          imageModels={refImageModels}
          layerApi={layerApi}
          layerMasksRef={layerMasksRef}
          viewerRef={viewerRef}
          onClose={hideModal}
          onStitched={handleStitched}
        />
      ),
    });
  };

  const handleStitched = async () => {
    hideModal();
    if (!selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    const updatedLayers = await loadMeshLayers(meshDbId);
    await refreshLayerTextures(updatedLayers);
  };

  const handleViewLayerReference = async (layer) => {
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (!meshDbId) return;
    try {
      const res = await layerApi.getLayerReferenceImage(id, meshDbId, layer.id);
      const url = URL.createObjectURL(res.data);
      showModal({
        title: 'Reference Image',
        className: 'max-w-[90vw] max-h-[90vh]',
        onClose: () => { URL.revokeObjectURL(url); hideModal(); },
        body: (
          <div className="flex items-center justify-center" onClick={hideModal}>
            <img
              src={url}
              alt={`${layer.name} reference`}
              className="max-w-[85vw] max-h-[80vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ),
      });
    } catch (err) {
      console.error('Failed to load layer reference image:', err);
    }
  };

  // Clicking a layer's reference thumb loads that reference into whichever
  // panel is displayed: the selected camera angle's ref in angles mode, or
  // the mesh's reference list for single generation / inpainting.
  const handleReferenceThumbClick = async (layer) => {
    const ref = projectRefs.find((r) => r.id === layer.referenceId);
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (!ref || !meshDbId) return;
    try {
      if (maskTool !== 'inpaint' && generationMode === 'angles' && selectedAngleId) {
        const anglesApi = ProjectCameraAngles({ token });
        await anglesApi.updateReference(id, selectedAngleId, ref.id);
        setCameraAngles((prev) => prev.map((a) => a.id === selectedAngleId ? { ...a, projectReferenceId: ref.id } : a));
        setAngleRefView([{ ...ref, active: true }]);
        return;
      }
      const meshRefApi = ProjectMeshReferences({ token });
      const existing = meshRefView.find((r) => r.id === ref.id);
      for (const r of meshRefView) {
        if (r.meshRefId && r.id !== ref.id) {
          await meshRefApi.delete(id, r.meshRefId);
        }
      }
      if (existing?.meshRefId) {
        if (!existing.active) {
          await meshRefApi.updateActive(id, existing.meshRefId, true);
        }
      } else {
        await meshRefApi.add(id, meshDbId, ref.id);
      }
      const res = await meshRefApi.getByMesh(id, meshDbId);
      if (res.data?.success) {
        setMeshReferences((prev) => ({ ...prev, [meshDbId]: res.data.data || [] }));
      }
    } catch (err) {
      console.error('Failed to set layer reference:', err);
    }
  };

  const handleDeleteLayerClick = (layer) => {
    showModal({
      title: 'Delete Layer',
      onClose: hideModal,
      body: (
        <>
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            Do you really want to delete this mesh layer? This cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={hideModal}
              className="px-4 py-2 border-2 border-gray-400 text-gray-600 dark:text-gray-300 dark:border-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                hideModal();
                handleDeleteLayer(layer);
              }}
              className="px-4 py-2 border-2 border-red-600 text-red-600 dark:text-red-400 dark:border-red-500 rounded-lg hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white transition font-medium text-sm"
            >
              Delete Layer
            </button>
          </div>
        </>
      ),
    });
  };

  return (
    <aside className="fixed top-0 right-0 z-20 h-screen w-72 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Meshes</h3>
        </div>
        {/* Meshes list */}
        {allMeshes.length === 0 ? (
          <div className="p-4 text-sm text-gray-400 dark:text-gray-500 text-center">
            {models.length === 0
              ? 'No models uploaded yet.'
              : Object.keys(parsingModels).length > 0
                ? 'Parsing models...'
                : 'No meshes extracted.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {allMeshes.map((mesh) => {
              const isSelected = selectedMesh?.key === mesh.key;
              return (
                <li
                  key={mesh.key}
                  onClick={() => handleMeshSelect(mesh)}
                  className={`flex items-center justify-between px-4 py-3 cursor-pointer transition ${
                    isSelected
                      ? 'bg-purple-50 dark:bg-purple-900/30 outline-none ring-2 ring-purple-500 ring-inset'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                  style={isSelected ? { boxShadow: 'inset 0 0 0 2px #a855f7' } : undefined}
                >
                  <div className="min-w-0 flex-1 mr-3">
                    <p className={`font-bold text-sm truncate ${
                      isSelected
                        ? 'text-purple-700 dark:text-purple-300'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}>
                      {mesh.name}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">
                    {mesh.triangles.toLocaleString()} tris
                  </span>
                  <button
                    onClick={(e) => handleMeshDownload(mesh, e)}
                    className="ml-2 p-1 rounded text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition flex-shrink-0"
                    aria-label="Download mesh as GLB"
                    title="Download mesh as GLB"
                  >
                    <Icon name="download" className="text-base" />
                  </button>
                  <button
                    onClick={(e) => handleDeleteMeshClick(mesh, e)}
                    className="p-1 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition flex-shrink-0"
                    aria-label="Delete mesh"
                    title="Delete mesh and its layers"
                  >
                    <Icon name="delete" className="text-base" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Layers section */}
        {selectedMesh && (
          <div className="border-t border-gray-200 dark:border-gray-700 flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Layers</h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleDownloadUvmap}
                  disabled={!selectedMesh || meshLayers.length === 0 || downloadingUvmap}
                  className="p-1 rounded text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Download combined uvmap"
                  title="Download combined uvmap.png"
                >
                  {downloadingUvmap ? (
                    <Spinner className="text-lg" />
                  ) : (
                    <Icon name="download" className="text-lg" />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    if (layersMenuOpen) {
                      setLayersMenuOpen(false);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setLayersMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                      setLayersMenuOpen(true);
                    }
                  }}
                  disabled={!selectedMesh || meshLayers.length === 0}
                  className="p-1 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Layer actions"
                  title="Layer actions"
                >
                  {reprojectingAll ? (
                    <Spinner className="text-lg" />
                  ) : (
                    <Icon name="more_vert" className="text-lg" />
                  )}
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {meshLayers.length === 0 ? (
                <div className="p-3 text-xs text-gray-400 dark:text-gray-500 text-center">
                  No layers yet.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {meshLayers.map((layer, index) => (
                    <React.Fragment key={layer.id}>
                    {dropIndicatorIdx === index && (
                      <li
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleLayerDrop}
                        className="h-0.5 bg-purple-500 rounded mx-1"
                      />
                    )}
                    <li
                      onDragOver={(e) => handleLayerDragOver(e, index)}
                      onDrop={handleLayerDrop}
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey) toggleLayerSelected(layer.id);
                        else setSelectedLayerId(layer.id);
                      }}
                      className={`px-2 py-2 group cursor-pointer transition ${
                        index === draggingLayerIdx
                          ? 'hidden'
                          : selectedLayerIds.includes(layer.id)
                          ? 'bg-purple-50 dark:bg-purple-900/30 outline-none ring-2 ring-purple-500 ring-inset'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                      style={selectedLayerIds.includes(layer.id) && index !== draggingLayerIdx ? { boxShadow: 'inset 0 0 0 2px #a855f7' } : undefined}
                    >
                      <div className="flex items-stretch gap-2">
                        {/* Drag handle — the grip column is the only drag source */}
                        <span
                          draggable
                          onDragStart={(e) => handleLayerDragStart(e, index)}
                          onDragEnd={endLayerDrag}
                          onClick={(e) => e.stopPropagation()}
                          className="cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 flex-shrink-0"
                          style={{ display: 'flex', alignItems: 'center' }}
                          title="Drag to reorder"
                        >
                          <Icon name="drag_indicator" className="text-base" />
                        </span>

                        {/* Content column: name row + thumbs row */}
                        <div className="min-w-0 flex-1 flex flex-col">
                          {/* Row 1: eye toggle + name + edit + 3-dots */}
                          <div className="flex items-center gap-1">
                            {removingBgLayerId === layer.id ? (
                              <span className="flex-shrink-0 translate-y-1 pr-1" title="Removing background...">
                                <Spinner className="text-2xl" />
                              </span>
                            ) : (
                              <button
                                onClick={() => handleToggleLayerVisible(layer)}
                                className={`flex-shrink-0 translate-y-1 pr-1 transition ${layer.visible !== false ? 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300' : 'text-gray-300 dark:text-gray-600 hover:text-gray-500'}`}
                                aria-label={layer.visible !== false ? 'Hide layer' : 'Show layer'}
                                title={layer.visible !== false ? 'Hide layer' : 'Show layer'}
                              >
                                <Icon name={layer.visible !== false ? 'visibility' : 'visibility_off'} className="text-2xl" />
                              </button>
                            )}

                            <div className="min-w-0 flex-1">
                              {editingLayerId === layer.id ? (
                                <input
                                  type="text"
                                  value={editingLayerName}
                                  onChange={(e) => setEditingLayerName(e.target.value.slice(0, 32))}
                                  onBlur={() => handleSaveLayerName(layer.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveLayerName(layer.id);
                                    if (e.key === 'Escape') { setEditingLayerId(null); setEditingLayerName(''); }
                                  }}
                                  autoFocus
                                  maxLength={32}
                                  className="w-full text-sm px-1 py-0.5 rounded border border-purple-400 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 outline-none"
                                />
                              ) : (
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                                  {layer.name}
                                </p>
                              )}
                            </div>

                            {layer.inpaint && (
                              <span className="flex-shrink-0 pr-2 text-green-600 dark:text-green-500 text-[10px] font-bold">
                                Inpainted
                              </span>
                            )}

                            {/* Edit icon */}
                            <button
                              onClick={() => handleEditLayerName(layer)}
                              className="flex-shrink-0 text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition"
                              aria-label="Edit layer name"
                              title="Edit layer name"
                            >
                              <Icon name="edit" className="text-sm" />
                            </button>

                            {/* 3-dots dropdown menu */}
                            <div className="flex-shrink-0 relative">
                              <button
                                onClick={(e) => {
                                  const isOpen = layerMenuOpenId === layer.id;
                                  if (isOpen) {
                                    setLayerMenuOpenId(null);
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setLayerMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                                    setLayerMenuOpenId(layer.id);
                                  }
                                }}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
                                aria-label="Layer options"
                                title="Layer options"
                              >
                                <Icon name="more_vert" className="text-sm" />
                              </button>
                            </div>
                          </div>

                          {/* Row 2: UV map thumb + camera angle thumb + mask thumb + delete */}
                          <div className="flex items-center justify-between mt-1">
                            <div className="flex items-center gap-2">
                              {assetGeneratingLayerIds?.has(layer.id) ? (
                                <div className="flex items-center gap-2" style={{ height: 47 }}>
                                  <Spinner className="text-lg" />
                                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                    Generating layer assets...
                                  </span>
                                </div>
                              ) : (
                                <>
                              {/* UV map thumb — checkerboard so transparent
                                  areas (removed background) are visible */}
                              <div
                                className="flex-shrink-0 rounded border border-gray-200 dark:border-gray-600 overflow-hidden"
                                style={{ width: 47, height: 47, ...CHECKERBOARD_BG }}
                              >
                                {layer.hasImage !== false && (
                                  <img
                                    src={`${layerApi.uvmapThumbUrl(id, meshDbIds[selectedMesh.key], layer.id)}?r=${layerThumbVersion}`}
                                    alt={layer.name}
                                    className="w-full h-full object-cover"
                                    onLoad={(e) => { e.target.style.display = ''; }}
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                  />
                                )}
                              </div>

                              {/* Mask thumb — inverted mask on the alpha channel of a white image.
                                  Click loads the layer's mask into the inpaint tool. */}
                              <MaskThumb
                                url={`${layerApi.maskThumbUrl(id, meshDbIds[selectedMesh.key], layer.id)}?r=${maskThumbVersions?.[layer.id] ?? 0}`}
                                version={maskThumbVersions?.[layer.id] ?? 0}
                                size={47}
                                onClick={(e) => handleMaskThumbClick(layer, e)}
                              />

                              {/* Camera angle thumb + inpaint tag — clicking the
                                  thumb snaps the main camera to the layer's angle */}
                              {(() => {
                                const angleThumb = getAngleThumbForLayer(layer);
                                const applyLayerAngle = () => {
                                  // No stopPropagation — let the click bubble to
                                  // the row's onClick so the layer also selects
                                  try {
                                    const rotation = JSON.parse(layer.cameraAngle || '{}');
                                    if (rotation.x == null && rotation.y == null && rotation.z == null) return;
                                    viewerRef.current?.setCameraRotation(rotation);
                                  } catch { /* malformed JSON — ignore */ }
                                };
                                const thumbCls = "rounded border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-100 dark:bg-gray-700 cursor-pointer hover:ring-1 hover:ring-purple-500 transition";
                                if (angleThumb) {
                                  return (
                                    <div
                                      className={`${thumbCls} flex-shrink-0`}
                                      style={{ width: 47, height: 47 }}
                                      onClick={applyLayerAngle}
                                      title="Snap camera to this layer's angle"
                                    >
                                      <img
                                        src={angleThumb}
                                        alt="Camera angle"
                                        className="w-full h-full object-cover"
                                      />
                                    </div>
                                  );
                                }
                                // No matching camera angle — fall back to the
                                // layer's own saved angle thumbnail (e.g. inpaint
                                // layers with arbitrary camera angles)
                                return (
                                  <div
                                    className={`${thumbCls} flex-shrink-0`}
                                    style={{ width: 47, height: 47, display: 'none' }}
                                    onClick={applyLayerAngle}
                                    title="Snap camera to this layer's angle"
                                  >
                                    <img
                                      src={`${layerApi.angleThumbUrl(id, meshDbIds[selectedMesh.key], layer.id)}?r=${layerThumbVersion}`}
                                      alt="Camera angle"
                                      className="w-full h-full object-cover"
                                      onLoad={(e) => { e.target.parentElement.style.display = ''; }}
                                      onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                                    />
                                  </div>
                                );
                              })()}

                              {/* Reference image thumb — click loads this
                                  layer's reference into the displayed panel */}
                              {layer.referenceId && (
                                <div
                                  className="flex-shrink-0 rounded border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-100 dark:bg-gray-700 cursor-pointer hover:ring-1 hover:ring-purple-500 transition"
                                  style={{ width: 47, height: 47 }}
                                  onClick={() => handleReferenceThumbClick(layer)}
                                  title="Use this reference image in the current panel"
                                >
                                  <img
                                    src={ProjectReferences({ token }).thumbUrl(id, layer.referenceId)}
                                    alt="Reference"
                                    className="w-full h-full object-cover"
                                    onLoad={(e) => { e.target.style.display = ''; }}
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                  />
                                </div>
                              )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                    </React.Fragment>
                  ))}
                  {dropIndicatorIdx === meshLayers.length && (
                    <li
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleLayerDrop}
                      className="h-0.5 bg-purple-500 rounded mx-1"
                    />
                  )}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pinned to the bottom of the sidebar */}
      <div className="flex-shrink-0 overflow-y-auto max-h-[60%] border-t border-gray-200 dark:border-gray-700">
        {/* Texture Resolution section */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Texture Resolution</h3>
          <Select
            value={String(textureResolution)}
            onChange={async (e) => {
              const resolution = parseInt(e.target.value, 10);
              setProject((prev) => (prev ? { ...prev, textureResolution: resolution } : prev));
              try {
                await Projects({ token }).updateTextureResolution({ id, textureResolution: resolution });
              } catch (err) {
                console.error('Failed to save texture resolution:', err);
              }
            }}
            options={[
              { value: '1024', label: '1K Textures' },
              { value: '2048', label: '2K Textures' },
              { value: '4096', label: '4K Textures' },
            ]}
          />
        </div>

        {/* Viewport section */}
        {allMeshes.length > 0 && (
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Viewport</h3>
            <ToggleButtons
              value={projectionMode}
              onChange={(v) => { setProjectionMode(v); viewerRef.current?.setProjectionMode(v); }}
              options={[
                { value: 'perspective', label: 'Perspective' },
                { value: 'orthographic', label: 'Orthographic' },
              ]}
            />
          </div>
        )}

        {/* Models section (upload + model list) */}
        <div className="p-3 space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Models</h4>

          {/* Upload area */}
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition ${
              dragOver
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                : 'border-gray-300 dark:border-gray-600 hover:border-purple-400 dark:hover:border-purple-500'
            } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".fbx,.obj,.abc,.usd,.ply,.stl"
              onChange={handleFileSelect}
              onClick={(e) => e.stopPropagation()}
              className="hidden"
            />
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Spinner className="text-2xl" />
                <p className="text-sm text-gray-600 dark:text-gray-400">Uploading...</p>
              </div>
            ) : (
              <div>
                <svg className="mx-auto w-8 h-8 text-gray-400 dark:text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Upload your 3D model (.fbx, .obj, .abc, .usd, .ply, .stl) or drag and drop your file here
                </p>
              </div>
            )}
          </div>

          {/* Hidden input for re-uploading a newer version of a model —
              kept OUTSIDE the upload-area div so its programmatic click
              can't bubble into the upload area's onClick and open the
              new-model upload dialog instead. */}
          <input
            ref={reuploadInputRef}
            type="file"
            accept=".fbx,.obj,.abc,.usd,.ply,.stl"
            onChange={handleReuploadSelect}
            className="hidden"
          />

          {uploadError && (
            <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-xs text-center">
              {uploadError}
            </div>
          )}

          {/* Model list */}
          {models.length > 0 && (
            <div className="space-y-2">
              {models.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-6 h-6 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{model.filename}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {model.extension.toUpperCase()} - {formatFileSize(model.fileSize)}
                      </p>
                      {parsingModels[model.id] && (
                        <p className="text-xs text-purple-500 dark:text-purple-400 mt-0.5 flex items-center gap-1">
                          <Spinner className="text-xs" /> Extracting...
                        </p>
                      )}
                      {parseErrors[model.id] && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                          {parseErrors[model.id]}
                        </p>
                      )}
                      {meshData[model.id] && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                          {meshData[model.id].meshes.length} mesh(es) - {formatTriangleCount(meshData[model.id].totalTriangles)} tris
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => handleReuploadClick(model, e)}
                      className="p-1.5 text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 transition"
                      aria-label="Upload a newer version of this model"
                      title="Upload a newer version of this 3D model"
                    >
                      <Icon name="upload_file" className="text-base" />
                    </button>
                    <button
                      onClick={() => handleDeleteModelClick(model)}
                      className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 transition"
                      aria-label="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fixed-position layers-header dropdown menu (escapes overflow containers) */}
      {layersMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setLayersMenuOpen(false)}
          />
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg py-1 min-w-[180px]"
            style={{ top: layersMenuPos.top, right: layersMenuPos.right }}
          >
            <button
              onClick={() => { setLayersMenuOpen(false); openStitchModal(); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
            >
              <Icon name="photo_auto_merge" className="text-sm" />
              Stitch All Layers
            </button>
            <button
              onClick={() => { setLayersMenuOpen(false); handleReprojectAllLayers(); }}
              disabled={reprojectingAll}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              <Icon name="3d_rotation" className="text-sm" />
              Reproject All Layers
            </button>
          </div>
        </>
      )}

      {/* Fixed-position layer dropdown menu (escapes overflow containers) */}
      {layerMenuOpenId && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setLayerMenuOpenId(null)}
          />
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ top: layerMenuPos.top, right: layerMenuPos.right }}
          >
            <button
              onClick={() => { const lid = layerMenuOpenId; setLayerMenuOpenId(null); const layer = meshLayers.find((l) => l.id === lid); if (layer) handleReprojectLayer(layer); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
            >
              <Icon name="3d_rotation" className="text-sm" />
              Reproject Image
            </button>
            <button
              onClick={() => { const lid = layerMenuOpenId; setLayerMenuOpenId(null); const layer = meshLayers.find((l) => l.id === lid); if (layer) handleRemoveBackgroundLayer(layer); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
            >
              <Icon name="layers_clear" className="text-sm" />
              Remove Background
            </button>
            <button
              onClick={() => { const lid = layerMenuOpenId; setLayerMenuOpenId(null); const layer = meshLayers.find((l) => l.id === lid); if (layer) handleViewLayerReference(layer); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
            >
              <Icon name="image" className="text-sm" />
              Reference Image
            </button>
            <button
              onClick={() => { const lid = layerMenuOpenId; setLayerMenuOpenId(null); const layer = meshLayers.find((l) => l.id === lid); if (layer) handleDeleteLayerClick(layer); }}
              className="w-full text-left px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition flex items-center gap-2"
            >
              <Icon name="delete" className="text-sm" />
              Delete Layer
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
