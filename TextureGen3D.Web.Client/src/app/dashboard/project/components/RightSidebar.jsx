import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useProject } from '@/context/project';
import { ProjectModels } from '@/api/user/projectModels';
import { ProjectMeshes } from '@/api/user/projectMeshes';
import Icon from '@/components/ui/icon';
import Spinner from '@/components/ui/spinner';
import ToggleButtons from '@/components/ui/toggle-buttons';
import ConfirmModal from '@/components/ui/confirm-modal';
import Modal from '@/components/ui/modal';
import StitchLayersModal from './StitchLayersModal';

export default function RightSidebar() {
  const {
    id,
    token,
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
    imageModels,
    viewerRef,
    pendingLayersRef,
    meshPrompts,
    setMeshPrompts,
    cameraAngles,
    setCameraAngles,
    selectedAngleId,
    setSelectedAngleId,
    angleRefView,
    setAngleRefView,
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
    loadMeshLayers,
    refreshLayerTextures,
    formatTriangleCount,
  } = useProject();

  // ── Local state ──
  const [editingLayerId, setEditingLayerId] = useState(null);
  const [editingLayerName, setEditingLayerName] = useState('');
  const [showStitchModal, setShowStitchModal] = useState(false);
  const [layerMenuOpenId, setLayerMenuOpenId] = useState(null);
  const [layerMenuPos, setLayerMenuPos] = useState({ top: 0, right: 0 });
  const [deleteLayerTarget, setDeleteLayerTarget] = useState(null);
  const [showLayerLimitModal, setShowLayerLimitModal] = useState(false);
  const dragLayerIndexRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const [projectionMode, setProjectionMode] = useState('orthographic');

  // ── formatFileSize ──
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // ── generateAngleThumbnails ──
  const generateAngleThumbnails = useCallback(
    async (mesh, angles) => {
      if (!mesh?.object || angles.length === 0) return [];

      const size = 75;
      const thumbRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      thumbRenderer.setPixelRatio(window.devicePixelRatio);
      thumbRenderer.setSize(size, size);
      thumbRenderer.setClearColor(0x000000, 0);

      const thumbScene = new THREE.Scene();
      thumbScene.background = null;
      const thumbCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

      const ambient = new THREE.AmbientLight(0xffffff, 1.0);
      thumbScene.add(ambient);
      const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
      dirLight1.position.set(5, 10, 7);
      thumbScene.add(dirLight1);
      const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight2.position.set(-5, -3, -7);
      thumbScene.add(dirLight2);
      const dirLight3 = new THREE.DirectionalLight(0xffffff, 0.5);
      dirLight3.position.set(0, -8, 5);
      thumbScene.add(dirLight3);

      const thumbMesh = mesh.object.clone(true);
      thumbMesh.traverse((child) => {
        if (child.isMesh) {
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
          child.material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
        }
      });
      thumbScene.add(thumbMesh);

      const box = new THREE.Box3().setFromObject(thumbMesh);
      const center = box.getCenter(new THREE.Vector3());
      const size3 = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;
      thumbMesh.position.sub(center);

      const thumbnails = [];
      for (const angle of angles) {
        const rotation = JSON.parse(angle.rotation || '{}');
        thumbCamera.rotation.set(
          THREE.MathUtils.degToRad(rotation.x || 0),
          THREE.MathUtils.degToRad(rotation.y || 0),
          THREE.MathUtils.degToRad(rotation.z || 0)
        );
        thumbCamera.updateMatrixWorld();
        const distance =
          (maxDim / 2) / Math.tan((thumbCamera.fov * Math.PI / 180) / 2) * 1.4;
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(thumbCamera.quaternion);
        thumbCamera.position.copy(forward).multiplyScalar(-distance);
        thumbCamera.updateProjectionMatrix();
        thumbRenderer.clear();
        thumbRenderer.render(thumbScene, thumbCamera);
        thumbnails.push(thumbRenderer.domElement.toDataURL('image/png'));
      }

      thumbScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      thumbRenderer.dispose();
      thumbRenderer.forceContextLoss();

      return thumbnails;
    },
    []
  );

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

      loadMeshLayers(meshDbId).then((layers) => {
        pendingLayersRef.current = layers;
      });

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
      pendingLayersRef,
      allCameraAngles,
      thumbnailCache,
      setThumbnailCache,
      generateAngleThumbnails,
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

  // ── Layer handlers ──
  const handleAddLayer = async () => {
    if (!selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    if (meshLayers.length >= 16) {
      setShowLayerLimitModal(true);
      return;
    }
    const layerNum = meshLayers.length + 1;
    try {
      const res = await layerApi.create(id, meshDbId, `Layer ${layerNum}`);
      if (res.data?.success) {
        await loadMeshLayers(meshDbId);
      }
    } catch (err) {
      console.error('Failed to add layer:', err);
    }
  };

  const handleEditLayerName = (layer) => {
    setEditingLayerId(layer.id);
    setEditingLayerName(layer.name);
  };

  const handleSaveLayerName = async (layerId) => {
    const name = editingLayerName.trim();
    setEditingLayerId(null);
    setEditingLayerName('');
    if (!name) return;
    try {
      await layerApi.updateName(id, layerId, name);
      setMeshLayers((prev) => prev.map((l) => (l.id === layerId ? { ...l, name } : l)));
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
    try {
      await layerApi.toggleVisible(id, layer.id, newVisible);
      await refreshLayerTextures(updatedLayers);
    } catch (err) {
      console.error('Failed to toggle layer visibility:', err);
      setMeshLayers(meshLayers);
    }
  };

  const handleDeleteLayer = async (layer) => {
    if (!layer || !selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    setMeshLayers((prev) => prev.filter((l) => l.id !== layer.id));
    try {
      await layerApi.delete(id, layer.id);
      const updatedLayers = await loadMeshLayers(meshDbId);
      await refreshLayerTextures(updatedLayers);
    } catch (err) {
      console.error('Failed to delete layer:', err);
      await loadMeshLayers(meshDbId);
    }
  };

  const handleReprojectLayer = async (layer) => {
    if (!selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
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

      let rotation = null;
      if (layer.cameraAngle) {
        try {
          rotation = JSON.parse(layer.cameraAngle);
        } catch {
          /* ignore */
        }
      }

      const uvMapPromise = viewerRef.current?.projectImageToUvMap(
        imageDataUrl,
        rotation,
        1024
      );
      if (!uvMapPromise) throw new Error('Failed to project image (viewer returned null)');
      const uvMapDataUrl = await uvMapPromise;
      if (!uvMapDataUrl) throw new Error('Failed to generate UV map');

      await layerApi.saveUvMap(id, layer.id, meshDbId, uvMapDataUrl);
      const updatedLayers = await loadMeshLayers(meshDbId);
      await refreshLayerTextures(updatedLayers);
    } catch (err) {
      console.error('Reprojection failed:', err);
    }
  };

  const handleLayerDragStart = (e, index) => {
    dragLayerIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleLayerDrop = async (e, dropIndex) => {
    e.preventDefault();
    const dragIndex = dragLayerIndexRef.current;
    dragLayerIndexRef.current = null;
    if (dragIndex === null || dragIndex === dropIndex) return;

    const reordered = [...meshLayers];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    setMeshLayers(reordered);

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

  const handleStitched = async () => {
    setShowStitchModal(false);
    if (!selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    const updatedLayers = await loadMeshLayers(meshDbId);
    await refreshLayerTextures(updatedLayers);
  };

  const handleDeleteLayerClick = (layer) => {
    setDeleteLayerTarget(layer);
  };

  const confirmDeleteLayer = async () => {
    const layer = deleteLayerTarget;
    setDeleteLayerTarget(null);
    if (layer) await handleDeleteLayer(layer);
  };

  return (
    <aside className="fixed top-0 right-0 z-20 h-screen w-72 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Meshes</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
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
                  onClick={() => setShowStitchModal(true)}
                  disabled={!selectedMesh || meshLayers.length === 0}
                  className="p-1 rounded text-gray-500 hover:text-green-600 dark:hover:text-green-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Stitch all layers together"
                  title="Stitch all layers together"
                >
                  <Icon name="photo_auto_merge" className="text-lg" />
                </button>
                <button
                  onClick={handleAddLayer}
                  disabled={!selectedMesh}
                  className="p-1 rounded text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Add layer"
                  title="Add a new layer"
                >
                  <Icon name="add" className="text-lg" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {meshLayers.length === 0 ? (
                <div className="p-3 text-xs text-gray-400 dark:text-gray-500 text-center">
                  No layers yet. Click + to add one.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {meshLayers.map((layer, index) => (
                    <li
                      key={layer.id}
                      draggable
                      onDragStart={(e) => handleLayerDragStart(e, index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleLayerDrop(e, index)}
                      className="px-2 py-2 group hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
                    >
                      {/* Top row: drag handle + thumbnail + (name + edit + 3-dots) aligned to top */}
                      <div className="flex items-start gap-2">
                        {/* Drag handle — centered vertically against the 75px thumbnail */}
                        <span
                          className="cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 flex-shrink-0"
                          style={{ height: 75, display: 'flex', alignItems: 'center' }}
                          title="Drag to reorder"
                        >
                          <Icon name="drag_indicator" className="text-base" />
                        </span>

                        {/* 75x75 UV map thumbnail container */}
                        <div
                          className="flex-shrink-0 rounded border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-100 dark:bg-gray-700"
                          style={{ width: 75, height: 75 }}
                        >
                          {layer.hasImage !== false && (
                            <img
                              src={`${layerApi.uvmapThumbUrl(id, meshDbIds[selectedMesh.key], layer.id)}?r=${Math.random()}`}
                              alt={layer.name}
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>

                        {/* Right column: name row + visibility icon below */}
                        <div className="min-w-0 flex-1 flex flex-col">
                          {/* Name + edit + 3-dots row (top-aligned) */}
                          <div className="flex items-center gap-1">
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

                            {/* Edit icon (same row as name, far right) */}
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

                          {/* Bottom row: visibility toggle (left) + trash icon (right) */}
                          <div className="flex items-center justify-between mt-1">
                            <button
                              onClick={() => handleToggleLayerVisible(layer)}
                              className={`flex-shrink-0 transition ${layer.visible !== false ? 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300' : 'text-gray-300 dark:text-gray-600 hover:text-gray-500'}`}
                              aria-label={layer.visible !== false ? 'Hide layer' : 'Show layer'}
                              title={layer.visible !== false ? 'Hide layer' : 'Show layer'}
                            >
                              <Icon name={layer.visible !== false ? 'visibility' : 'visibility_off'} className="text-2xl" />
                            </button>
                            <button
                              onClick={() => handleDeleteLayerClick(layer)}
                              className="flex-shrink-0 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition"
                              aria-label="Delete layer"
                              title="Delete layer"
                            >
                              <Icon name="delete" className="text-base" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pinned to the bottom of the sidebar */}
      <div className="flex-shrink-0 overflow-y-auto max-h-[60%] border-t border-gray-200 dark:border-gray-700">
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
                    <a
                      href={ProjectModels({ token }).downloadUrl(id, model.id)}
                      className="p-1.5 text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 transition"
                      aria-label="Download"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>
                    <button
                      onClick={() => { if (confirm('Delete this model?')) handleDeleteModel(model.id); }}
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

      {/* ── Modals ── */}

      <ConfirmModal
        show={showLayerLimitModal}
        title="Layer limit reached"
        message="You already have 16 layers on this mesh, which is the maximum supported by the shader. Remove an existing layer before adding a new one."
        confirmLabel="OK"
        confirmColor="gray"
        showCancel={false}
        onConfirm={() => setShowLayerLimitModal(false)}
        onClose={() => setShowLayerLimitModal(false)}
      />

      {deleteLayerTarget && (
        <Modal
          title="Delete Layer"
          onClose={() => setDeleteLayerTarget(null)}
        >
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            Do you really want to delete this mesh layer? This cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setDeleteLayerTarget(null)}
              className="px-4 py-2 border-2 border-gray-400 text-gray-600 dark:text-gray-300 dark:border-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium text-sm"
            >
              Cancel
            </button>
            <button
              onClick={confirmDeleteLayer}
              className="px-4 py-2 border-2 border-red-600 text-red-600 dark:text-red-400 dark:border-red-500 rounded-lg hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white transition font-medium text-sm"
            >
              Delete Layer
            </button>
          </div>
        </Modal>
      )}

      {showStitchModal && selectedMesh && (
        <StitchLayersModal
          layers={meshLayers}
          projectId={id}
          meshDbId={meshDbIds[selectedMesh.key]}
          token={token}
          imageModels={imageModels}
          layerApi={layerApi}
          onClose={() => setShowStitchModal(false)}
          onStitched={handleStitched}
        />
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
