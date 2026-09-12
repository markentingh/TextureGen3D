import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { useParams, Link } from 'react-router-dom';
import * as signalR from '@microsoft/signalr';
import { useSession } from '@/context/session';
import { Projects } from '@/api/user/projects';
import { ProjectModels } from '@/api/user/projectModels';
import { ProjectMeshes } from '@/api/user/projectMeshes';
import { ProjectCameraAngles } from '@/api/user/projectCameraAngles';
import { ProjectReferences } from '@/api/user/projectReferences';
import { ProjectMeshReferences } from '@/api/user/projectMeshReferences';
import { ProjectMeshLayers } from '@/api/user/projectMeshLayers';
import { parseModel, formatTriangleCount, serializeMeshData, serializeUVMapData, deserializeMeshData } from '@/utils/modelParser';
import ModelViewer from '@/components/viewer/ModelViewer';
import ReferenceModal from './ReferenceModal';
import ReferenceCell from './ReferenceCell';
import ProjectReferencesModal from './ProjectReferencesModal';
import Icon from '@/components/ui/icon';
import TextArea from '@/components/forms/textarea';
import Select from '@/components/forms/select';
import Spinner from '@/components/ui/spinner';
import ToggleButtons from '@/components/ui/toggle-buttons';
import ConfirmModal from '@/components/ui/confirm-modal';

const MouseRotateIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="7" y="2" width="10" height="20" rx="5" />
    <rect x="10.5" y="2" width="3" height="6" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);
const MousePanIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="7" y="2" width="10" height="20" rx="5" />
    <rect x="13.5" y="2" width="3" height="6" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);
const MouseZoomIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="7" y="2" width="10" height="20" rx="5" />
    <rect x="10.5" y="2" width="3" height="6" rx="1.5" fill="currentColor" stroke="none" />
    <path d="M12 11v6" strokeLinecap="round" />
    <path d="M9 14l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MouseHint = React.memo(function MouseHint({ icon, label, title }) {
  return (
    <div title={title} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-charcoal-700/85 backdrop-blur-sm border-2 border-gray-300/60 text-charcoal-100 text-xs font-medium shadow-lg cursor-help">
      <span className="text-gray-300">{icon}</span>
      <span>{label}</span>
    </div>
  );
});

export default function ProjectDetailsPage() {
  const { id } = useParams();
  const { token, logout } = useSession();
  const [project, setProject] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const fileInputRef = useRef(null);

  // Extracted mesh data keyed by modelId (from DB or freshly parsed)
  const [meshData, setMeshData] = useState({});
  const [parsingModels, setParsingModels] = useState({});
  const [parseErrors, setParseErrors] = useState({});

  // Currently selected mesh for canvas rendering
  const [selectedMesh, setSelectedMesh] = useState(null);

  // Generate Images section
  const viewerRef = useRef(null);
  const [cameraAngles, setCameraAngles] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [imageModels, setImageModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [comfyProgress, setComfyProgress] = useState(0);
  const [comfyMessage, setComfyMessage] = useState('');

  // Map of saved mesh DB IDs keyed by `${modelId}-${meshIndex}` for camera angle association
  const [meshDbIds, setMeshDbIds] = useState({});

  // Guard against double-execution (React StrictMode + effect re-runs)
  const loadedRef = useRef(false);

  // Cache of generated thumbnails keyed by meshKey → angleId → dataURL
  const [thumbnailCache, setThumbnailCache] = useState({});

  // All camera angles for the project, keyed by meshDbId → array of angles
  const [allCameraAngles, setAllCameraAngles] = useState({});

  // Viewport projection mode
  const [projectionMode, setProjectionMode] = useState('orthographic');
  // Image generation mode: 'angles' (multi-angle) or 'single'
  const [generationMode, setGenerationMode] = useState('angles');

  // Reference images
  const [references, setReferences] = useState([]);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [refDragOver, setRefDragOver] = useState(false);
  const [refModal, setRefModal] = useState(null); // { reference, mode } or null
  const [projectRefsModal, setProjectRefsModal] = useState(false);
  const refFileInputRef = useRef(null);

  // Mesh references: map of meshDbId -> array of { projectReferenceId, meshRefId, active }
  const [meshReferences, setMeshReferences] = useState({});
  // Currently displayed references for the selected mesh (resolved from project refs + mesh refs)
  const [meshRefView, setMeshRefView] = useState([]);
  // All project references (for the modal and resolving mesh refs)
  const [projectRefs, setProjectRefs] = useState([]);
  // Prompt debounce timer
  const promptDebounceRef = useRef(null);
  // Map of meshDbId -> prompt (loaded from DB)
  const [meshPrompts, setMeshPrompts] = useState({});

  // Mesh layers: map of meshDbId -> array of layers
  const [meshLayers, setMeshLayers] = useState([]);
  const [allMeshLayers, setAllMeshLayers] = useState({});
  const [editingLayerId, setEditingLayerId] = useState(null);
  const [showLayerLimitModal, setShowLayerLimitModal] = useState(false);
  const [editingLayerName, setEditingLayerName] = useState('');
  const dragLayerIndexRef = useRef(null);
  const layerApi = ProjectMeshLayers({ token });

  const meshDataRef = useRef({});
  const parsingModelsRef = useRef({});
  const thumbGenAttemptedRef = useRef(false);
  meshDataRef.current = meshData;
  parsingModelsRef.current = parsingModels;

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
      // Only show type 1 (Depth To Image) models in the generate popup
      const depthImageModels = (data.imageModels || []).filter(m => m.type === 1);
      setImageModels(depthImageModels);

      // Initialize the image-model dropdown: prefer the project's saved
      // ImageModelId; otherwise check localStorage for a preferred model key;
      // otherwise default to the first available image model.
      // No API call here — the preference is only saved on user input.
      const imageModelList = depthImageModels;
      const savedImageModelId = data.project?.imageModelId;
      const hasSaved = savedImageModelId && imageModelList.some((m) => m.id === savedImageModelId);
      if (hasSaved) {
        setSelectedModelId(savedImageModelId);
      } else {
        const preferredKey = localStorage.getItem('preferredImageModel');
        const preferredModel = preferredKey
          ? imageModelList.find((m) => m.modelKey === preferredKey)
          : null;
        if (preferredModel) {
          setSelectedModelId(preferredModel.id);
        } else if (imageModelList.length > 0) {
          setSelectedModelId(imageModelList[0].id);
        } else {
          setSelectedModelId('');
        }
      }

      // Process saved meshes
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

        // Store mesh prompts from DB
        const newMeshPrompts = {};
        for (const mesh of savedMeshes) {
          newMeshPrompts[mesh.id] = mesh.prompt || '';
        }
        setMeshPrompts(newMeshPrompts);

        // Process camera angles
        const allAngles = data.angles || [];
        const anglesByMesh = {};
        for (const angle of allAngles) {
          if (!anglesByMesh[angle.meshId]) anglesByMesh[angle.meshId] = [];
          anglesByMesh[angle.meshId].push(angle);
        }
        setAllCameraAngles(anglesByMesh);
      } else {
        // No saved meshes — download and parse each model, then save to DB
        for (const model of (data.models || [])) {
          if (!meshDataRef.current[model.id] && !parsingModelsRef.current[model.id]) {
            downloadAndParseModel(model);
          }
        }
      }

      // Load project reference images (all references for the project)
      try {
        const refApi = ProjectReferences({ token });
        const refRes = await refApi.getByProject(id);
        if (refRes.data?.success) {
          setProjectRefs(refRes.data.data || []);
        }
      } catch { /* references optional */ }

      // Load all mesh references for the project
      try {
        const meshRefApi = ProjectMeshReferences({ token });
        const allMeshRefs = {};
        for (const mesh of (data.meshes || [])) {
          const mrRes = await meshRefApi.getByMesh(id, mesh.id);
          if (mrRes.data?.success) {
            allMeshRefs[mesh.id] = mrRes.data.data || [];
          }
        }
        setMeshReferences(allMeshRefs);
      } catch { /* mesh references optional */ }

      // Load all mesh layers for the project
      try {
        const allLayers = {};
        for (const mesh of (data.meshes || [])) {
          const lRes = await layerApi.getByMesh(id, mesh.id);
          if (lRes.data?.success) {
            allLayers[mesh.id] = lRes.data.data || [];
          }
        }
        setAllMeshLayers(allLayers);
      } catch { /* layers optional */ }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const handleAddCameraAngle = async () => {
    if (!viewerRef.current || !selectedMesh) return;
    const thumb = viewerRef.current.captureThumbnail(75);
    const rotation = viewerRef.current.getCameraRotation();

    // Save to database
    const meshDbId = meshDbIds[selectedMesh.key];
    if (meshDbId) {
      try {
        const anglesApi = ProjectCameraAngles({ token });
        const res = await anglesApi.create(id, {
          modelId: selectedMesh.modelId,
          meshId: meshDbId,
          rotation: JSON.stringify(rotation),
        });
        if (res.data.success) {
          const savedAngle = res.data.data;
          // Cache the thumbnail
          setThumbnailCache((prev) => ({
            ...prev,
            [selectedMesh.key]: {
              ...(prev[selectedMesh.key] || {}),
              [savedAngle.id]: thumb,
            },
          }));
          setCameraAngles((prev) => [...prev, {
            id: savedAngle.id,
            dbId: savedAngle.id,
            thumbnail: thumb,
            rotation,
          }]);
          // Also add to allCameraAngles
          setAllCameraAngles((prev) => ({
            ...prev,
            [meshDbId]: [...(prev[meshDbId] || []), savedAngle],
          }));
          return;
        }
      } catch (err) {
        // Fall through to local-only on error
      }
    }
    // Local-only fallback
    setCameraAngles((prev) => [...prev, {
      id: Date.now(),
      thumbnail: thumb,
      rotation,
    }]);
  };

  const handleAddStandardAngles = async () => {
    if (!viewerRef.current || !selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;

    // Standard 6 views: front, left, right, back, top, bottom
    // Camera looks down -Z by default, so:
    //   front  = looking from +Z toward -Z (rotation y=0)
    //   back   = looking from -Z toward +Z (rotation y=180)
    //   right  = looking from +X toward -X (rotation y=-90)
    //   left   = looking from -X toward +X (rotation y=90)
    //   top    = looking from +Y toward -Y (rotation x=-90)
    //   bottom = looking from -Y toward +Y (rotation x=90)
    const standardAngles = [
      { name: 'Front',  rotation: { x: 0,   y: 0,    z: 0 } },
      { name: 'Left',   rotation: { x: 0,   y: 90,   z: 0 } },
      { name: 'Right',  rotation: { x: 0,   y: -90,  z: 0 } },
      { name: 'Back',   rotation: { x: 0,   y: 180,  z: 0 } },
      { name: 'Top',    rotation: { x: -90, y: 0,    z: 0 } },
      { name: 'Bottom', rotation: { x: 90,  y: 0,    z: 0 } },
    ];

    try {
      const anglesApi = ProjectCameraAngles({ token });

      // Delete all existing angles for the selected mesh only
      await anglesApi.deleteAllByMesh(id, meshDbId);

      // Clear local state for this mesh only
      setCameraAngles([]);
      setThumbnailCache((prev) => ({ ...prev, [selectedMesh.key]: {} }));
      setAllCameraAngles((prev) => ({ ...prev, [meshDbId]: [] }));

      // Add each standard angle
      const newAngles = [];
      const newThumbs = {};
      for (const angle of standardAngles) {
        // Capture thumbnail for this rotation behind the scenes
        // (without rotating the main canvas camera)
        const thumb = viewerRef.current.captureThumbnail(75, angle.rotation);

        const res = await anglesApi.create(id, {
          modelId: selectedMesh.modelId,
          meshId: meshDbId,
          rotation: JSON.stringify(angle.rotation),
        });
        if (res.data.success) {
          const saved = res.data.data;
          newAngles.push({
            id: saved.id,
            dbId: saved.id,
            thumbnail: thumb,
            rotation: angle.rotation,
          });
          newThumbs[saved.id] = thumb;
        }
      }

      setCameraAngles(newAngles);
      setThumbnailCache((prev) => ({
        ...prev,
        [selectedMesh.key]: { ...(prev[selectedMesh.key] || {}), ...newThumbs },
      }));
      setAllCameraAngles((prev) => ({
        ...prev,
        [meshDbId]: newAngles.map((a) => ({
          id: a.dbId,
          meshId: meshDbId,
          modelId: selectedMesh.modelId,
          rotation: JSON.stringify(a.rotation),
        })),
      }));
    } catch (err) {
      console.error('Failed to add standard angles:', err);
    }
  };

  const handleRemoveCameraAngle = async (angleId) => {
    const angle = cameraAngles.find((a) => a.id === angleId);
    // Remove from grid immediately
    setCameraAngles((prev) => prev.filter((a) => a.id !== angleId));
    if (angle?.dbId) {
      if (selectedMesh) {
        setThumbnailCache((prev) => {
          const meshCache = prev[selectedMesh.key];
          if (!meshCache) return prev;
          const next = { ...prev };
          next[selectedMesh.key] = { ...meshCache };
          delete next[selectedMesh.key][angle.dbId];
          return next;
        });
        // Remove from allCameraAngles
        const meshDbId = meshDbIds[selectedMesh.key];
        if (meshDbId) {
          setAllCameraAngles((prev) => ({
            ...prev,
            [meshDbId]: (prev[meshDbId] || []).filter((a) => a.id !== angle.dbId),
          }));
        }
      }
      // Then delete from the database
      try {
        const anglesApi = ProjectCameraAngles({ token });
        await anglesApi.delete(id, angle.dbId);
      } catch (err) {
        // Ignore DB delete errors — grid is already updated
      }
    }
  };

  const handleGenerate = async () => {
    if (!selectedMesh || !selectedModelId) return;
    if (generationMode === 'angles' && cameraAngles.length === 0) return;
    if (!prompt.trim() && meshRefView.filter((r) => r.active).length === 0) return;

    setGenerating(true);
    setComfyProgress(0);
    setComfyMessage('');
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) { setGenerating(false); return; }

    try {
      if (generationMode === 'single') {
        // Single image mode: create a new layer, generate depth map, call image gen API
        const layerNum = meshLayers.length + 1;
        const layerRes = await layerApi.create(id, meshDbId, `Layer ${layerNum}`);
        if (!layerRes.data?.success) throw new Error('Failed to create layer');
        const layer = layerRes.data.data;

        // Generate depth map from current camera view
        const depthMap = viewerRef.current?.captureDepthMap(1024);
        if (!depthMap) throw new Error('Failed to generate depth map');

        // Build the full prompt: append mesh prompt and explain the depth map usage
        const fullPrompt = `${prompt}\n\nMesh prompt: ${meshPrompts[meshDbId] || ''}\n\nApply the image references to a 3D model using the provided depth map. The first image is a depth map of the 3D model from the current camera angle.`;

        let generatedImage;

        if (isComfyUI) {
          // ComfyUI: use SignalR hub for generation with progress tracking
          generatedImage = await new Promise((resolve, reject) => {
            const connection = new signalR.HubConnectionBuilder()
              .withUrl('/hubs/comfyui', {
                accessTokenFactory: () => token,
              })
              .withAutomaticReconnect()
              .build();

            connection.on('ProgressUpdate', (value, message) => {
              setComfyProgress(value);
              if (message) setComfyMessage(message);
            });

            connection.on('GenerationComplete', async (base64Image) => {
              try {
                // Save the ComfyUI result to the layer (image + thumb + depth map)
                const saveRes = await layerApi.saveComfyUiResult(id, layer.id, meshDbId, base64Image, depthMap);
                if (!saveRes.data?.success) throw new Error('Failed to save ComfyUI result');
                await connection.stop();
                resolve(base64Image);
              } catch (err) {
                await connection.stop();
                reject(err);
              }
            });

            connection.on('GenerationError', async (errorMsg) => {
              await connection.stop();
              reject(new Error(errorMsg));
            });

            connection.start()
              .then(() => {
                return connection.invoke('GenerateImage',
                  parseInt(selectedModelId),
                  fullPrompt,
                  depthMap,
                  id,
                  meshDbId
                );
              })
              .catch((err) => {
                connection.stop();
                reject(err);
              });
          });
        } else {
          // OpenAI: call the layer image generation API directly
          const genRes = await layerApi.generate(id, layer.id, meshDbId, parseInt(selectedModelId), fullPrompt, depthMap);
          if (!genRes.data?.success) throw new Error(genRes.data?.message || 'Image generation failed');
          generatedImage = genRes.data.data?.image; // base64 data URL
        }

        if (generatedImage) {
          // The backend already saved the image + thumbnail — now project onto UV map on the canvas
          const uvMapPromise = viewerRef.current?.projectImageToUvMap(generatedImage, null, 1024);
          if (uvMapPromise) {
            const uvMapDataUrl = await uvMapPromise;
            if (uvMapDataUrl) {
              // Save the UV map projection to the server
              await layerApi.saveUvMap(id, layer.id, meshDbId, uvMapDataUrl);
            }
          }

          // Reload layers to show the new image
          await loadMeshLayers(meshDbId);

          // Update the shader with all layer textures
          await refreshLayerTextures();
        }
      } else {
        // Camera angles mode: generate an image for each camera angle
        // TODO: implement multi-angle generation
        console.log('Camera angles generation not yet implemented');
      }
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      setGenerating(false);
      setComfyProgress(0);
      setComfyMessage('');
    }
  };

  /**
   * Download a model file from the server and parse it to extract meshes.
   * After parsing, saves all mesh data + UV map data to the database.
   */
  const downloadAndParseModel = async (model) => {
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

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const result = await parseModel(model.filename, buffer);

      setMeshData((prev) => ({
        ...prev,
        [model.id]: result,
      }));

      // Save all extracted meshes to the database
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
          // Track DB mesh IDs
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
  };

  /**
   * Parse a freshly uploaded file directly from the File object
   * (avoids re-downloading it from the server), then save meshes to DB.
   */
  const parseUploadedFile = async (modelId, file) => {
    setParsingModels((prev) => ({ ...prev, [modelId]: true }));
    try {
      const buffer = await file.arrayBuffer();
      const result = await parseModel(file.name, buffer);
      setMeshData((prev) => ({
        ...prev,
        [modelId]: result,
      }));

      // Save all extracted meshes to the database
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
  };

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

  const handleDeleteModel = async (modelId) => {
    if (!confirm('Delete this model?')) return;
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
        // Clear selection if the deleted model's mesh was selected
        if (selectedMesh && selectedMesh.modelId === modelId) {
          setSelectedMesh(null);
        }
        // Reload models + meshes + camera angles from the server so the
        // meshes list reflects the deletion.
        await loadProject();
      }
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Delete failed');
    }
  };

  const handleImageModelChange = async (e) => {
    const modelId = e.target.value;
    setSelectedModelId(modelId);
    setProject((prev) => (prev ? { ...prev, imageModelId: modelId } : prev));
    // Save the selected model key to localStorage
    const selectedModel = imageModels.find((m) => m.id?.toString() === modelId);
    if (selectedModel?.modelKey) {
      localStorage.setItem('preferredImageModel', selectedModel.modelKey);
    }
    // Persist the preferred image model id on the project (only on user input).
    try {
      const projectsApi = Projects({ token });
      await projectsApi.updateImageModel({
        id,
        imageModelId: modelId || null,
      });
    } catch (err) {
      console.error('Failed to save preferred image model:', err);
    }
  };

  // Debounced prompt save — saves to the selected mesh's prompt after 2 seconds of inactivity
  const handlePromptChange = (e) => {
    const value = e.target.value;
    setPrompt(value);
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (!meshDbId) return;
    promptDebounceRef.current = setTimeout(async () => {
      try {
        const meshesApi = ProjectMeshes({ token });
        await meshesApi.updatePrompt(id, meshDbId, value);
        setMeshPrompts((prev) => ({ ...prev, [meshDbId]: value }));
      } catch (err) {
        console.error('Failed to save prompt:', err);
      }
    }, 2000);
  };

  // ── Reference image handlers (mesh-scoped) ──
  const refreshMeshRefView = () => {
    if (!selectedMesh) { setMeshRefView([]); return; }
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) { setMeshRefView([]); return; }
    const meshRefs = meshReferences[meshDbId] || [];
    const refIds = new Set(meshRefs.map((mr) => mr.projectReferenceId));
    const resolved = projectRefs.filter((r) => refIds.has(r.id)).map((r) => ({
      ...r,
      meshRefId: meshRefs.find((mr) => mr.projectReferenceId === r.id)?.id,
      active: meshRefs.find((mr) => mr.projectReferenceId === r.id)?.active ?? true,
    }));
    setMeshRefView(resolved);
  };

  // Auto-refresh mesh ref view when mesh references, project refs, or selected mesh changes
  useEffect(() => {
    refreshMeshRefView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshReferences, projectRefs, selectedMesh, meshDbIds]);

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

  const handleRefDelete = async (ref) => {
    // Only delete the mesh reference record — don't delete the file
    if (!ref.meshRefId) return;
    try {
      const meshRefApi = ProjectMeshReferences({ token });
      await meshRefApi.delete(id, ref.meshRefId);
      // Update local state
      const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
      if (meshDbId) {
        setMeshReferences((prev) => ({
          ...prev,
          [meshDbId]: (prev[meshDbId] || []).filter((mr) => mr.projectReferenceId !== ref.id),
        }));
      }
      setMeshRefView((prev) => prev.filter((r) => r.id !== ref.id));
    } catch (err) {
      console.error('Failed to remove reference from mesh:', err);
    }
  };

  const handleRefToggleActive = async (ref) => {
    if (!ref.meshRefId) return;
    const newActive = !ref.active;
    setMeshRefView((prev) => prev.map((r) => r.id === ref.id ? { ...r, active: newActive } : r));
    try {
      const meshRefApi = ProjectMeshReferences({ token });
      await meshRefApi.updateActive(id, ref.meshRefId, newActive);
    } catch (err) {
      // Revert on failure
      setMeshRefView((prev) => prev.map((r) => r.id === ref.id ? { ...r, active: !newActive } : r));
      console.error('Failed to update reference active state:', err);
    }
  };

  // Called when the ProjectReferencesModal adds/removes references for the mesh
  const handleModalMeshRefChanged = async () => {
    if (!selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    try {
      const meshRefApi = ProjectMeshReferences({ token });
      const res = await meshRefApi.getByMesh(id, meshDbId);
      if (res.data?.success) {
        setMeshReferences((prev) => ({ ...prev, [meshDbId]: res.data.data || [] }));
      }
    } catch { /* ignore */ }
  };

  // Called when the ProjectReferencesModal uploads or deletes project references
  const handleModalProjectRefsChanged = async () => {
    try {
      const refApi = ProjectReferences({ token });
      const res = await refApi.getByProject(id);
      if (res.data?.success) {
        setProjectRefs(res.data.data || []);
      }
    } catch { /* ignore */ }
  };

  // ── Layer handlers ──
  const loadMeshLayers = async (meshDbId) => {
    if (!meshDbId) { setMeshLayers([]); return; }
    try {
      const res = await layerApi.getByMesh(id, meshDbId);
      if (res.data?.success) {
        setMeshLayers(res.data.data || []);
        setAllMeshLayers((prev) => ({ ...prev, [meshDbId]: res.data.data || [] }));
      }
    } catch { /* ignore */ }
  };

  const handleAddLayer = async () => {
    if (!selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    if (meshLayers.length >= 16) {
      setShowLayerLimitModal(true);
      return;
    }
    const layerNum = (meshLayers.length + 1);
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
      setMeshLayers((prev) => prev.map((l) => l.id === layerId ? { ...l, name } : l));
    } catch (err) {
      console.error('Failed to update layer name:', err);
    }
  };

  const handleDeleteLayer = async (layer) => {
    if (!selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    // Remove from UI immediately
    setMeshLayers((prev) => prev.filter((l) => l.id !== layer.id));
    try {
      await layerApi.delete(id, layer.id);
      await loadMeshLayers(meshDbId);
      refreshLayerTextures();
    } catch (err) {
      console.error('Failed to delete layer:', err);
      // Restore on failure
      await loadMeshLayers(meshDbId);
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

    // Persist the new order
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (meshDbId) {
      try {
        await layerApi.reorder(id, meshDbId, reordered.map((l) => l.id));
      } catch (err) {
        console.error('Failed to reorder layers:', err);
      }
    }

    // Update shader with new layer order
    refreshLayerTextures();
  };

  const refreshLayerTextures = async () => {
    if (!selectedMesh || !viewerRef.current) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    // Load UV maps for all layers in order and update the viewer
    const uvMapUrls = [];
    for (const layer of meshLayers) {
      try {
        const res = await fetch(layerApi.uvmapUrl(id, meshDbId, layer.id));
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          uvMapUrls.push(url);
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
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Collect all meshes across all models for the right sidebar
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

  // Memoize image model dropdown options
  const imageModelOptions = useMemo(() =>
    imageModels.map((m) => ({ value: m.id?.toString() || m.modelKey || m.name, label: m.name || m.model || m.modelKey })),
    [imageModels]
  );

  // Check if the selected image model is ComfyUI
  const selectedImageModel = useMemo(() =>
    imageModels.find((m) => m.id?.toString() === selectedModelId),
    [imageModels, selectedModelId]
  );
  const isComfyUI = selectedImageModel?.modelKey?.toLowerCase() === 'comfyui';

  // Select the first mesh when mesh data becomes available
  useEffect(() => {
    if (selectedMesh || allMeshes.length === 0) return;
    handleMeshSelect(allMeshes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMeshes.length, selectedMesh]);

  // Auto-generate project thumbnail from the first mesh if none exists
  useEffect(() => {
    if (thumbGenAttemptedRef.current) return;
    if (!project || project.hasThumb) return;
    if (!selectedMesh || !viewerRef.current) return;

    thumbGenAttemptedRef.current = true;

    // Wait for the mesh to finish loading in the viewer before capturing
    const timer = setTimeout(async () => {
      try {
        const thumb = viewerRef.current?.captureThumbnail(350);
        if (!thumb) return;
        const api = Projects({ token });
        await api.saveThumb(id, thumb);
      } catch (err) {
        console.error('Failed to auto-generate project thumbnail:', err);
      }
    }, 800);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, selectedMesh]);

  /**
   * Generate thumbnails for a batch of camera angles using a single hidden
   * Three.js canvas. The hidden canvas uses the same background color and
   * lighting as the main canvas. Destroyed after batch completion.
   * @param {Object} mesh - The selected mesh (with .object = THREE.Mesh)
   * @param {Array} angles - Array of saved angle objects with rotation JSON
   * @returns {Promise<string[]>} Array of thumbnail data URLs
   */
  const generateAngleThumbnails = async (mesh, angles) => {
    if (!mesh?.object || angles.length === 0) return [];

    const size = 75;

    // Create a single hidden offscreen renderer
    const thumbRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    thumbRenderer.setPixelRatio(window.devicePixelRatio);
    thumbRenderer.setSize(size, size);
    // Transparent background — the panel container provides the gradient
    thumbRenderer.setClearColor(0x000000, 0);

    const thumbScene = new THREE.Scene();
    thumbScene.background = null;
    const thumbCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

    // Same lighting as main canvas
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

    // Clone the mesh with normal-map material
    const thumbMesh = mesh.object.clone(true);
    thumbMesh.traverse((child) => {
      if (child.isMesh) {
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
        child.material = new THREE.MeshNormalMaterial({
          side: THREE.DoubleSide,
        });
      }
    });
    thumbScene.add(thumbMesh);

    // Compute bounding box to frame the mesh
    const box = new THREE.Box3().setFromObject(thumbMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size3 = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;
    // Center the mesh at origin
    thumbMesh.position.sub(center);

    const thumbnails = [];

    for (const angle of angles) {
      const rotation = JSON.parse(angle.rotation || '{}');
      // Set camera rotation based on saved angle
      thumbCamera.rotation.set(
        THREE.MathUtils.degToRad(rotation.x || 0),
        THREE.MathUtils.degToRad(rotation.y || 0),
        THREE.MathUtils.degToRad(rotation.z || 0),
      );
      thumbCamera.updateMatrixWorld();

      // Position the camera so that after rotation it still looks at the origin.
      const distance = (maxDim / 2) / Math.tan((thumbCamera.fov * Math.PI / 180) / 2) * 1.4;
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyQuaternion(thumbCamera.quaternion);
      thumbCamera.position.copy(forward).multiplyScalar(-distance);
      thumbCamera.updateProjectionMatrix();

      thumbRenderer.clear();
      thumbRenderer.render(thumbScene, thumbCamera);
      thumbnails.push(thumbRenderer.domElement.toDataURL('image/png'));
    }

    // Cleanup the single hidden canvas
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
  };

  const handleMeshSelect = async (mesh) => {
    setSelectedMesh(mesh);

    // Load the mesh's prompt
    const meshDbId = meshDbIds[mesh.key];
    if (meshDbId) {
      setPrompt(meshPrompts[meshDbId] || '');
    } else {
      setPrompt('');
    }

    // meshRefView is updated automatically by the useEffect watching meshReferences/projectRefs/selectedMesh

    // Load layers for this mesh
    loadMeshLayers(meshDbId);

    // Read camera angles for this mesh from the pre-loaded state
    if (meshDbId) {
      const savedAngles = allCameraAngles[meshDbId] || [];

      // Check which angles need thumbnails generated
      const cached = thumbnailCache[mesh.key] || {};
      const anglesNeedingThumbs = savedAngles.filter((a) => !cached[a.id]);
      const newThumbs = anglesNeedingThumbs.length > 0
        ? await generateAngleThumbnails(mesh, anglesNeedingThumbs)
        : [];

      // Merge cached + newly generated thumbnails
      const thumbMap = { ...cached };
      anglesNeedingThumbs.forEach((angle, i) => {
        thumbMap[angle.id] = newThumbs[i];
      });

      // Update cache
      if (anglesNeedingThumbs.length > 0) {
        setThumbnailCache((prev) => ({ ...prev, [mesh.key]: thumbMap }));
      }

      setCameraAngles(savedAngles.map((angle) => ({
        id: angle.id,
        dbId: angle.id,
        thumbnail: thumbMap[angle.id] || null,
        rotation: JSON.parse(angle.rotation || '{}'),
      })));
      return;
    }
    setCameraAngles([]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="text-4xl" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-gray-900 text-gray-100">
      {/* Three.js canvas (with integrated rotation gizmo) — reserves space for right sidebar */}
      <div className="absolute top-0 left-0 bottom-0 right-72">
        <ModelViewer ref={viewerRef} selectedMesh={selectedMesh} />
      </div>

      {/* Mouse control hints — charcoal grey tags overlapping the canvas bottom-right */}
      <div className="absolute bottom-4 z-20 flex gap-2 right-80">
        <MouseHint
          icon={MouseRotateIcon}
          label="Press & Rotate"
          title="Press and hold the middle mouse button, then drag to rotate the view"
        />
        <MouseHint
          icon={MousePanIcon}
          label="Press & Drag"
          title="Press and hold the right mouse button (or Shift + middle mouse button), then drag to pan the view"
        />
        <MouseHint
          icon={MouseZoomIcon}
          label="Scroll & Zoom"
          title="Scroll the middle mouse wheel up to zoom in, down to zoom out"
        />
      </div>

      {/* Hamburger button */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-4 left-4 z-30 p-2 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur shadow-md border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 transition"
        aria-label="Open menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Project title overlay (top-center) */}
      {project && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none">
          <h1 className="text-xl font-bold text-white drop-shadow-lg">{project.title}</h1>
          {project.description && (
            <p className="text-sm text-gray-300 drop-shadow-lg mt-0.5">{project.description}</p>
          )}
        </div>
      )}

      {/* Toggle panel button (bottom-left) — only visible when panel is minimized */}
      {!showPanel && models.length > 0 && (
        <button
          onClick={() => setShowPanel(true)}
          className="fixed bottom-4 left-4 z-30 p-2 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur shadow-md border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 transition"
          aria-label="Show upload panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}

      {/* Slide-out sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Slide-out sidebar (left) */}
      <aside
        className={`fixed top-0 left-0 z-50 h-screen w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-bold text-primary-600 dark:text-primary-500">TextureGen3D</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            <li>
              <Link to="/dashboard" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                Dashboard
              </Link>
            </li>
            <li>
              <Link to="/dashboard/projects" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                Projects
              </Link>
            </li>
            <li>
              <Link to="/dashboard/openai" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                OpenAI
              </Link>
            </li>
            <li>
              <Link to="/dashboard/billing" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                Billing
              </Link>
            </li>
            <li>
              <Link to="/dashboard/users" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                Users
              </Link>
            </li>
            <li>
              <button
                onClick={logout}
                className="w-full py-2 px-4 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"
              >
                Log out
              </button>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Right sidebar - Mesh list + Viewport + Models (always shown) */}
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
                      className="flex items-center gap-2 px-2 py-2 group hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
                    >
                      {/* Drag handle */}
                      <span
                        className="cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 flex-shrink-0"
                        title="Drag to reorder"
                      >
                        <Icon name="drag_indicator" className="text-base" />
                      </span>

                      {/* 75x75 image container */}
                      <div
                        className="flex-shrink-0 rounded border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-100 dark:bg-gray-700"
                        style={{ width: 75, height: 75 }}
                      >
                        {layer.hasImage !== false && (
                          <img
                            src={layerApi.thumbUrl(id, meshDbIds[selectedMesh.key], layer.id)}
                            alt={layer.name}
                            className="w-full h-full object-cover"
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        )}
                      </div>

                      {/* Layer name */}
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

                      {/* Edit + Delete icons (far right) */}
                      <div className="flex-shrink-0 flex flex-col items-center gap-1">
                        <button
                          onClick={() => handleEditLayerName(layer)}
                          className="text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition"
                          aria-label="Edit layer name"
                          title="Edit layer name"
                        >
                          <Icon name="edit" className="text-sm" />
                        </button>
                        <button
                          onClick={() => handleDeleteLayer(layer)}
                          className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition"
                          aria-label="Delete layer"
                          title="Delete layer"
                        >
                          <Icon name="delete" className="text-sm" />
                        </button>
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
                        onClick={() => handleDeleteModel(model.id)}
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
      </aside>

      {/* Bottom panel - Generate Images (only shown when models exist) */}
      {showPanel && models.length > 0 && (
        <div className="fixed bottom-0 left-0 z-20 w-80 max-w-[calc(100vw-20rem)] bg-white/95 dark:bg-gray-800/95 backdrop-blur border-t border-r border-gray-200 dark:border-gray-700 rounded-tr-lg shadow-lg max-h-[calc(100vh-5em)] flex flex-col">
          <div className="relative p-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Generate Images
            </h3>
            <button
              onClick={() => setShowPanel(false)}
              className="absolute top-1/2 right-3 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
              aria-label="Collapse panel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <div className="space-y-3">
              {/* Camera Angles subsection — only shown in 'angles' mode */}
              {generationMode === 'angles' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Camera Angles</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleAddStandardAngles}
                      disabled={!selectedMesh}
                      className="p-1 rounded text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                      aria-label="Add standard camera angles"
                      title={selectedMesh ? 'Set up the default camera angles' : 'Select a mesh first'}
                    >
                      <Icon name="360" className="text-xl" />
                    </button>
                    <button
                      onClick={handleAddCameraAngle}
                      disabled={!selectedMesh}
                      className="p-1 rounded text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                      aria-label="Add camera angle"
                      title={selectedMesh ? 'Add current camera angle' : 'Select a mesh first'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                </div>
                {cameraAngles.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">
                    {selectedMesh ? 'Click + to add the current camera angle' : 'Select a mesh first'}
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {cameraAngles.map((angle) => (
                      <div
                        key={angle.id}
                        onClick={() => viewerRef.current?.setCameraRotation(angle.rotation)}
                        className="relative group rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden cursor-pointer hover:ring-2 hover:ring-purple-500 transition"
                        style={{ background: 'radial-gradient(circle at center, #2a2a5e, #1a1a2e)' }}
                      >
                        <div
                          className="w-full mt-2 aspect-square bg-center bg-cover bg-no-repeat"
                          style={{
                            backgroundImage: angle.thumbnail ? `url(${angle.thumbnail})` : undefined,
                          }}
                        />
                        <div className="px-1 py-0.5 text-center">
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight tabular-nums">
                            X:{Math.round(angle.rotation.x)}, Y:{Math.round(angle.rotation.y)}, Z:{Math.round(angle.rotation.z)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveCameraAngle(angle.id); }}
                          className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition hover:bg-red-600"
                          aria-label="Remove camera angle"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* Prompt subsection */}
              <div>
                <ToggleButtons
                  value={generationMode}
                  onChange={setGenerationMode}
                  options={[
                    { value: 'single', label: 'Single Image' },
                    { value: 'angles', label: 'Camera Angles' },
                  ]}
                  className="mb-2"
                />
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Prompt</span>
                <TextArea
                  name="prompt"
                  value={prompt}
                  onChange={handlePromptChange}
                  placeholder="Describe the texture you want to generate..."
                  autoResize={true}
                  rows={2}
                  className="mb-0"
                />
              </div>

              {/* References subsection */}
              <div>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-2">Image References</span>
                <div
                  className={`grid grid-cols-3 gap-x-1 gap-y-3 p-1 rounded-lg w-fit transition`}
                >
                  {meshRefView.map((ref) => (
                    <ReferenceCell
                      key={ref.id}
                      ref_={ref}
                      projectId={id}
                      token={token}
                      onToggleActive={() => handleRefToggleActive(ref)}
                      onDelete={() => handleRefDelete(ref)}
                      onNewImage={() => setRefModal({ reference: ref, mode: 'new' })}
                      onEditImage={() => setRefModal({ reference: ref, mode: 'edit' })}
                    />
                  ))}
                  {/* Add cell — opens the project references modal */}
                  <div
                    onClick={() => setProjectRefsModal(true)}
                    className={`relative border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition border-gray-300 dark:border-gray-600 hover:border-purple-400 dark:hover:border-purple-500`}
                    style={{ width: 100, height: 80 }}
                  >
                    <>
                      <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="text-[8px] text-gray-400 dark:text-gray-500 text-center leading-tight px-1">Add</span>
                    </>
                  </div>
                </div>
              </div>

              {/* Model select */}
              <div>
                <Select
                  name="imageModel"
                  value={selectedModelId}
                  onChange={handleImageModelChange}
                  options={imageModelOptions}
                  className="mb-0"
                />
              </div>

            </div>
          </div>

          {/* Generate button — fixed at bottom, outside scroll area */}
          <div className="p-3 border-t border-gray-200 dark:border-gray-700">
            {generating && isComfyUI && comfyProgress > 0 && (
              <div className="mb-2">
                <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                  <span>{comfyMessage || 'Generating...'}</span>
                  <span>{comfyProgress}%</span>
                </div>
                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all duration-300 rounded-full"
                    style={{ width: `${comfyProgress}%` }}
                  />
                </div>
              </div>
            )}
            <button
              onClick={handleGenerate}
              disabled={generating || !selectedMesh || (generationMode === 'angles' && cameraAngles.length === 0) || (!prompt.trim() && meshRefView.filter((r) => r.active).length === 0) || !selectedModelId}
              className="w-full px-4 py-2 border-2 border-green-600 text-green-600 dark:text-green-500 dark:border-green-500 rounded-lg hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm"
            >
              {generating ? 'Generating...' : (generationMode === 'angles' ? 'Generate Images' : 'Generate Image')}
            </button>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 max-w-md p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg shadow-lg">
          {error}
        </div>
      )}

      {/* Reference modal */}
      {refModal && (
        <ReferenceModal
          reference={refModal.reference}
          projectId={id}
          token={token}
          imageModels={imageModels}
          mode={refModal.mode}
          onClose={() => setRefModal(null)}
          onSaved={async () => {
            await handleModalProjectRefsChanged();
            refreshMeshRefView();
          }}
        />
      )}

      {/* Project references modal */}
      {projectRefsModal && (
        <ProjectReferencesModal
          projectId={id}
          token={token}
          meshId={selectedMesh ? meshDbIds[selectedMesh.key] : null}
          onClose={() => setProjectRefsModal(false)}
          onAdded={handleModalMeshRefChanged}
          onDeleted={handleModalMeshRefChanged}
          onProjectReferencesChanged={async () => {
            await handleModalProjectRefsChanged();
            handleModalMeshRefChanged();
          }}
        />
      )}

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
    </div>
  );
}
