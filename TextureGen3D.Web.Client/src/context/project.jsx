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
  const [allImageModels, setAllImageModels] = useState([]);
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
  const [maskTool, setMaskTool] = useState('pointer'); // 'pointer' | 'brush' | 'eraser' | 'mask' | 'inpaint' | 'stamp' | 'blur'
  const [stampMode, setStampMode] = useState('copy');  // 'copy' (pick source) | 'draw' (stamp)
  const [maskMode, setMaskMode] = useState('brush');   // mask tool: 'brush' (paint white) | 'eraser' (paint black)
  const [brushColor, setBrushColor] = useState('#ff0000'); // brush tool paint color (hex)
  const [brushPicker, setBrushPicker] = useState(false);   // brush tool eyedropper — click samples uvmap color
  const [showPanel, setShowPanel] = useState(true);        // Generate Images panel expanded
  const [settingsCollapsed, setSettingsCollapsed] = useState(false); // Project Settings accordion collapsed
  const [stampInvertX, setStampInvertX] = useState(false); // mirror stamped content horizontally
  const [stampInvertY, setStampInvertY] = useState(false); // mirror stamped content vertically
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [inpaintMaskVisible, setInpaintMaskVisible] = useState(true);
  const [inpaintSign, setInpaintSign] = useState('add'); // 'add' (white) | 'subtract' (black)
  const [ctrlHeld, setCtrlHeld] = useState(false); // Ctrl inverts the inpaint sign while held
  const [altHeld, setAltHeld] = useState(false);   // Alt switches stamp draw → copy while held
  const [unlit, setUnlit] = useState(false);       // lighting eye toggle — mirrored from the viewer for persistence
  const [brushSize, setBrushSize] = useState(50);      // 1-300 (mask pixels, diameter)
  const [brushHardness, setBrushHardness] = useState(50); // 0-100
  const [brushSpread, setBrushSpread] = useState(0);   // 0-100 (screen px between stamps)
  const [brushOpacity, setBrushOpacity] = useState(100); // 1-100 (stamp alpha %)
  const [blurStrength, setBlurStrength] = useState(50);  // 1-100 (blur tool mix %)
  const [selectedLayerId, setSelectedLayerIdRaw] = useState(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState([]);
  const [modifiedLayerIds, setModifiedLayerIds] = useState(new Set());
  const [maskThumbVersions, setMaskThumbVersions] = useState({});
  // Layers whose assets (uvmap/mask/angle thumbs) are still being generated —
  // the sidebar swaps their thumbs for a spinner until the pipeline finishes.
  const [assetGeneratingLayerIds, setAssetGeneratingLayerIds] = useState(new Set());
  // {layerId, meshDbId} after a Clean Image run — shows the Accept/Revert
  // review card above the tools until the user picks one.
  const [cleanImageReview, setCleanImageReview] = useState(null);
  const setLayerAssetsGenerating = useCallback((layerId, on) => {
    setAssetGeneratingLayerIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(layerId);
      else next.delete(layerId);
      return next;
    });
  }, []);

  const selectedLayerIdRef = useRef(null);
  useEffect(() => { selectedLayerIdRef.current = selectedLayerId; }, [selectedLayerId]);
  const selectedLayerIdsRef = useRef([]);
  useEffect(() => { selectedLayerIdsRef.current = selectedLayerIds; }, [selectedLayerIds]);
  const meshLayersRef = useRef([]);
  useEffect(() => { meshLayersRef.current = meshLayers; }, [meshLayers]);

  // Single-select — keeps the multi-select array in sync (just this layer).
  const setSelectedLayerId = useCallback((layerId) => {
    const next = layerId == null ? [] : [layerId];
    selectedLayerIdsRef.current = next;
    setSelectedLayerIds(next);
    setSelectedLayerIdRaw(layerId);
  }, []);

  // Ctrl+click toggle — adds/removes the layer from the selection set.
  // The toggled-on layer becomes the primary (selectedLayerId); toggling
  // the primary off falls back to the last remaining selection.
  const toggleLayerSelected = useCallback((layerId) => {
    const prev = selectedLayerIdsRef.current;
    const adding = !prev.includes(layerId);
    const next = adding ? [...prev, layerId] : prev.filter((x) => x !== layerId);
    selectedLayerIdsRef.current = next;
    setSelectedLayerIds(next);
    setSelectedLayerIdRaw(adding ? layerId : (next[next.length - 1] ?? null));
  }, []);
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

  // ── Layer asset cache ──
  // uvmap.png is fetched once per layer and reused across texture rebuilds
  // (visibility toggles, selection changes, tool switches). Entries are only
  // re-fetched when the server rewrites the file — call invalidateLayerAssets
  // after any saveUvMap/clean/revert/etc. `{url, blob}` — url is the shared
  // cached object URL; blob lets one-off consumers mint their own URL.
  const layerAssetCacheRef = useRef(new Map());
  // layerIds known to have no mask.png on disk — avoids a 404 fetch on every
  // refresh for mask-less layers. Cleared per-id by invalidateLayerAssets.
  const noMaskFileRef = useRef(new Set());
  // In-flight fetch dedup — refreshLayerTextures fires several times during
  // project/mesh load; without these, every concurrent call misses the
  // not-yet-populated cache and issues its own identical request.
  const layerAssetInFlightRef = useRef(new Map()); // layerId -> Promise<asset|null>
  const maskLoadInFlightRef = useRef(new Map());   // layerId -> Promise<maskEntry|null>
  // CPU-side ImageData of each layer's uvmap.png, built lazily for the
  // pointer tool's click-to-select (samples uvmap alpha at the hit UV).
  // Keyed alongside the asset cache — invalidated by invalidateLayerAssets.
  const layerPickDataRef = useRef(new Map()); // layerId -> ImageData

  const invalidateLayerAssets = useCallback((layerIds = null) => {
    if (layerIds == null) {
      for (const e of layerAssetCacheRef.current.values()) if (e.url) URL.revokeObjectURL(e.url);
      layerAssetCacheRef.current.clear();
      layerAssetInFlightRef.current.clear();
      maskLoadInFlightRef.current.clear();
      noMaskFileRef.current.clear();
      layerPickDataRef.current.clear();
      // Mask RTs belong to the previous project's layers — free the GPU memory
      for (const entry of layerMasksRef.current.values()) {
        entry.a.dispose();
        entry.b.dispose();
      }
      layerMasksRef.current.clear();
      return;
    }
    for (const layerId of [].concat(layerIds)) {
      const e = layerAssetCacheRef.current.get(layerId);
      if (e?.url) URL.revokeObjectURL(e.url);
      layerAssetCacheRef.current.delete(layerId);
      layerAssetInFlightRef.current.delete(layerId);
      maskLoadInFlightRef.current.delete(layerId);
      noMaskFileRef.current.delete(layerId);
      layerPickDataRef.current.delete(layerId);
    }
  }, []);

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

  // Fetch a layer's uvmap.png once — concurrent refreshes share the same
  // in-flight promise so N overlapping calls produce exactly one request.
  // The result is only written to the cache while this promise is still the
  // live in-flight entry, so a mid-flight invalidateLayerAssets can't be
  // undone by a stale resolution.
  const ensureLayerAsset = useCallback(async (layerId, meshDbId) => {
    const cached = layerAssetCacheRef.current.get(layerId);
    if (cached) return cached;
    let flight = layerAssetInFlightRef.current.get(layerId);
    if (!flight) {
      flight = (async () => {
        try {
          // ?r=<random-int> busts the browser HTTP cache — the server
          // overwrites uvmap.png in place (clean-image, revert, saves) so the
          // same URL must not be allowed to return stale bytes.
          const res = await fetch(`${layerApi.uvmapUrl(id, meshDbId, layerId)}?r=${Math.floor(Math.random() * 2147483647)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const blob = res.ok ? await res.blob() : null;
          let asset = null;
          if ((blob && blob.size > 0) || res.status === 404) {
            // 404 = no uvmap on disk — cache the negative too so paint-only
            // layers don't re-request on every refresh.
            asset = blob && blob.size > 0
              ? { blob, url: URL.createObjectURL(blob) }
              : { blob: null, url: null };
            if (layerAssetInFlightRef.current.get(layerId) === flight) {
              layerAssetCacheRef.current.set(layerId, asset);
            }
          }
          return asset;
        } catch {
          return null; // leave uncached so a later refresh retries
        } finally {
          if (layerAssetInFlightRef.current.get(layerId) === flight) {
            layerAssetInFlightRef.current.delete(layerId);
          }
        }
      })();
      layerAssetInFlightRef.current.set(layerId, flight);
    }
    return flight;
  }, [id, layerApi, token]);

  // Same dedup for mask.png — one fetch + one RT upload no matter how many
  // refreshes overlap. Returns the initialized mask entry or null.
  const ensureLayerMaskLoaded = useCallback(async (layerId, meshDbId) => {
    const existing = layerMasksRef.current.get(layerId);
    if (existing || noMaskFileRef.current.has(layerId)) return existing || null;
    let flight = maskLoadInFlightRef.current.get(layerId);
    if (!flight) {
      flight = (async () => {
        try {
          const res = await fetch(`${layerApi.maskUrl(id, meshDbId, layerId)}?r=${Math.floor(Math.random() * 2147483647)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const blob = res.ok ? await res.blob() : null;
          if (blob && blob.size > 0) {
            // Invalidated mid-flight — drop the result rather than blitting
            // stale mask bytes into a fresh RT.
            if (maskLoadInFlightRef.current.get(layerId) !== flight) return null;
            // Flip at decode time — UNPACK_FLIP_Y_WEBGL (texture.flipY) is
            // not reliably applied to ImageBitmap sources, which caused the
            // saved mask to load back Y-flipped.
            const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
            const entry = getOrCreateLayerMask(layerId);
            viewerRef.current?.uploadMaskImage?.(entry, bitmap);
            bitmap.close();
            if (!entry.initialized) {
              // Upload didn't land (renderer not ready / blit failed) —
              // drop the entry so the next refresh retries the fetch.
              entry.a.dispose();
              entry.b.dispose();
              layerMasksRef.current.delete(layerId);
              return null;
            }
            return entry;
          }
          if (res.status === 404 || (res.ok && (!blob || !blob.size))) {
            noMaskFileRef.current.add(layerId);
          }
          return null;
        } catch (err) {
          console.warn(`Failed to load mask for layer ${layerId}:`, err);
          return null;
        } finally {
          if (maskLoadInFlightRef.current.get(layerId) === flight) {
            maskLoadInFlightRef.current.delete(layerId);
          }
        }
      })();
      maskLoadInFlightRef.current.set(layerId, flight);
    }
    return flight;
  }, [id, layerApi, token, getOrCreateLayerMask]);

  // CPU ImageData of a layer's uvmap.png for the pointer tool's alpha pick —
  // built once from the shared asset blob, invalidated with it.
  const getLayerPickData = useCallback(async (layerId, meshDbId) => {
    let data = layerPickDataRef.current.get(layerId);
    if (data) return data;
    const asset = await ensureLayerAsset(layerId, meshDbId);
    if (!asset?.blob) return null;
    try {
      const bitmap = await createImageBitmap(asset.blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const c2 = canvas.getContext('2d');
      c2.drawImage(bitmap, 0, 0);
      bitmap.close();
      data = c2.getImageData(0, 0, canvas.width, canvas.height);
      layerPickDataRef.current.set(layerId, data);
      return data;
    } catch {
      return null;
    }
  }, [ensureLayerAsset]);

  // Pointer tool: click on the mesh selects the top-most layer that displays
  // a pixel at the hit UV — uvmap.png alpha (or the live stamp buffer)
  // multiplied by the layer mask, walking the stack top → bottom.
  const pickTopLayerAt = useCallback(async (clientX, clientY) => {
    const hit = viewerRef.current?.raycastHitAt?.(clientX, clientY);
    if (!hit?.uv) return;
    const u = hit.uv.x;
    const v = hit.uv.y;
    const meshDbId = selectedMeshRef.current ? meshDbIdsRef.current[selectedMeshRef.current.key] : null;

    // meshLayers[0] is the top of the stack (drawn last in the shader)
    for (const layer of meshLayersRef.current) {
      if (layer.visible === false) continue;

      // Mask gate — white = visible. Only initialized RTs carry real data.
      const maskEntry = layerMasksRef.current.get(layer.id);
      if (maskEntry?.initialized) {
        const m = viewerRef.current?.sampleMaskAtUv?.(maskEntry, u, v);
        if (m !== null && m !== undefined && m <= 8) continue;
      }

      // Pixel alpha — live stamp buffer first (may hold unsaved dabs),
      // else the uvmap.png file contents.
      let alpha = viewerRef.current?.sampleStampAtUv?.(layer.id, u, v);
      if (alpha === null || alpha === undefined) {
        const data = meshDbId ? await getLayerPickData(layer.id, meshDbId) : null;
        if (!data) continue;
        // PNG/ImageData row 0 = v 1 (image top), so flip v
        const px = Math.min(data.width - 1, Math.max(0, Math.round(u * (data.width - 1))));
        const py = Math.min(data.height - 1, Math.max(0, Math.round((1 - v) * (data.height - 1))));
        alpha = data.data[(py * data.width + px) * 4 + 3];
      }

      if (alpha > 8) {
        setSelectedLayerId(layer.id);
        // Scroll the layer row into view in the sidebar
        document
          .querySelector(`[data-layer-id="${CSS.escape(layer.id)}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
    }
  }, [getLayerPickData, setSelectedLayerId]);

  // Brush eyedropper: same top-visible-layer walk as pickTopLayerAt, but
  // returns the sampled uvmap color as '#rrggbb' (null = nothing visible
  // under the cursor). Live stamp RT readback when present, else the
  // decoded uvmap.png pixel data.
  const sampleLayerColorAt = useCallback(async (clientX, clientY) => {
    const hit = viewerRef.current?.raycastHitAt?.(clientX, clientY);
    if (!hit?.uv) return null;
    const u = hit.uv.x;
    const v = hit.uv.y;
    const meshDbId = selectedMeshRef.current ? meshDbIdsRef.current[selectedMeshRef.current.key] : null;
    for (const layer of meshLayersRef.current) {
      if (layer.visible === false) continue;
      const maskEntry = layerMasksRef.current.get(layer.id);
      if (maskEntry?.initialized) {
        const m = viewerRef.current?.sampleMaskAtUv?.(maskEntry, u, v);
        if (m !== null && m !== undefined && m <= 8) continue;
      }
      let texel = viewerRef.current?.sampleStampColorAtUv?.(layer.id, u, v);
      if (!texel) {
        const data = meshDbId ? await getLayerPickData(layer.id, meshDbId) : null;
        if (!data) continue;
        const px = Math.min(data.width - 1, Math.max(0, Math.round(u * (data.width - 1))));
        const py = Math.min(data.height - 1, Math.max(0, Math.round((1 - v) * (data.height - 1))));
        const i = (py * data.width + px) * 4;
        texel = [data.data[i], data.data[i + 1], data.data[i + 2], data.data[i + 3]];
      }
      if (texel[3] > 8) {
        return '#' + [texel[0], texel[1], texel[2]].map((c) => c.toString(16).padStart(2, '0')).join('');
      }
    }
    return null;
  }, [getLayerPickData]);

  const handlePickColor = useCallback(async (clientX, clientY) => {
    const hex = await sampleLayerColorAt(clientX, clientY);
    // Pick always lands back on the plain brush tool — eyedropper off
    setBrushPicker(false);
    setMaskTool('brush');
    if (hex) setBrushColor(hex);
  }, [sampleLayerColorAt]);

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

  // Alt temporarily switches the stamp tool from draw → copy while held.
  // preventDefault keeps the browser's menu-bar focus from stealing the key.
  useEffect(() => {
    const down = (e) => {
      if (e.key !== 'Alt') return;
      const tool = maskPaintConfigRef.current?.tool;
      if (tool === 'stamp' || tool === 'brush') e.preventDefault();
      setAltHeld(true);
    };
    const up = (e) => { if (e.key === 'Alt') setAltHeld(false); };
    const blur = () => setAltHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ── Stamp tool plumbing ──
  // The clone source is captured GPU-side in the viewer (captureStampView) —
  // screen-space, so seams/orientation match what's projected on the mesh.
  // Fetch a layer's current uvmap.png as an object URL — used to initialize
  // the stamp target canvas (the viewer can't send auth headers to loaders).
  const loadStampLayerImage = useCallback(async (layerId) => {
    // The caller owns (and revokes) the returned URL — mint a fresh object
    // URL from the shared cache entry so it's never revoked out from under
    // refreshLayerTextures. ensureLayerAsset dedupes the underlying fetch
    // with any in-flight refresh.
    const meshDbId = selectedMeshRef.current ? meshDbIdsRef.current[selectedMeshRef.current.key] : null;
    if (!meshDbId) return null;
    const cached = await ensureLayerAsset(layerId, meshDbId);
    return cached?.blob ? URL.createObjectURL(cached.blob) : null;
  }, [ensureLayerAsset]);

  // Persist stamped uvmap canvases after a stroke completes (masks persist
  // through the existing scheduleMaskSave path).
  const saveStampedUvmaps = useCallback(async (layerIds) => {
    const meshDbId = selectedMeshRef.current ? meshDbIdsRef.current[selectedMeshRef.current.key] : null;
    if (!meshDbId) return;
    let bumped = false;
    for (const layerId of layerIds || []) {
      const dataUrl = viewerRef.current?.getStampCanvasDataUrl?.(layerId);
      if (!dataUrl) continue;
      try {
        await layerApi.saveUvMap(id, layerId, meshDbId, dataUrl);
        invalidateLayerAssets(layerId); // server rewrote uvmap.png
        bumped = true;
      } catch (err) {
        console.error('Failed to save stamped uvmap:', err);
      }
    }
    if (bumped) setLayerThumbVersion((v) => v + 1);
  }, [id, layerApi, invalidateLayerAssets]);

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
      blurStrength: blurStrength,
      color: brushColor,
      // Brush eyedropper — hover samples into the cursor swatch, click
      // adopts the color (handled in ModelViewer's pointer dispatch).
      // Alt held activates it temporarily, same as stamp's Alt → copy.
      brushPick: brushPicker || altHeld,
      sampleColor: sampleLayerColorAt,
      onPickColor: handlePickColor,
      // Ctrl held flips the mask tool's brush↔eraser (same as inpaint sign)
      maskSign: ctrlHeld ? (maskMode === 'brush' ? 'eraser' : 'brush') : maskMode,
      // Alt held in draw mode acts as copy mode (pick a new source point)
      stampMode: altHeld && stampMode === 'draw' ? 'copy' : stampMode,
      stampInvertX,
      stampInvertY,
      textureResolution: project?.textureResolution ?? 1024,
      getSelectedLayerId: () => selectedLayerIdRef.current,
      getSelectedLayerIds: () => selectedLayerIdsRef.current,
      // Stamp targets: generated/inpainted layers are off-limits — stamping
      // clones the composite onto plain (non-projected) layers only.
      isStampableLayer: (lid) => {
        const l = meshLayersRef.current.find((x) => x.id === lid);
        return !!l && l.type !== 1 && l.type !== 2; // 1=Generated, 2=Inpainted
      },
      getOrCreateLayerMask,
      markMaskModified,
      onStrokeStart: cancelMaskSaveTimer,
      onStrokeEnd: scheduleMaskSave,
      onStampCopy: () => setStampMode('draw'),
      loadStampLayerImage,
      onStampStrokeEnd: saveStampedUvmaps,
      // Pointer tool — a click (no drag) on the mesh selects the top-most
      // layer displaying a pixel at that UV.
      onPointerPick: pickTopLayerAt,
    };
  }, [maskTool, inpaintSign, ctrlHeld, altHeld, brushSize, brushHardness, brushSpread, brushOpacity, blurStrength, brushColor, brushPicker, sampleLayerColorAt, handlePickColor, maskMode, stampMode, stampInvertX, stampInvertY, project?.textureResolution, getOrCreateLayerMask, markMaskModified, cancelMaskSaveTimer, scheduleMaskSave, loadStampLayerImage, saveStampedUvmaps, pickTopLayerAt]);

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
      maskTool === 'brush' || maskTool === 'eraser' || maskTool === 'mask' || maskTool === 'inpaint' || maskTool === 'stamp' || maskTool === 'blur'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskTool]);
  useEffect(() => {
    if (maskTool === 'brush' || maskTool === 'eraser' || maskTool === 'mask' || maskTool === 'stamp' || maskTool === 'blur') refreshLayerTextures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId, selectedLayerIds]);

  // Selecting the stamp tool always starts in copy mode — the user picks a
  // source point before drawing (mirrors how inpaint resets to 'add').
  useEffect(() => {
    if (maskTool === 'stamp') setStampMode('copy');
    if (maskTool === 'mask') setMaskMode('brush');
    if (maskTool !== 'brush') setBrushPicker(false);
  }, [maskTool]);

  const cancelInpainting = useCallback(() => setMaskTool('pointer'), []);

  // Load persisted UI settings once per project (ui:{id}; falls back to the
  // legacy paintTools:{id} key so existing settings carry over)
  const paintToolsLoadedRef = useRef(null); // projectId whose settings were loaded
  useEffect(() => {
    if (!id || paintToolsLoadedRef.current === id) return;
    paintToolsLoadedRef.current = id;
    try {
      const raw = localStorage.getItem(`ui:${id}`) ?? localStorage.getItem(`paintTools:${id}`);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.size === 'number') setBrushSize(Math.min(300, Math.max(1, saved.size)));
      if (typeof saved.hardness === 'number') setBrushHardness(Math.min(100, Math.max(0, saved.hardness)));
      if (typeof saved.spread === 'number') setBrushSpread(Math.min(100, Math.max(0, saved.spread)));
      if (typeof saved.opacity === 'number') setBrushOpacity(Math.min(100, Math.max(1, saved.opacity)));
      if (typeof saved.strength === 'number') setBlurStrength(Math.min(100, Math.max(1, saved.strength)));
      if (typeof saved.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(saved.color)) setBrushColor(saved.color);
      if (typeof saved.generatePanel === 'boolean') setShowPanel(saved.generatePanel);
      if (typeof saved.settingsCollapsed === 'boolean') setSettingsCollapsed(saved.settingsCollapsed);
      if (typeof saved.stampInvert === 'boolean') setStampInvertX(saved.stampInvert); // legacy key → X
      if (typeof saved.stampInvertX === 'boolean') setStampInvertX(saved.stampInvertX);
      if (typeof saved.stampInvertY === 'boolean') setStampInvertY(saved.stampInvertY);
      // Restore the last active tool — stamp may immediately fall back to
      // pointer if the restored layer selection is generated/inpainted.
      if (['pointer', 'brush', 'eraser', 'mask', 'inpaint', 'stamp', 'blur'].includes(saved.tool)) setMaskTool(saved.tool);
      // Restore lit/unlit — push straight into the viewer so materials and
      // lights pick it up before the first mesh renders.
      if (typeof saved.unlit === 'boolean') {
        setUnlit(saved.unlit);
        viewerRef.current?.setUnlit?.(saved.unlit);
      }
    } catch {
      /* corrupt entry — ignore */
    }
  }, [id]);

  // Persist UI settings whenever they change (skipped until the
  // project's saved values have been loaded so defaults don't clobber them).
  // inpaintSign is intentionally not persisted — it always starts on 'add'.
  useEffect(() => {
    if (!id || paintToolsLoadedRef.current !== id) return;
    try {
      localStorage.setItem(`ui:${id}`, JSON.stringify({
        tool: maskTool,
        unlit,
        size: brushSize,
        hardness: brushHardness,
        spread: brushSpread,
        opacity: brushOpacity,
        strength: blurStrength,
        color: brushColor,
        generatePanel: showPanel,
        settingsCollapsed,
        stampInvertX,
        stampInvertY,
      }));
    } catch {
      /* storage full/blocked — non-fatal */
    }
  }, [id, maskTool, unlit, brushSize, brushHardness, brushSpread, brushOpacity, blurStrength, brushColor, showPanel, settingsCollapsed, stampInvertX, stampInvertY]);

  // Selecting the inpaint tool always starts in add (+) mode with the
  // inpaint mask overlay visible
  useEffect(() => {
    if (maskTool === 'inpaint') {
      setInpaintSign('add');
      setInpaintMaskVisible(true);
    }
  }, [maskTool]);

  // Auto-select the first layer (or keep the selection valid) when layers
  // change — prunes ids for deleted layers and keeps the primary selected.
  useEffect(() => {
    if (meshLayers.length === 0) {
      if (selectedLayerIdsRef.current.length) {
        selectedLayerIdsRef.current = [];
        setSelectedLayerIds([]);
      }
      if (selectedLayerId !== null) setSelectedLayerIdRaw(null);
      return;
    }
    const valid = selectedLayerIds.filter((lid) => meshLayers.some((l) => l.id === lid));
    if (valid.length !== selectedLayerIds.length || valid.length === 0) {
      // No valid carry-over selection — restore the last layer picked for
      // this mesh (per-mesh localStorage), else the top of the stack.
      const meshDbId = selectedMeshRef.current ? meshDbIdsRef.current[selectedMeshRef.current.key] : null;
      let savedId = null;
      try { savedId = meshDbId ? localStorage.getItem(`selectedLayer:${meshDbId}`) : null; } catch { /* ignore */ }
      const fallback = savedId && meshLayers.some((l) => l.id === savedId) ? savedId : meshLayers[0].id;
      const next = valid.length ? valid : [fallback];
      selectedLayerIdsRef.current = next;
      setSelectedLayerIds(next);
      if (!next.includes(selectedLayerId)) setSelectedLayerIdRaw(next[next.length - 1]);
    } else if (!selectedLayerIds.includes(selectedLayerId)) {
      setSelectedLayerIdRaw(selectedLayerIds[selectedLayerIds.length - 1]);
    }
  }, [meshLayers, selectedLayerIds, selectedLayerId]);

  // Persist the selected layer per mesh — restored on project load and when
  // switching meshes in the list. Validated against meshLayers so a stale id
  // from the previous mesh isn't written during a mesh switch.
  useEffect(() => {
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (!meshDbId || !selectedLayerId) return;
    if (!meshLayers.some((l) => l.id === selectedLayerId)) return;
    try {
      localStorage.setItem(`selectedLayer:${meshDbId}`, selectedLayerId);
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [selectedMesh, meshDbIds, selectedLayerId, meshLayers]);

  // Refresh serialization — project load fires refreshLayerTextures from
  // several effects at once (maskTool / selection / mesh-load). Each call
  // used to run a full gather + CPU compositing pass even though the
  // buildId guard means only the last build lands — N overlapping calls =
  // N passes = the load-time freeze. Now a second call while one is
  // running just queues a single trailing run with the latest args.
  const refreshRunningRef = useRef(false);
  const refreshQueuedRef = useRef(null);

  const runRefreshLayerTextures = useCallback(
    async (layers = null, meshKey = null) => {
      if (!viewerRef.current) return;
      // State comes through refs, not closure deps — a queued trailing run
      // executes inside an older wrapper invocation and would otherwise see
      // stale meshLayers/meshDbIds (e.g. [] before loadMeshLayers landed).
      const key = meshKey || selectedMeshRef.current?.key;
      if (!key) return;
      const meshDbId = meshDbIdsRef.current[key];
      if (!meshDbId) return;
      const layerList = layers || meshLayersRef.current;
      const visibleLayers = layerList.filter((l) => l.visible !== false);
      const entries = [];
      for (const layer of visibleLayers) {
        // A newer refresh was queued while gathering — bail; the trailing
        // run rebuilds from the latest args/state anyway.
        if (refreshQueuedRef.current) return;
        // uvmap.png comes from the per-layer cache — fetched once, re-fetched
        // only after invalidateLayerAssets (server-side rewrite). Concurrent
        // refreshes share one in-flight fetch; negative results are cached
        // too so paint-only layers don't 404 every refresh.
        const cachedAsset = await ensureLayerAsset(layer.id, meshDbId);
        const url = cachedAsset?.url || null;

        // Mask: reuse the local render targets if present (covers unsaved
        // edits and already-loaded masks); otherwise fetch a saved mask.png
        // and blit it into the layer's mask render target — deduped with
        // any in-flight refresh. Layers known to have no mask on disk are
        // skipped (noMaskFileRef) — cleared by invalidateLayerAssets when a
        // mask gets saved server-side.
        const maskEntry = await ensureLayerMaskLoaded(layer.id, meshDbId);
        // Never bind an unrendered target — it samples black and hides the layer
        const maskTexture = maskEntry && maskEntry.initialized ? maskEntry.front.texture : null;

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
      if (refreshQueuedRef.current) return; // superseded mid-gather
      const hasAny = entries.some((e) => e.url !== null);
      const paintLayerIds =
        (maskToolRef.current === 'brush' || maskToolRef.current === 'eraser' || maskToolRef.current === 'mask' || maskToolRef.current === 'stamp' || maskToolRef.current === 'blur')
          ? selectedLayerIdsRef.current
          : null;
      // Stamp targets can be empty layers (no uvmap yet) — still give them a
      // live shader slot so stamped pixels render in real time.
      viewerRef.current.updateLayerTextures(hasAny || paintLayerIds?.length ? entries : [], { paintLayerIds });
    },
    [ensureLayerAsset, ensureLayerMaskLoaded]
  );

  const refreshLayerTextures = useCallback(
    async (layers = null, meshKey = null) => {
      if (refreshRunningRef.current) {
        refreshQueuedRef.current = { layers, meshKey };
        return;
      }
      refreshRunningRef.current = true;
      try {
        let args = { layers, meshKey };
        while (args) {
          refreshQueuedRef.current = null;
          await runRefreshLayerTextures(args.layers, args.meshKey);
          args = refreshQueuedRef.current;
        }
      } finally {
        refreshRunningRef.current = false;
      }
    },
    [runRefreshLayerTextures]
  );

  // Layer assets (uvmap.png/mask.png) persist for the whole project session —
  // they're only fetched lazily when a mesh is first selected and re-fetched
  // solely after a server-side rewrite (invalidateLayerAssets per layer).
  // Mesh switches reuse the warm cache; only a project change clears it.
  useEffect(() => {
    invalidateLayerAssets();
  }, [id, invalidateLayerAssets]); // eslint-disable-line react-hooks/exhaustive-deps

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
    invalidateLayerAssets(layerId);
  }, [invalidateLayerAssets]);

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
      setAllImageModels(data.imageModels || []);

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
    allImageModels,
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
    meshLayersRef,
    setMeshLayers,
    allMeshLayers,
    setAllMeshLayers,
    // mask brush
    maskTool,
    inpaintPrompt,
    setInpaintPrompt,
    stampMode,
    setStampMode,
    stampInvertX,
    setStampInvertX,
    stampInvertY,
    setStampInvertY,
    inpaintMaskVisible,
    setInpaintMaskVisible,
    inpaintSign,
    setInpaintSign,
    ctrlHeld,
    altHeld,
    unlit,
    setUnlit,
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
    blurStrength,
    setBlurStrength,
    brushColor,
    setBrushColor,
    brushPicker,
    setBrushPicker,
    showPanel,
    setShowPanel,
    settingsCollapsed,
    setSettingsCollapsed,
    maskMode,
    setMaskMode,
    selectedLayerId,
    setSelectedLayerId,
    selectedLayerIds,
    toggleLayerSelected,
    modifiedLayerIds,
    setModifiedLayerIds,
    maskThumbVersions,
    setMaskThumbVersions,
    assetGeneratingLayerIds,
    setAssetGeneratingLayerIds,
    setLayerAssetsGenerating,
    cleanImageReview,
    setCleanImageReview,
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
    invalidateLayerAssets,
    refreshMeshRefView,
    // utils
    formatTriangleCount,
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
