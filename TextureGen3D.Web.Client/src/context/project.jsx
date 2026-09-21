import React, { createContext, useContext, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useParams } from 'react-router-dom';
import { useSession } from '@/context/session';
import { Projects } from '@/api/user/projects';
import { ProjectModels } from '@/api/user/projectModels';
import { ProjectMeshes } from '@/api/user/projectMeshes';
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
  const [inpaintImageModels, setInpaintImageModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [inpaintModelId, setInpaintModelId] = useState('');

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
  const allMeshLayersRef = useRef({});
  useEffect(() => { allMeshLayersRef.current = allMeshLayers; }, [allMeshLayers]);

  // ── Mask brush ──
  const [maskTool, setMaskTool] = useState('pointer'); // 'pointer' | 'brush' | 'eraser' | 'inpaint'
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [inpaintMaskVisible, setInpaintMaskVisible] = useState(true);
  const [inpaintSign, setInpaintSign] = useState('add'); // 'add' (white) | 'subtract' (black)
  const [ctrlHeld, setCtrlHeld] = useState(false); // Ctrl inverts the inpaint sign while held
  const [brushSize, setBrushSize] = useState(50);      // 1-300 (mask pixels, diameter)
  const [brushHardness, setBrushHardness] = useState(50); // 0-100
  const [brushSpread, setBrushSpread] = useState(0);   // 0-100 (screen px between stamps)
  const [brushOpacity, setBrushOpacity] = useState(100); // 1-100 (stamp alpha %)
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [modifiedLayerIds, setModifiedLayerIds] = useState(new Set());
  const [maskThumbVersions, setMaskThumbVersions] = useState({});

  const selectedLayerIdRef = useRef(null);
  useEffect(() => { selectedLayerIdRef.current = selectedLayerId; }, [selectedLayerId]);
  const maskToolRef = useRef(maskTool);
  useEffect(() => { maskToolRef.current = maskTool; }, [maskTool]);
  const selectedMeshRef = useRef(null);
  useEffect(() => { selectedMeshRef.current = selectedMesh; }, [selectedMesh]);
  const meshDbIdsRef = useRef({});
  useEffect(() => { meshDbIdsRef.current = meshDbIds; }, [meshDbIds]);
  // Map<layerId, meshDbId> — meshId captured at paint time so saves land in
  // the right folder even if the user switches meshes before the timer fires
  const modifiedLayerIdsRef = useRef(new Map());
  const maskSaveTimerRef = useRef(null);
  // layerId -> { a, b, front, initialized } — ping-pong WebGLRenderTargets;
  // front.texture feeds the layer shader's mask sampler
  const layerMasksRef = useRef(new Map());
  // Consumed by ModelViewer pointer handlers (stable ref, mutated in place)
  const maskPaintConfigRef = useRef({});

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

  const inpaintModelOptions = useMemo(
    () =>
      inpaintImageModels.map((m) => ({
        value: m.id?.toString() || m.modelKey || m.name,
        label: m.name || m.model || m.modelKey,
      })),
    [inpaintImageModels]
  );

  const selectedImageModel = useMemo(
    () => imageModels.find((m) => String(m.id) === String(selectedModelId)),
    [imageModels, selectedModelId]
  );
  const isComfyUI = selectedImageModel?.model?.toLowerCase() === 'comfyui';
  const isGradio = selectedImageModel?.model?.toLowerCase() === 'gradio';

  // ── Shared utilities (used by multiple components) ──

  // Returns the layer's mask entry, creating a 1024x1024 ping-pong render
  // target pair on first use. Called by ModelViewer when the brush first
  // touches a layer, and by refreshLayerTextures when loading saved masks.
  const getOrCreateLayerMask = useCallback((layerId) => {
    let entry = layerMasksRef.current.get(layerId);
    if (!entry) {
      const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
      const a = new THREE.WebGLRenderTarget(1024, 1024, opts);
      const b = new THREE.WebGLRenderTarget(1024, 1024, opts);
      entry = { a, b, front: a, initialized: false };
      layerMasksRef.current.set(layerId, entry);
      // Bind into the live shader if the layer is already textured
      viewerRef.current?.bindLayerMask?.(layerId, entry.front.texture);
    }
    return entry;
  }, []);

  const markMaskModified = useCallback((layerId) => {
    const meshDbId = selectedMeshRef.current ? meshDbIdsRef.current[selectedMeshRef.current.key] : null;
    const prev = modifiedLayerIdsRef.current.get(layerId);
    if (prev) return; // already tracked with a valid meshId
    modifiedLayerIdsRef.current.set(layerId, meshDbId);
    setModifiedLayerIds(new Set(modifiedLayerIdsRef.current.keys()));
  }, []);

  const cancelMaskSaveTimer = useCallback(() => {
    if (maskSaveTimerRef.current) {
      clearTimeout(maskSaveTimerRef.current);
      maskSaveTimerRef.current = null;
    }
  }, []);

  const saveModifiedMasks = useCallback(async () => {
    const entries = Array.from(modifiedLayerIdsRef.current.entries());
    if (entries.length === 0) return;

    // Group by meshId so each mask lands in its own mesh folder
    const byMesh = new Map();
    for (const [layerId, meshDbId] of entries) {
      if (!meshDbId) {
        console.warn(`[mask save] layer ${layerId} skipped — no meshId recorded at paint time`);
        continue;
      }
      const entry = layerMasksRef.current.get(layerId);
      if (!entry) continue;
      let dataUrl = null;
      try {
        dataUrl = viewerRef.current?.maskToDataURL?.(entry);
      } catch (err) {
        console.error(`[mask save] readback failed for layer ${layerId}:`, err);
      }
      if (!dataUrl) continue; // stays marked — retried on the next save
      if (!byMesh.has(meshDbId)) byMesh.set(meshDbId, []);
      byMesh.get(meshDbId).push({ layerId, base64Mask: dataUrl });
    }

    if (byMesh.size === 0) {
      setModifiedLayerIds(new Set(modifiedLayerIdsRef.current.keys()));
      return;
    }

    // Clear flags incrementally as each mesh's POST lands — a mid-flight
    // failure (or unload) keeps unsaved layers marked for retry/stash.
    const savedLayerIds = [];
    try {
      for (const [meshDbId, masks] of byMesh) {
        await layerApi.saveMasks(id, meshDbId, masks);
        for (const m of masks) {
          modifiedLayerIdsRef.current.delete(m.layerId);
          savedLayerIds.push(m.layerId);
        }
      }
    } catch (err) {
      console.error('Failed to save layer masks:', err);
    }
    // Refresh only the thumbnails whose masks were actually uploaded
    if (savedLayerIds.length > 0) {
      setMaskThumbVersions((prev) => {
        const next = { ...prev };
        for (const layerId of savedLayerIds) next[layerId] = (next[layerId] || 0) + 1;
        return next;
      });
    }
    setModifiedLayerIds(new Set(modifiedLayerIdsRef.current.keys()));
  }, [id, layerApi]);

  const scheduleMaskSave = useCallback(() => {
    cancelMaskSaveTimer();
    maskSaveTimerRef.current = setTimeout(saveModifiedMasks, 5000);
  }, [cancelMaskSaveTimer, saveModifiedMasks]);

  // ── Pending-mask stash ──
  // A refresh/close within the 5s debounce would otherwise lose strokes.
  // On unload, read back modified masks synchronously and stash them in
  // localStorage; on next load they're POSTed before the mask fetch runs.

  const stashUnsavedMasks = useCallback(() => {
    const entries = Array.from(modifiedLayerIdsRef.current.entries());
    const key = `pendingMasks:${id}`;
    try {
      const stash = {};
      for (const [layerId, meshDbId] of entries) {
        if (!meshDbId) continue;
        const entry = layerMasksRef.current.get(layerId);
        if (!entry) continue;
        const dataUrl = viewerRef.current?.maskToDataURL?.(entry);
        if (!dataUrl) continue;
        (stash[meshDbId] = stash[meshDbId] || []).push({ layerId, base64Mask: dataUrl });
      }
      if (Object.keys(stash).length > 0) {
        localStorage.setItem(key, JSON.stringify(stash));
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      /* storage full/blocked */
    }
  }, [id]);

  useEffect(() => {
    const flush = () => stashUnsavedMasks();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, [stashUnsavedMasks]);

  // Replay stashed masks once the project is loaded (POST before the mask
  // fetch in refreshLayerTextures reads mask.png from disk).
  useEffect(() => {
    if (!id || !token) return;
    const key = `pendingMasks:${id}`;
    let stash = null;
    try {
      stash = JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      stash = null;
    }
    if (!stash || Object.keys(stash).length === 0) return;
    (async () => {
      const remaining = {};
      const postedLayerIds = [];
      for (const [meshDbId, masks] of Object.entries(stash)) {
        try {
          await layerApi.saveMasks(id, meshDbId, masks);
          for (const m of masks) postedLayerIds.push(m.layerId);
        } catch {
          remaining[meshDbId] = masks;
        }
      }
      try {
        if (Object.keys(remaining).length > 0) {
          localStorage.setItem(key, JSON.stringify(remaining));
        } else {
          localStorage.removeItem(key);
        }
      } catch {
        /* ignore */
      }
      if (postedLayerIds.length > 0) {
        setMaskThumbVersions((prev) => {
          const next = { ...prev };
          for (const layerId of postedLayerIds) next[layerId] = (next[layerId] || 0) + 1;
          return next;
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  // Ctrl inverts the inpaint +/- toggle while held
  useEffect(() => {
    const down = (e) => { if (e.key === 'Control') setCtrlHeld(true); };
    const up = (e) => { if (e.key === 'Control') setCtrlHeld(false); };
    const blur = () => setCtrlHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Keep the paint config current — ModelViewer reads this ref in its
  // pointer handlers so brush changes never re-create the Three.js scene.
  useEffect(() => {
    maskPaintConfigRef.current = {
      tool: maskTool,
      sign: ctrlHeld ? (inpaintSign === 'add' ? 'subtract' : 'add') : inpaintSign,
      size: brushSize,
      setSize: setBrushSize,
      hardness: brushHardness,
      spread: brushSpread,
      opacity: brushOpacity,
      getSelectedLayerId: () => selectedLayerIdRef.current,
      getOrCreateLayerMask,
      markMaskModified,
      onStrokeStart: cancelMaskSaveTimer,
      onStrokeEnd: scheduleMaskSave,
    };
  }, [maskTool, inpaintSign, ctrlHeld, brushSize, brushHardness, brushSpread, brushOpacity, getOrCreateLayerMask, markMaskModified, cancelMaskSaveTimer, scheduleMaskSave]);

  // Inpainting mode — activate the mesh-wide overlay when the tool is selected,
  // tear it down whenever another tool takes over (Cancel, pointer, etc.)
  useEffect(() => {
    if (maskTool === 'inpaint') viewerRef.current?.beginInpaint?.();
    else viewerRef.current?.endInpaint?.();
  }, [maskTool]);

  // Brush/eraser splits the shader into baked below / live selected / baked
  // above textures — rebuild on any tool switch (entering or leaving paint
  // mode changes the layout), and on target-layer changes while painting.
  // Also creates/destroys the viewer's brush cursor ring.
  useEffect(() => {
    refreshLayerTextures();
    viewerRef.current?.setBrushRingActive?.(
      maskTool === 'brush' || maskTool === 'eraser' || maskTool === 'inpaint'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskTool]);
  useEffect(() => {
    if (maskTool === 'brush' || maskTool === 'eraser') refreshLayerTextures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId]);

  const cancelInpainting = useCallback(() => setMaskTool('pointer'), []);

  // Load persisted paint-tool settings once per project
  const paintToolsLoadedRef = useRef(null); // projectId whose settings were loaded
  useEffect(() => {
    if (!id || paintToolsLoadedRef.current === id) return;
    paintToolsLoadedRef.current = id;
    try {
      const raw = localStorage.getItem(`paintTools:${id}`);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.size === 'number') setBrushSize(Math.min(300, Math.max(1, saved.size)));
      if (typeof saved.hardness === 'number') setBrushHardness(Math.min(100, Math.max(0, saved.hardness)));
      if (typeof saved.spread === 'number') setBrushSpread(Math.min(100, Math.max(0, saved.spread)));
      if (typeof saved.opacity === 'number') setBrushOpacity(Math.min(100, Math.max(1, saved.opacity)));
    } catch {
      /* corrupt entry — ignore */
    }
  }, [id]);

  // Persist paint-tool settings whenever they change (skipped until the
  // project's saved values have been loaded so defaults don't clobber them).
  // inpaintSign is intentionally not persisted — it always starts on 'add'.
  useEffect(() => {
    if (!id || paintToolsLoadedRef.current !== id) return;
    try {
      localStorage.setItem(`paintTools:${id}`, JSON.stringify({
        size: brushSize,
        hardness: brushHardness,
        spread: brushSpread,
        opacity: brushOpacity,
      }));
    } catch {
      /* storage full/blocked — non-fatal */
    }
  }, [id, brushSize, brushHardness, brushSpread, brushOpacity]);

  // Selecting the inpaint tool always starts in add (+) mode with the
  // inpaint mask overlay visible
  useEffect(() => {
    if (maskTool === 'inpaint') {
      setInpaintSign('add');
      setInpaintMaskVisible(true);
    }
  }, [maskTool]);

  // Auto-select the first layer (or keep selection valid) when layers change
  useEffect(() => {
    if (meshLayers.length === 0) {
      if (selectedLayerId !== null) setSelectedLayerId(null);
      return;
    }
    if (!meshLayers.some((l) => l.id === selectedLayerId)) {
      setSelectedLayerId(meshLayers[0].id);
    }
  }, [meshLayers, selectedLayerId]);

  const refreshLayerTextures = useCallback(
    async (layers = null, meshKey = null) => {
      if (!viewerRef.current) return;
      const key = meshKey || selectedMesh?.key;
      if (!key) return;
      const meshDbId = meshDbIds[key];
      if (!meshDbId) return;
      const layerList = layers || meshLayers;
      const visibleLayers = layerList.filter((l) => l.visible !== false);
      const entries = [];
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
      for (const layer of visibleLayers) {
        let url = null;
        try {
          const res = await fetch(layerApi.uvmapUrl(id, meshDbId, layer.id), {
            headers: authHeaders,
          });
          if (res.ok) {
            const blob = await res.blob();
            if (blob.size > 0) url = URL.createObjectURL(blob);
          }
        } catch {
          /* ignore */
        }

        // Mask: reuse the local render targets if present (covers unsaved
        // edits and already-loaded masks); otherwise fetch a saved mask.png
        // and blit it into the layer's mask render target.
        let maskTexture = null;
        let maskEntry = layerMasksRef.current.get(layer.id);
        if (!maskEntry) {
          try {
            const res = await fetch(layerApi.maskUrl(id, meshDbId, layer.id), {
              headers: authHeaders,
            });
            if (res.ok) {
              const blob = await res.blob();
              if (blob.size > 0) {
                // Flip at decode time — UNPACK_FLIP_Y_WEBGL (texture.flipY) is
                // not reliably applied to ImageBitmap sources, which caused the
                // saved mask to load back Y-flipped.
                const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
                maskEntry = getOrCreateLayerMask(layer.id);
                viewerRef.current?.uploadMaskImage?.(maskEntry, bitmap);
                bitmap.close();
                if (!maskEntry.initialized) {
                  // Upload didn't land (renderer not ready / blit failed) —
                  // drop the entry so the next refresh retries the fetch.
                  maskEntry.a.dispose();
                  maskEntry.b.dispose();
                  layerMasksRef.current.delete(layer.id);
                  maskEntry = null;
                }
              }
            }
          } catch (err) {
            console.warn(`Failed to load mask for layer ${layer.id}:`, err);
          }
        }
        // Never bind an unrendered target — it samples black and hides the layer
        maskTexture = maskEntry && maskEntry.initialized ? maskEntry.front.texture : null;

        // The layer stack is baked into combined images on the CPU — supply
        // the mask pixels (read back from the live RT so unsaved strokes are
        // included). The paint target's RT binds directly instead, but its
        // data URL is still provided for the fallback combined path.
        let maskDataUrl = null;
        if (maskEntry && maskEntry.initialized) {
          try {
            maskDataUrl = viewerRef.current?.maskToDataURL?.(maskEntry) || null;
          } catch {
            /* readback failed — layer bakes unmasked */
          }
        }

        entries.push({ url, maskTexture, maskDataUrl, layerId: layer.id });
      }
      const hasAny = entries.some((e) => e.url !== null);
      const paintLayerId =
        (maskToolRef.current === 'brush' || maskToolRef.current === 'eraser')
          ? selectedLayerIdRef.current
          : null;
      viewerRef.current.updateLayerTextures(hasAny ? entries : [], { paintLayerId });
    },
    [id, layerApi, meshDbIds, meshLayers, selectedMesh, token, getOrCreateLayerMask]
  );

  const loadMeshLayers = useCallback(
    async (meshDbId) => {
      if (!meshDbId) {
        setMeshLayers([]);
        pendingLayersRef.current = [];
        return [];
      }
      // Layers are always populated by the load API and kept in sync via context.
      // New layers added during the session update allMeshLayers directly.
      // Textures are refreshed after the mesh loads in the viewer via onMeshLoaded.
      const layers = allMeshLayersRef.current[meshDbId] || [];
      setMeshLayers(layers);
      pendingLayersRef.current = layers;
      return layers;
    },
    []
  );

  // Adds a layer to the cache synchronously (updates ref + state).
  // Used by generation code so loadMeshLayers sees the new layer immediately.
  const addMeshLayer = useCallback((meshDbId, layer) => {
    const prev = allMeshLayersRef.current;
    const updated = { ...prev, [meshDbId]: [...(prev[meshDbId] || []), layer] };
    allMeshLayersRef.current = updated;
    setAllMeshLayers(updated);
    setMeshLayers(updated[meshDbId] || []);
  }, []);

  // Same as addMeshLayer but inserts at index 0 (top of the layers list).
  const prependMeshLayer = useCallback((meshDbId, layer) => {
    const prev = allMeshLayersRef.current;
    const updated = { ...prev, [meshDbId]: [layer, ...(prev[meshDbId] || [])] };
    allMeshLayersRef.current = updated;
    setAllMeshLayers(updated);
    setMeshLayers(updated[meshDbId] || []);
  }, []);

  // Removes a layer from the cache synchronously (updates ref + state).
  // Used by delete code so the UI updates before the API call.
  const removeMeshLayer = useCallback((meshDbId, layerId) => {
    const prev = allMeshLayersRef.current;
    const updated = { ...prev, [meshDbId]: (prev[meshDbId] || []).filter((l) => l.id !== layerId) };
    allMeshLayersRef.current = updated;
    setAllMeshLayers(updated);
    setMeshLayers(updated[meshDbId] || []);
    // Dispose the layer's mask render targets if they exist
    const maskEntry = layerMasksRef.current.get(layerId);
    if (maskEntry) {
      maskEntry.a.dispose();
      maskEntry.b.dispose();
      layerMasksRef.current.delete(layerId);
    }
    modifiedLayerIdsRef.current.delete(layerId);
  }, []);

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

  // Re-upload a newer version of an existing model file. Mesh records are
  // matched by name server-side — existing records (and their layers, camera
  // angles, references) update in place; only brand-new mesh names create
  // new records.
  const reuploadModelFile = useCallback(
    async (modelId, file) => {
      if (!modelId || !file) return { success: false, message: 'No file provided' };
      const model = models.find((m) => m.id === modelId);
      if (!model) return { success: false, message: 'Model not found' };
      setParsingModels((prev) => ({ ...prev, [modelId]: true }));
      try {
        const buffer = await file.arrayBuffer();
        const result = await parseModel(file.name, buffer);

        // Replace the stored model file + record
        const modelsApi = ProjectModels({ token });
        const fileRes = await modelsApi.updateFile(id, modelId, file);
        if (!fileRes.data.success) throw new Error(fileRes.data.message || 'File update failed');
        const updatedModel = fileRes.data.data;
        setModels((prev) => prev.map((m) => (m.id === modelId ? updatedModel : m)));

        // Sync mesh records by name — update existing, create new
        const meshesToSave = result.meshes.map((mesh) => ({
          modelId,
          name: mesh.name,
          meshData: serializeMeshData(mesh.object),
          uvMapData: serializeUVMapData(mesh.object),
          triangles: mesh.triangles,
          vertices: mesh.vertices,
        }));
        const meshesApi = ProjectMeshes({ token });
        if (meshesToSave.length > 0) {
          const syncRes = await meshesApi.syncBatch(id, modelId, meshesToSave);
          if (!syncRes.data.success) throw new Error(syncRes.data.message || 'Mesh sync failed');
        }

        // Re-download every mesh record for the model and rebuild the objects
        // from stored MeshData/UVMapData — the same path loadProject uses.
        // (Sync only returns the incoming set; this also picks up orphaned
        // records the new file no longer contains.)
        const meshesRes = await meshesApi.getByModel(id, modelId);
        if (!meshesRes.data.success) throw new Error(meshesRes.data.message || 'Failed to reload meshes');
        const records = meshesRes.data.data || [];

        const newMeshes = [];
        const newMeshDbIds = {};
        let totalTriangles = 0;
        let totalVertices = 0;
        records.forEach((mesh, i) => {
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
          newMeshes.push({
            name: mesh.name,
            triangles: mesh.triangles,
            vertices: mesh.vertices,
            uvMaps: [],
            boundingBox: null,
            materials: [],
            object: threeMesh,
          });
          totalTriangles += mesh.triangles;
          totalVertices += mesh.vertices;
          newMeshDbIds[`${modelId}-${i}`] = mesh.id;
        });

        setMeshData((prev) => ({
          ...prev,
          [modelId]: {
            meshes: newMeshes,
            totalTriangles,
            totalVertices,
            format: result.format,
            warnings: result.warnings,
            root: null,
          },
        }));
        setMeshDbIds((prev) => {
          const next = {};
          for (const key of Object.keys(prev)) {
            if (!key.startsWith(`${modelId}-`)) next[key] = prev[key];
          }
          Object.entries(newMeshDbIds).forEach(([key, meshId]) => {
            next[key] = meshId;
          });
          return next;
        });

        // If the selected mesh belongs to this model its object is stale —
        // re-select the same-named mesh so the viewer reloads the rebuilt
        // geometry. Its record id (and layers/angles) is unchanged by sync.
        const sel = selectedMeshRef.current;
        if (sel && sel.modelId === modelId) {
          const idx = newMeshes.findIndex((m) => m.name === sel.name);
          if (idx >= 0) {
            setSelectedMesh({
              ...newMeshes[idx],
              modelId,
              modelFilename: updatedModel.filename,
              meshIndex: idx,
              key: `${modelId}-${idx}`,
            });
          } else {
            // Mesh name gone in the new version — clear selection and let the
            // auto-select effect pick the first mesh with a full reload.
            setSelectedMesh(null);
          }
        }

        setParseErrors((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
        return { success: true };
      } catch (err) {
        const message = err.response?.data?.message || err.message || 'Re-upload failed';
        setParseErrors((prev) => ({ ...prev, [modelId]: message }));
        return { success: false, message };
      } finally {
        setParsingModels((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
      }
    },
    [id, token, models]
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
      const generationImageModels = (data.imageModels || []).filter((m) => m.type === 0);
      const inpaintModelsList = (data.imageModels || []).filter((m) => m.type === 2);
      setImageModels(depthImageModels);
      setRefImageModels(generationImageModels);
      setInpaintImageModels(inpaintModelsList);

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

      // Inpaint model — type 2 (inpainting) list, localStorage preferred
      const preferredInpaintKey = localStorage.getItem('preferredInpaintModel');
      const preferredInpaint = preferredInpaintKey
        ? inpaintModelsList.find((m) => m.modelKey === preferredInpaintKey)
        : null;
      if (preferredInpaint) {
        setInpaintModelId(String(preferredInpaint.id));
      } else if (inpaintModelsList.length > 0) {
        setInpaintModelId(String(inpaintModelsList[0].id));
      } else {
        setInpaintModelId('');
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
        setProjectRefs(data.references || []);
        setMeshReferences(data.meshReferences || []);
        // Update the ref synchronously so loadMeshLayers (triggered by the
        // auto-select effect, which runs before this component's ref-mirror
        // useEffect) sees the loaded layers instead of a stale empty object.
        allMeshLayersRef.current = data.layers || {};
        setAllMeshLayers(data.layers || {});
      } catch {
        /* references optional */
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
    textureResolution: project?.textureResolution ?? 1024,
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
    inpaintImageModels,
    selectedModelId,
    setSelectedModelId,
    inpaintModelId,
    setInpaintModelId,
    inpaintModelOptions,
    imageModelOptions,
    selectedImageModel,
    isComfyUI,
    isGradio,
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
    // mask brush
    maskTool,
    inpaintPrompt,
    setInpaintPrompt,
    inpaintMaskVisible,
    setInpaintMaskVisible,
    inpaintSign,
    setInpaintSign,
    ctrlHeld,
    setMaskTool,
    cancelInpainting,
    brushSize,
    setBrushSize,
    brushHardness,
    setBrushHardness,
    brushSpread,
    setBrushSpread,
    brushOpacity,
    setBrushOpacity,
    selectedLayerId,
    setSelectedLayerId,
    modifiedLayerIds,
    setModifiedLayerIds,
    maskThumbVersions,
    setMaskThumbVersions,
    layerMasksRef,
    maskPaintConfigRef,
    getOrCreateLayerMask,
    markMaskModified,
    saveModifiedMasks,
    scheduleMaskSave,
    cancelMaskSaveTimer,
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
    reuploadModelFile,
    loadMeshLayers,
    addMeshLayer,
    prependMeshLayer,
    removeMeshLayer,
    refreshLayerTextures,
    refreshMeshRefView,
    // utils
    formatTriangleCount,
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
