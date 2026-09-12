import React, { createContext, useContext, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useParams } from 'react-router-dom';
import { useSession } from '@/context/session';
import { Projects } from '@/api/user/projects';
import { ProjectModels } from '@/api/user/projectModels';
import { ProjectMeshes } from '@/api/user/projectMeshes';
import { ProjectReferences } from '@/api/user/projectReferences';
import { ProjectMeshReferences } from '@/api/user/projectMeshReferences';
import { ProjectMeshLayers } from '@/api/user/projectMeshLayers';
import {
  parseModel,
  formatTriangleCount,
  serializeMeshData,
  serializeUVMapData,
  deserializeMeshData,
  deserializeUVMapData,
} from '@/utils/modelParser';

const ProjectContext = createContext(null);

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}

export function ProjectProvider({ children }) {
  const { id } = useParams();
  const { token, logout } = useSession();

  // ── Core project state ──
  const [project, setProject] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Mesh data ──
  const [meshData, setMeshData] = useState({});
  const [parsingModels, setParsingModels] = useState({});
  const [parseErrors, setParseErrors] = useState({});
  const [selectedMesh, setSelectedMesh] = useState(null);
  const [meshDbIds, setMeshDbIds] = useState({});

  // ── Camera angles ──
  const [cameraAngles, setCameraAngles] = useState([]);
  const [selectedAngleId, setSelectedAngleId] = useState(null);
  const [angleRefView, setAngleRefView] = useState([]);
  const [allCameraAngles, setAllCameraAngles] = useState({});
  const [thumbnailCache, setThumbnailCache] = useState({});

  // ── Prompt ──
  const [prompt, setPrompt] = useState('');
  const [meshPrompts, setMeshPrompts] = useState({});

  // ── Image models ──
  const [imageModels, setImageModels] = useState([]);
  const [refImageModels, setRefImageModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');

  // ── Generation ──
  const [generating, setGenerating] = useState(false);
  const [comfyProgress, setComfyProgress] = useState(0);
  const [comfyMessage, setComfyMessage] = useState('');
  const [generatingAngleIds, setGeneratingAngleIds] = useState(new Set());
  const [completedAngleIds, setCompletedAngleIds] = useState(new Set());
  const [layerThumbVersion, setLayerThumbVersion] = useState(0);

  // ── Generation mode ──
  const [generationMode, setGenerationMode] = useState(() => {
    try {
      const saved = localStorage.getItem(`imageType:${id}`);
      return saved === '0' ? 'single' : 'angles';
    } catch {
      return 'angles';
    }
  });

  // ── References ──
  const [projectRefs, setProjectRefs] = useState([]);
  const [meshReferences, setMeshReferences] = useState({});
  const [meshRefView, setMeshRefView] = useState([]);

  // ── Layers ──
  const [meshLayers, setMeshLayers] = useState([]);
  const [allMeshLayers, setAllMeshLayers] = useState({});

  // ── Refs ──
  const viewerRef = useRef(null);
  const pendingLayersRef = useRef(null);
  const loadedRef = useRef(false);
  const promptDebounceRef = useRef(null);
  const meshDataRef = useRef({});
  const parsingModelsRef = useRef({});
  const thumbGenAttemptedRef = useRef(false);

  meshDataRef.current = meshData;
  parsingModelsRef.current = parsingModels;

  // ── API instance ──
  const layerApi = ProjectMeshLayers({ token });

  // ── Derived values ──
  const allMeshes = useMemo(() => {
    const result = [];
    for (const model of models) {
      const data = meshData[model.id];
      if (data) {
        for (let i = 0; i < data.meshes.length; i++) {
          const mesh = data.meshes[i];
          result.push({
            ...mesh,
            modelId: model.id,
            modelFilename: model.filename,
            meshIndex: i,
            key: `${model.id}-${i}`,
          });
        }
      }
    }
    return result;
  }, [models, meshData]);

  const imageModelOptions = useMemo(
    () =>
      imageModels.map((m) => ({
        value: m.id?.toString() || m.modelKey || m.name,
        label: m.name || m.model || m.modelKey,
      })),
    [imageModels]
  );

  const selectedImageModel = useMemo(
    () => imageModels.find((m) => String(m.id) === String(selectedModelId)),
    [imageModels, selectedModelId]
  );
  const isComfyUI = selectedImageModel?.modelKey?.toLowerCase() === 'comfyui';

  // ── Shared utilities (used by multiple components) ──

  const loadMeshLayers = useCallback(
    async (meshDbId) => {
      if (!meshDbId) {
        setMeshLayers([]);
        return [];
      }
      try {
        const res = await layerApi.getByMesh(id, meshDbId);
        if (res.data?.success) {
          const layers = res.data.data || [];
          setMeshLayers(layers);
          setAllMeshLayers((prev) => ({ ...prev, [meshDbId]: layers }));
          return layers;
        }
      } catch {
        /* ignore */
      }
      return [];
    },
    [id, layerApi]
  );

  const refreshLayerTextures = useCallback(
    async (layers = null) => {
      if (!selectedMesh || !viewerRef.current) return;
      const meshDbId = meshDbIds[selectedMesh.key];
      if (!meshDbId) return;
      const layerList = layers || meshLayers;
      const visibleLayers = layerList.filter((l) => l.visible !== false);
      const uvMapUrls = [];
      for (const layer of visibleLayers) {
        try {
          const res = await fetch(layerApi.uvmapUrl(id, meshDbId, layer.id), {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            const blob = await res.blob();
            if (blob.size > 0) {
              uvMapUrls.push(URL.createObjectURL(blob));
            } else {
              uvMapUrls.push(null);
            }
          } else {
            uvMapUrls.push(null);
          }
        } catch {
          uvMapUrls.push(null);
        }
      }
      const validUrls = uvMapUrls.filter((u) => u !== null);
      if (validUrls.length > 0) {
        viewerRef.current.updateLayerTextures(validUrls);
      } else {
        viewerRef.current.updateLayerTextures([]);
      }
    },
    [id, layerApi, meshDbIds, meshLayers, selectedMesh, token]
  );

  const refreshMeshRefView = useCallback(() => {
    if (!selectedMesh) {
      setMeshRefView([]);
      return;
    }
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) {
      setMeshRefView([]);
      return;
    }
    const meshRefs = meshReferences[meshDbId] || [];
    const refIds = new Set(meshRefs.map((mr) => mr.projectReferenceId));
    const resolved = projectRefs
      .filter((r) => refIds.has(r.id))
      .map((r) => ({
        ...r,
        meshRefId: meshRefs.find((mr) => mr.projectReferenceId === r.id)?.id,
        active: meshRefs.find((mr) => mr.projectReferenceId === r.id)?.active ?? true,
      }));
    setMeshRefView(resolved);
  }, [selectedMesh, meshDbIds, meshReferences, projectRefs]);

  // ── Project loading (called once from page.jsx) ──

  const downloadAndParseModel = useCallback(
    async (model) => {
      setParsingModels((prev) => ({ ...prev, [model.id]: true }));
      setParseErrors((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });

      try {
        const downloadUrl = ProjectModels({ token }).downloadUrl(id, model.id);
        const response = await fetch(downloadUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);

        const buffer = await response.arrayBuffer();
        const result = await parseModel(model.filename, buffer);

        setMeshData((prev) => ({ ...prev, [model.id]: result }));

        const meshesToSave = result.meshes.map((mesh) => ({
          modelId: model.id,
          name: mesh.name,
          meshData: serializeMeshData(mesh.object),
          uvMapData: serializeUVMapData(mesh.object),
          triangles: mesh.triangles,
          vertices: mesh.vertices,
        }));

        if (meshesToSave.length > 0) {
          const meshesApi = ProjectMeshes({ token });
          const saveRes = await meshesApi.createBatch(id, meshesToSave);
          if (saveRes.data.success) {
            const savedMeshes = saveRes.data.data || [];
            setMeshDbIds((prev) => {
              const next = { ...prev };
              savedMeshes.forEach((savedMesh, idx) => {
                next[`${model.id}-${idx}`] = savedMesh.id;
              });
              return next;
            });
          }
        }
      } catch (err) {
        setParseErrors((prev) => ({
          ...prev,
          [model.id]: err.message || 'Failed to parse model',
        }));
      } finally {
        setParsingModels((prev) => {
          const next = { ...prev };
          delete next[model.id];
          return next;
        });
      }
    },
    [id, token]
  );

  const parseUploadedFile = useCallback(
    async (modelId, file) => {
      setParsingModels((prev) => ({ ...prev, [modelId]: true }));
      try {
        const buffer = await file.arrayBuffer();
        const result = await parseModel(file.name, buffer);
        setMeshData((prev) => ({ ...prev, [modelId]: result }));

        const meshesToSave = result.meshes.map((mesh) => ({
          modelId,
          name: mesh.name,
          meshData: serializeMeshData(mesh.object),
          uvMapData: serializeUVMapData(mesh.object),
          triangles: mesh.triangles,
          vertices: mesh.vertices,
        }));

        if (meshesToSave.length > 0) {
          const meshesApi = ProjectMeshes({ token });
          const saveRes = await meshesApi.createBatch(id, meshesToSave);
          if (saveRes.data.success) {
            const savedMeshes = saveRes.data.data || [];
            setMeshDbIds((prev) => {
              const next = { ...prev };
              savedMeshes.forEach((savedMesh, idx) => {
                next[`${modelId}-${idx}`] = savedMesh.id;
              });
              return next;
            });
          }
        }
      } catch (err) {
        setParseErrors((prev) => ({
          ...prev,
          [modelId]: err.message || 'Failed to parse model',
        }));
      } finally {
        setParsingModels((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
      }
    },
    [id, token]
  );

  const loadProject = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = Projects({ token });
      const res = await api.load(id);
      if (!res.data.success) {
        setError(res.data.message || 'Failed to load project');
        return;
      }

      const data = res.data.data;
      setProject(data.project);
      setModels(data.models || []);

      const depthImageModels = (data.imageModels || []).filter((m) => m.type === 1);
      setImageModels(depthImageModels);
      setRefImageModels((data.imageModels || []).filter((m) => m.type === 0));

      const imageModelList = depthImageModels;
      const savedImageModelId = data.project?.imageModelId;
      const hasSaved =
        savedImageModelId &&
        imageModelList.some((m) => String(m.id) === String(savedImageModelId));
      if (hasSaved) {
        setSelectedModelId(String(savedImageModelId));
      } else {
        const preferredKey = localStorage.getItem('preferredImageModel');
        const preferredModel = preferredKey
          ? imageModelList.find((m) => m.modelKey === preferredKey)
          : null;
        if (preferredModel) {
          setSelectedModelId(String(preferredModel.id));
        } else if (imageModelList.length > 0) {
          setSelectedModelId(String(imageModelList[0].id));
        } else {
          setSelectedModelId('');
        }
      }

      const savedMeshes = data.meshes || [];
      if (savedMeshes.length > 0) {
        const newMeshData = {};
        const newMeshDbIds = {};
        for (const mesh of savedMeshes) {
          if (!newMeshData[mesh.modelId]) {
            newMeshData[mesh.modelId] = {
              meshes: [],
              totalTriangles: 0,
              totalVertices: 0,
              format: '',
              warnings: [],
              root: null,
            };
          }
          const geometry = deserializeMeshData(mesh.meshData);
          if (mesh.uvMapData) {
            const uvMaps = deserializeUVMapData(mesh.uvMapData);
            for (const uvMap of uvMaps) {
              const attrName = uvMap.name === 'uv' ? 'uv' : uvMap.name;
              geometry.setAttribute(
                attrName,
                new THREE.Float32BufferAttribute(uvMap.data, 2)
              );
            }
          }
          const threeMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
          threeMesh.name = mesh.name;
          newMeshData[mesh.modelId].meshes.push({
            name: mesh.name,
            triangles: mesh.triangles,
            vertices: mesh.vertices,
            uvMaps: [],
            boundingBox: null,
            materials: [],
            object: threeMesh,
          });
          newMeshData[mesh.modelId].totalTriangles += mesh.triangles;
          newMeshData[mesh.modelId].totalVertices += mesh.vertices;
          const meshIndex = newMeshData[mesh.modelId].meshes.length - 1;
          newMeshDbIds[`${mesh.modelId}-${meshIndex}`] = mesh.id;
        }
        setMeshData(newMeshData);
        setMeshDbIds(newMeshDbIds);

        const newMeshPrompts = {};
        for (const mesh of savedMeshes) {
          newMeshPrompts[mesh.id] = mesh.prompt || '';
        }
        setMeshPrompts(newMeshPrompts);

        const allAngles = data.angles || [];
        const anglesByMesh = {};
        for (const angle of allAngles) {
          if (!anglesByMesh[angle.meshId]) anglesByMesh[angle.meshId] = [];
          anglesByMesh[angle.meshId].push(angle);
        }
        setAllCameraAngles(anglesByMesh);
      } else {
        for (const model of data.models || []) {
          if (!meshDataRef.current[model.id] && !parsingModelsRef.current[model.id]) {
            downloadAndParseModel(model);
          }
        }
      }

      try {
        const refApi = ProjectReferences({ token });
        const refRes = await refApi.getByProject(id);
        if (refRes.data?.success) {
          setProjectRefs(refRes.data.data || []);
        }
      } catch {
        /* references optional */
      }

      try {
        const meshRefApi = ProjectMeshReferences({ token });
        const allMeshRefs = {};
        for (const mesh of data.meshes || []) {
          const mrRes = await meshRefApi.getByMesh(id, mesh.id);
          if (mrRes.data?.success) {
            allMeshRefs[mesh.id] = mrRes.data.data || [];
          }
        }
        setMeshReferences(allMeshRefs);
      } catch {
        /* mesh references optional */
      }

      try {
        const allLayers = {};
        for (const mesh of data.meshes || []) {
          const lRes = await layerApi.getByMesh(id, mesh.id);
          if (lRes.data?.success) {
            allLayers[mesh.id] = lRes.data.data || [];
          }
        }
        setAllMeshLayers(allLayers);
      } catch {
        /* layers optional */
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id, token, downloadAndParseModel, layerApi]);

  // ── Cross-cutting useEffects ──

  // Auto-refresh mesh ref view when mesh references, project refs, or selected mesh changes
  useEffect(() => {
    refreshMeshRefView();
  }, [meshReferences, projectRefs, selectedMesh, meshDbIds, refreshMeshRefView]);

  // When in angles mode, load the selected angle's prompt + reference once projectRefs are available
  useEffect(() => {
    if (generationMode !== 'angles' || !selectedAngleId || projectRefs.length === 0) return;
    const angle = cameraAngles.find((a) => a.id === selectedAngleId);
    if (!angle) return;
    setPrompt(angle.prompt || '');
    if (angle.projectReferenceId) {
      const ref = projectRefs.find((r) => r.id === angle.projectReferenceId);
      setAngleRefView(ref ? [{ ...ref, active: true }] : []);
    } else {
      setAngleRefView([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRefs, selectedAngleId, generationMode]);

  // Auto-load layers when selected mesh changes
  useEffect(() => {
    if (selectedMesh) {
      const meshDbId = meshDbIds[selectedMesh.key];
      if (meshDbId) {
        setMeshLayers(allMeshLayers[meshDbId] || []);
      } else {
        setMeshLayers([]);
      }
    } else {
      setMeshLayers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMesh, meshDbIds, allMeshLayers]);

  const value = {
    // params
    id,
    token,
    logout,
    // core state
    project,
    setProject,
    models,
    setModels,
    loading,
    setLoading,
    error,
    setError,
    // mesh data
    meshData,
    setMeshData,
    parsingModels,
    setParsingModels,
    parseErrors,
    setParseErrors,
    selectedMesh,
    setSelectedMesh,
    meshDbIds,
    setMeshDbIds,
    allMeshes,
    // camera angles
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
    // prompt
    prompt,
    setPrompt,
    meshPrompts,
    setMeshPrompts,
    // image models
    imageModels,
    setImageModels,
    refImageModels,
    setRefImageModels,
    selectedModelId,
    setSelectedModelId,
    imageModelOptions,
    selectedImageModel,
    isComfyUI,
    // generation
    generating,
    setGenerating,
    comfyProgress,
    setComfyProgress,
    comfyMessage,
    setComfyMessage,
    generatingAngleIds,
    setGeneratingAngleIds,
    completedAngleIds,
    setCompletedAngleIds,
    layerThumbVersion,
    setLayerThumbVersion,
    // generation mode
    generationMode,
    setGenerationMode,
    // references
    projectRefs,
    setProjectRefs,
    meshReferences,
    setMeshReferences,
    meshRefView,
    setMeshRefView,
    // layers
    meshLayers,
    setMeshLayers,
    allMeshLayers,
    setAllMeshLayers,
    // refs
    viewerRef,
    pendingLayersRef,
    loadedRef,
    promptDebounceRef,
    meshDataRef,
    parsingModelsRef,
    thumbGenAttemptedRef,
    // api
    layerApi,
    // shared utilities
    loadProject,
    downloadAndParseModel,
    parseUploadedFile,
    loadMeshLayers,
    refreshLayerTextures,
    refreshMeshRefView,
    // utils
    formatTriangleCount,
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
