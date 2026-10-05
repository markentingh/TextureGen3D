import React, { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { useProject } from '@/context/project';
import { ProjectMeshReferences } from '@/api/user/projectMeshReferences';
import { subscribeLayerSaves, getLayerSaveCount } from '@/api/user/projectMeshLayers';
import { ProjectCameraAngles } from '@/api/user/projectCameraAngles';
import { ProjectReferences } from '@/api/user/projectReferences';
import Icon from '@/components/ui/icon';
import Spinner from '@/components/ui/spinner';
import { useModal } from '@/context/modal';
import StitchLayersModal from './StitchLayersModal';
import MaskThumb, { CHECKERBOARD_BG } from './MaskThumb';
import ColorPicker from '@/components/ui/ColorPicker';
import { imgDataToPngBytes, downloadZip } from '@/helpers/textures';
import { useHubGeneration } from './useHubGeneration';

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

const blobToDataUrl = (blob) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.readAsDataURL(blob);
});

// Mirror an image horizontally, returning a PNG data URL.
async function flipImageDataUrl(dataUrl) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.translate(img.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

// Convert a projected image to a binary layer mask — white where the
// projection painted a bright pixel (alpha + luminance), black elsewhere.
async function projectionToMask(dataUrl) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const luma = d.data[i] * 0.299 + d.data[i + 1] * 0.587 + d.data[i + 2] * 0.114;
    const v = d.data[i + 3] > 0 && luma > 127 ? 255 : 0;
    d.data[i] = v;
    d.data[i + 1] = v;
    d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return canvas.toDataURL('image/png');
}

// Align two silhouette renders (white mesh on transparent bg): extract each
// mesh outline, flip the source horizontally, then find the translation that
// maximizes outline overlap with the (2px-dilated) target outline. Returns
// the offset in full-resolution pixels — apply with drawImageAtOffset.
async function findOutlineOffset(srcDataUrl, tgtDataUrl) {
  const S = 128;
  const [srcImg, tgtImg] = await Promise.all([loadImage(srcDataUrl), loadImage(tgtDataUrl)]);
  const alphaOf = (image) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const cx = c.getContext('2d');
    cx.drawImage(image, 0, 0, S, S);
    const d = cx.getImageData(0, 0, S, S).data;
    const a = new Uint8Array(S * S);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] > 32 ? 1 : 0;
    return a;
  };
  const srcA = alphaOf(srcImg);
  const tgtA = alphaOf(tgtImg);

  // Flip the source alpha horizontally (mirroring = source view flipped).
  const srcF = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) srcF[y * S + x] = srcA[y * S + (S - 1 - x)];
  }

  // Outline = inside pixel with at least one outside 4-neighbor.
  const outlineOf = (a) => {
    const o = new Uint8Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        if (!a[i]) continue;
        if (x === 0 || x === S - 1 || y === 0 || y === S - 1 ||
            !a[i - 1] || !a[i + 1] || !a[i - S] || !a[i + S]) o[i] = 1;
      }
    }
    return o;
  };
  const srcO = outlineOf(srcF);
  const tgtO = outlineOf(tgtA);

  // Dilate the target outline ±2px — mirrored silhouettes aren't pixel-
  // identical, so near-misses should still count.
  const tgtD = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!tgtO[y * S + x]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < S && ny >= 0 && ny < S) tgtD[ny * S + nx] = 1;
        }
      }
    }
  }

  const srcPx = [];
  for (let i = 0; i < srcO.length; i++) if (srcO[i]) srcPx.push(i);
  const overlap = (dx, dy) => {
    let n = 0;
    for (let p = 0; p < srcPx.length; p++) {
      const i = srcPx[p];
      const x = (i % S) + dx;
      const y = ((i / S) | 0) + dy;
      if (x >= 0 && x < S && y >= 0 && y < S && tgtD[y * S + x]) n++;
    }
    return n;
  };

  let best = { dx: 0, dy: 0, n: overlap(0, 0) };
  const half = S / 2;
  for (let dy = -half; dy <= half; dy += 4) {
    for (let dx = -half; dx <= half; dx += 4) {
      const n = overlap(dx, dy);
      if (n > best.n) best = { dx, dy, n };
    }
  }
  for (let dy = best.dy - 4; dy <= best.dy + 4; dy++) {
    for (let dx = best.dx - 4; dx <= best.dx + 4; dx++) {
      const n = overlap(dx, dy);
      if (n > best.n) best = { dx, dy, n };
    }
  }
  return { dx: best.dx * srcImg.width / S, dy: best.dy * srcImg.height / S };
}

// Draw an image onto a same-size white canvas at a pixel offset — opaque
// output matching the composite capture's white background.
async function drawImageAtOffset(imgDataUrl, dx, dy) {
  const img = await loadImage(imgDataUrl);
  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(img, dx, dy);
  return out.toDataURL('image/png');
}

// Union two mask images (white = painted) — 'lighten' composites per-channel
// max, so painted regions from either mask stay painted. Returns a Blob.
async function mergeMaskImages(baseDataUrl, layerBlob) {
  const layerUrl = URL.createObjectURL(layerBlob);
  try {
    const [baseImg, layerImg] = await Promise.all([
      loadImage(baseDataUrl),
      loadImage(layerUrl),
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

// Paint-map carousel — which texture a layer's drawing tools write into.
// Base Color targets the layer's own uvmap.png; the other three are the
// shared mesh files (orm.png channels + emissive.png).
const PAINT_MAPS = [
  { key: 'base', label: 'Base Color' },
  { key: 'rough', label: 'Roughness' },
  { key: 'metal', label: 'Metallic' },
  { key: 'emissive', label: 'Emissive' },
];
const FILL_LABELS = {
  base: 'Fill Layer',
  rough: 'Fill Roughness',
  metal: 'Fill Metallic',
  emissive: 'Fill Emissive',
};

export default function Layers() {
  const {
    id,
    token,
    textureResolution,
    selectedMesh,
    meshDbIds,
    meshLayers,
    meshLayersRef,
    setMeshLayers,
    setAllMeshLayers,
    layerApi,
    layerThumbVersion,
    setLayerThumbVersion,
    maskThumbVersions,
    setMaskThumbVersions,
    assetGeneratingLayerIds,
    setLayerAssetsGenerating,
    selectedLayerId,
    setSelectedLayerId,
    selectedLayerIds,
    toggleLayerSelected,
    refImageModels,
    allImageModels,
    isComfyUI,
    isGradio,
    layerMasksRef,
    viewerRef,
    cameraAngles,
    selectedAngleId,
    setCameraAngles,
    setAngleRefView,
    meshRefView,
    setMeshReferences,
    projectRefs,
    generationMode,
    loadMeshLayers,
    removeMeshLayer,
    refreshLayerTextures,
    invalidateLayerAssets,
    updateLayerImageCache,
    maskTool,
    setMaskTool,
    brushColor,
    setInpaintMaskVisible,
    getOrCreateLayerMask,
    markMaskModified,
    scheduleMaskSave,
    saveModifiedMasks,
    cancelMaskSaveTimer,
    setCleanImageReview,
    layerPaintTargets,
    setLayerPaintMap,
    layerMapThumbs,
    saveLayerMapFile,
    getLayerMapPreviewUrl,
    bakeMeshTextures,
  } = useProject();
  const { showModal, hideModal } = useModal();
  const { generateViaHub, removeBackground } = useHubGeneration();

  // ── Local state ──
  const [editingLayerId, setEditingLayerId] = useState(null);
  const [editingLayerName, setEditingLayerName] = useState('');
  const [layerMenuOpenId, setLayerMenuOpenId] = useState(null);
  const [layerMenuPos, setLayerMenuPos] = useState({ top: 0, right: 0 });
  // Fill Layer — layer object being color-filled; non-null opens the picker.
  const [fillLayer, setFillLayer] = useState(null);
  const [fillColor, setFillColor] = useState('#ffffff');
  const dragLayerIndexRef = useRef(null);
  const [draggingLayerIdx, setDraggingLayerIdx] = useState(null);
  const [dropIndicatorIdx, setDropIndicatorIdx] = useState(null);
  const [downloadingUvmap, setDownloadingUvmap] = useState(false);
  const [flattening, setFlattening] = useState(false);
  const [addingLayer, setAddingLayer] = useState(false);
  const [layersMenuOpen, setLayersMenuOpen] = useState(false);
  const [layersMenuPos, setLayersMenuPos] = useState({ top: 0, right: 0 });
  const [reprojectingAll, setReprojectingAll] = useState(false);
  const [removingBgLayerId, setRemovingBgLayerId] = useState(null);
  const [cleaningLayerId, setCleaningLayerId] = useState(null);
  const [mirroringLayerId, setMirroringLayerId] = useState(null);
  // In-flight uvmap/orm/mask/emissive saves — drives the spinner beside
  // the Layers title.
  const layerSaveCount = useSyncExternalStore(subscribeLayerSaves, getLayerSaveCount);

  const paintMapFor = (layerId) => layerPaintTargets?.[layerId] || 'base';

  // Scroll the restored selection into view on page load / mesh switch —
  // once per layer; block:'nearest' no-ops when the row is already
  // visible, so clicks never trigger this.
  const layersListRef = useRef(null);
  const didScrollToLayerRef = useRef(null);
  useEffect(() => {
    if (!selectedLayerId || didScrollToLayerRef.current === selectedLayerId) return;
    const el = layersListRef.current?.querySelector(`[data-layer-id="${selectedLayerId}"]`);
    if (!el) return;
    didScrollToLayerRef.current = selectedLayerId;
    el.scrollIntoView({ block: 'nearest' });
  }, [meshLayers, selectedLayerId]);

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

  // ── Layer handlers ──
  // Create a new empty layer at the top of the stack — the stamp tool's draw
  // target. Records the current camera angle so the row gets an angle thumb.
  const handleAddLayer = async () => {
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (!meshDbId || addingLayer) return;
    setAddingLayer(true);
    try {
      const res = await layerApi.create(
        id,
        meshDbId,
        `Layer ${meshLayers.length + 1}`,
        JSON.stringify(viewerRef.current?.getCameraAngle?.() || {}),
        0,
        null
      );
      if (!res.data?.success) throw new Error('Failed to create layer');
      const newLayer = res.data.data;
      const newList = [newLayer, ...meshLayers];
      setMeshLayers(newList);
      syncAllMeshLayers(newList);
      await layerApi.reorder(id, meshDbId, newList.map((l) => l.id));
      setSelectedLayerId(newLayer.id);
      await refreshLayerTextures(newList);
    } catch (err) {
      console.error('Failed to add layer:', err);
    } finally {
      setAddingLayer(false);
    }
  };

  // Fetch uvmap + mask data for every visible layer, ordered top→bottom.
  // The mask comes from the live render target first (covers unsaved
  // strokes), falling back to the saved mask.png. Callers must revoke each
  // item.url when done.
  const gatherVisibleLayerItems = async () => {
    const meshDbId = meshDbIds[selectedMesh.key];
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const items = [];
    for (const layer of meshLayers.filter((l) => l.visible !== false)) {
      try {
        const res = await fetch(layerApi.uvmapUrl(id, meshDbId, layer.id), { headers });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob.size) continue;

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
      } catch {
        /* skip layers whose uvmap fails to load */
      }
    }
    return items;
  };

  // Download the baked textures zip — every visible layer's uvmap, orm,
  // and emissive maps composited via the same CPU compositor the shader
  // path uses. orm.png/emissive.png are skipped when no layer contributes
  // map data.
  const handleDownloadUvmap = async () => {
    if (!selectedMesh || downloadingUvmap || !viewerRef.current) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    setDownloadingUvmap(true);
    try {
      const comp = await bakeMeshTextures(meshDbId);
      if (!comp) return;
      const files = {};
      const uvmap = await imgDataToPngBytes(comp.imgData);
      if (uvmap) files['uvmap.png'] = uvmap;
      if (comp.ormImgData) {
        const orm = await imgDataToPngBytes(comp.ormImgData);
        if (orm) files['orm.png'] = orm;
      }
      if (comp.emisImgData) {
        const emis = await imgDataToPngBytes(comp.emisImgData);
        if (emis) files['emissive.png'] = emis;
      }
      const meshName = (selectedMesh.name || 'mesh').replace(/[^\w.-]+/g, '_');
      downloadZip(files, `${meshName}_textures.zip`);
    } catch (err) {
      console.error('Failed to download baked textures:', err);
    } finally {
      setDownloadingUvmap(false);
    }
  };

  // Flatten every visible layer (masks applied) into a new "Combined Layers"
  // layer at the top of the stack. Uses the same CPU compositor as the
  // download path so the result matches the on-mesh render exactly.
  const handleFlattenLayers = async () => {
    if (!selectedMesh || flattening || !viewerRef.current) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    setFlattening(true);
    const items = [];
    try {
      items.push(...await gatherVisibleLayerItems());
      const canvas = await viewerRef.current.compositeLayersToCanvas?.(items);
      if (!canvas) return;
      const dataUrl = canvas.toDataURL('image/png');

      // No camera angle, no reference — the flattened uvmap is authoritative.
      const res = await layerApi.create(id, meshDbId, 'Combined Layers', null, 3, null);
      if (!res.data?.success) throw new Error(res.data?.message || 'Failed to create flattened layer');
      const newLayer = res.data.data;
      await layerApi.saveUvMap(id, newLayer.id, meshDbId, dataUrl);
      updateLayerImageCache(newLayer.id, dataUrl, 'uvmap');

      // Solid white mask — hasMask disables the near-black cull, which is
      // what we want: the flattened composite defines visibility on its own.
      const mc = document.createElement('canvas');
      mc.width = textureResolution;
      mc.height = textureResolution;
      const mctx = mc.getContext('2d');
      mctx.fillStyle = '#fff';
      mctx.fillRect(0, 0, mc.width, mc.height);
      const flatMaskDataUrl = mc.toDataURL('image/png');
      await layerApi.saveMasks(id, meshDbId, [{ layerId: newLayer.id, base64Mask: flatMaskDataUrl }]);
      updateLayerImageCache(newLayer.id, flatMaskDataUrl, 'mask');

      const newList = [newLayer, ...meshLayers];
      setMeshLayers(newList);
      syncAllMeshLayers(newList);
      await layerApi.reorder(id, meshDbId, newList.map((l) => l.id));
      setSelectedLayerId(newLayer.id);
      await refreshLayerTextures(newList);
    } catch (err) {
      console.error('Failed to flatten layers:', err);
    } finally {
      items.forEach((it) => URL.revokeObjectURL(it.url));
      setFlattening(false);
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
    } catch (err) {
      console.error('Failed to refresh layer textures:', err);
    }
    // Fire-and-forget — the toggle is already reflected in state and the
    // shader has been rebuilt; only revert this layer if the call fails.
    layerApi.toggleVisible(id, layer.id, newVisible).catch(async (err) => {
      console.error('Failed to toggle layer visibility:', err);
      const reverted = meshLayersRef.current.map((l) =>
        l.id === layer.id ? { ...l, visible: layer.visible } : l
      );
      setMeshLayers(reverted);
      syncAllMeshLayers(reverted);
      await refreshLayerTextures(reverted);
    });
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

  // Duplicate a layer — copies uvmap.png and mask.png into a new record
  // inserted directly above the source. Reads the live paint/mask render
  // targets when loaded so in-flight (not yet debounce-saved) strokes are
  // included; falls back to the saved files otherwise.
  const handleDuplicateLayer = async (layer) => {
    if (!layer || !selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    try {
      // Source uvmap — the live stamp/paint RT is authoritative when it
      // exists (carries unsaved brush/stamp/blur edits); else the file.
      let uvmapDataUrl = viewerRef.current?.getStampCanvasDataUrl?.(layer.id);
      if (!uvmapDataUrl) {
        const uvmapRes = await fetch(layerApi.uvmapUrl(id, meshDbId, layer.id), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (uvmapRes.ok) uvmapDataUrl = await blobToDataUrl(await uvmapRes.blob());
      }

      // Source mask — live RT readback when the mask is loaded, else the
      // saved mask.png. No mask → the duplicate stays fully visible.
      let maskDataUrl = null;
      const maskEntry = layerMasksRef.current.get(layer.id);
      if (maskEntry) {
        try { maskDataUrl = viewerRef.current?.maskToDataURL?.(maskEntry) || null; }
        catch { /* fall through to the saved file */ }
      }
      if (!maskDataUrl) {
        const maskRes = await fetch(layerApi.maskUrl(id, meshDbId, layer.id), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (maskRes.ok) maskDataUrl = await blobToDataUrl(await maskRes.blob());
      }

      const createRes = await layerApi.create(
        id, meshDbId, `${layer.name} Copy`, layer.cameraAngle ?? null, layer.type ?? 0, layer.referenceId ?? null
      );
      if (!createRes.data?.success) throw new Error(createRes.data?.message || 'Failed to create layer');
      const newLayer = createRes.data.data;

      // Best-effort copies of the optional per-layer files — image.png keeps
      // Reproject/Reference Image working on the copy; the angle thumb is
      // identical since the camera angle is shared.
      try {
        const imgRes = await fetch(layerApi.imageUrl(id, meshDbId, layer.id), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (imgRes.ok) await layerApi.saveImage(id, newLayer.id, meshDbId, await blobToDataUrl(await imgRes.blob()));
      } catch { /* source has no image.png */ }
      try {
        const thumbRes = await fetch(layerApi.angleThumbUrl(id, meshDbId, layer.id), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (thumbRes.ok) await layerApi.saveAngleThumb(id, newLayer.id, meshDbId, await blobToDataUrl(await thumbRes.blob()));
      } catch { /* source has no angle thumb */ }

      if (uvmapDataUrl) {
        await layerApi.saveUvMap(id, newLayer.id, meshDbId, uvmapDataUrl);
        updateLayerImageCache(newLayer.id, uvmapDataUrl, 'uvmap');
      }
      if (maskDataUrl) {
        await layerApi.saveMasks(id, meshDbId, [{ layerId: newLayer.id, base64Mask: maskDataUrl }]);
        updateLayerImageCache(newLayer.id, maskDataUrl, 'mask');
      }

      const insertAt = Math.max(0, meshLayers.findIndex((l) => l.id === layer.id));
      const newList = [...meshLayers.slice(0, insertAt), newLayer, ...meshLayers.slice(insertAt)];
      setMeshLayers(newList);
      syncAllMeshLayers(newList);
      await layerApi.reorder(id, meshDbId, newList.map((l) => l.id));
      setSelectedLayerId(newLayer.id);
      setLayerThumbVersion((v) => v + 1);
      setMaskThumbVersions((prev) => ({ ...prev, [newLayer.id]: (prev[newLayer.id] || 0) + 1 }));
      await refreshLayerTextures(newList);
    } catch (err) {
      console.error('Failed to duplicate layer:', err);
    }
  };

  // Fill Layer — opens the color picker; every change previews a solid fill
  // on the layer's live uvmap. OK bakes the fill into the committed texture
  // and saves uvmap.png; Cancel restores the original by rebinding the
  // untouched front buffer.
  const handleFillLayer = (layer) => {
    if (!layer) return;
    setFillColor(brushColor || '#ffffff');
    setFillLayer(layer);
  };

  // Live preview — base fills the layer's uvmap; the map fills write only
  // their channel (roughness luminance → orm.R, metallic → orm.B, emissive
  // → full rgb).
  const previewFill = (c) => {
    if (!fillLayer) return;
    const map = paintMapFor(fillLayer.id);
    if (map === 'base') {
      viewerRef.current?.previewLayerFill(fillLayer.id, c.hex, (c.a ?? 255) / 255);
      return;
    }
    const r = parseInt(c.hex.slice(1, 3), 16) / 255;
    const g = parseInt(c.hex.slice(3, 5), 16) / 255;
    const b = parseInt(c.hex.slice(5, 7), 16) / 255;
    const v = map === 'emissive' ? null : 0.2126 * r + 0.7152 * g + 0.0722 * b;
    viewerRef.current?.previewLayerMapFill(
      fillLayer.id,
      map,
      v ?? r, v ?? g, v ?? b,
      map === 'emissive' ? (c.a ?? 255) / 255 : 1
    );
  };

  const handleFillConfirm = async () => {
    const layer = fillLayer;
    if (!layer) return;
    const map = paintMapFor(layer.id);
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    try {
      if (map !== 'base') {
        // Layer-map fill — commit bakes the channel write into front; the
        // kind tells us which file (orm.png / emissive.png) to persist.
        const kind = viewerRef.current?.commitLayerMapFill(layer.id, map);
        if (kind) await saveLayerMapFile(layer.id, kind);
      } else {
        viewerRef.current?.commitLayerFill(layer.id);
        const dataUrl = viewerRef.current?.getStampCanvasDataUrl?.(layer.id);
        if (dataUrl && meshDbId) {
          await layerApi.saveUvMap(id, layer.id, meshDbId, dataUrl);
          updateLayerImageCache(layer.id, dataUrl, 'uvmap');
        }
        setLayerThumbVersion((v) => v + 1);
      }
    } catch (err) {
      console.error('Fill Layer failed:', err);
    }
  };

  const closeFillPicker = () => {
    if (fillLayer) {
      const map = paintMapFor(fillLayer.id);
      if (map === 'base') viewerRef.current?.cancelLayerFill(fillLayer.id);
      else viewerRef.current?.cancelLayerMapFill(fillLayer.id, map);
    }
    setFillLayer(null);
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
    // Server wrote exactly what we sent — update the shared cache in place
    // instead of invalidating and re-downloading it (+ mask below).
    updateLayerImageCache(layer.id, projected.uvMap, 'uvmap');
    // Reprojection changes the coverage footprint — refresh the mask, but
    // never overwrite an inpaint layer's painted mask.
    if (projected.mask && layer.type !== 2) {
      await layerApi.saveMasks(id, meshDbId, [{ layerId: layer.id, base64Mask: projected.mask }]);
      updateLayerImageCache(layer.id, projected.mask, 'mask');
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

  // Wipe the layer's mask back to pure white (fully visible). No-op for
  // layers that never had a mask — creating+whiting one would flip the
  // shader's hasMask flag and disable the near-black cull it relies on.
  const handleEraseMask = async (layer) => {
    if (!layer) return;
    const entry = layerMasksRef.current.get(layer.id);
    if (!entry) return;
    viewerRef.current?.clearLayerMask?.(entry);
    markMaskModified(layer.id);
    // Post immediately rather than waiting for the 5s debounce — cancel any
    // pending timer first so it doesn't fire a redundant save.
    cancelMaskSaveTimer();
    await saveModifiedMasks();
    await refreshLayerTextures();
  };

  // Inpaint mode only — wipe the layer's mask and copy the current inpaint
  // selection into it (white = painted region stays visible).
  const handleMaskFromSelection = async (layer) => {
    if (!layer) return;
    const dataUrl = viewerRef.current?.inpaintMaskToDataURL?.();
    if (!dataUrl) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      // maskToDataURL returns PNG orientation — flipY puts it back in UV space
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
      const entry = getOrCreateLayerMask(layer.id);
      viewerRef.current?.uploadMaskImage?.(entry, bitmap);
      bitmap.close();
      markMaskModified(layer.id);
      scheduleMaskSave();
      await refreshLayerTextures();
    } catch (err) {
      console.error('Failed to apply inpaint mask to layer:', err);
    }
  };

  // Run the layer's uvmap.png through the configured Clean Image (type-6)
  // model — the server runs FBCNN artifact removal and overwrites uvmap.png
  // at the same resolution. The stamp render target is dropped so the next
  // dab re-seeds from the cleaned image.
  const handleCleanImage = async (layer) => {
    if (!layer || !selectedMesh || cleaningLayerId) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    setCleaningLayerId(layer.id);
    try {
      const res = await layerApi.cleanImage(id, layer.id, meshDbId);
      if (!res.data?.success) throw new Error(res.data?.message || 'Clean image failed');
      viewerRef.current?.invalidateStampCanvas?.(layer.id);
      invalidateLayerAssets(layer.id); // server overwrote uvmap.png
      setLayerThumbVersion((v) => v + 1); // reload uvmap-thumb <img>
      await refreshLayerTextures();
      // Show the Accept/Revert review card above the tools — the server kept
      // the pre-clean uvmap as uvmap_old.png so Revert can restore it.
      setCleanImageReview({ layerId: layer.id, meshDbId });
    } catch (err) {
      console.error('Clean image failed:', err);
    } finally {
      setCleaningLayerId(null);
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
      const projected = await viewerRef.current?.projectImageToUvMap(
        processed,
        rotation,
        textureResolution
      );
      if (projected?.uvMap) {
        await layerApi.saveUvMap(id, layer.id, meshDbId, projected.uvMap);
        updateLayerImageCache(layer.id, projected.uvMap, 'uvmap');
      }

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
    // Defer hiding the row until the browser has started the drag —
    // display:none on the drag source during dragstart cancels the drag.
    requestAnimationFrame(() => setDraggingLayerIdx(index));
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

  // Mirror a layer onto the opposite side of the mesh: the layer's image is
  // flipped horizontally and projected from its camera angle orbited 180°,
  // saved as a new layer directly above the source in the stack.
  const handleMirrorLayer = async (layer) => {
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (!meshDbId || layer.hasImage === false) return;
    let newLayer = null;
    try {
      // 1 — mirrored angle: orbit the layer's stored camera angle 180° on Y
      let rotation = {};
      try { rotation = JSON.parse(layer.cameraAngle || '{}'); } catch { /* ignore */ }
      const mirroredRotation = { ...rotation, y: (rotation.y || 0) + 180 };
      const mirroredJson = JSON.stringify(mirroredRotation);

      // 2 — render the unlit albedo composite at the layer's stored angle and
      // flip it. image.png is the raw model output (baked lighting, single
      // layer) — the composite render is the actual mesh albedo in that view.
      // Falls back to the saved image.png if the capture fails.
      let flippedDataUrl = null;
      const composite = viewerRef.current?.captureCompositeImage?.(textureResolution, rotation);
      if (composite) {
        flippedDataUrl = await flipImageDataUrl(composite);
      }
      if (!flippedDataUrl) {
        const response = await fetch(layerApi.imageUrl(id, meshDbId, layer.id), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error('Failed to fetch layer image');
        flippedDataUrl = await flipImageDataUrl(await blobToDataUrl(await response.blob()));
      }

      // 2b — source mask → screen-space render at the source angle → flipped.
      // Gives the flipped albedo its transparent-background cutout for
      // alignment, and later re-projects as the mirrored layer's mask.
      let flippedMaskView = null;
      try {
        const maskRes = await fetch(layerApi.maskUrl(id, meshDbId, layer.id), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (maskRes.ok) {
          const maskView = await viewerRef.current?.captureMaskViewImage?.(
            await blobToDataUrl(await maskRes.blob()), rotation, textureResolution
          );
          if (maskView) flippedMaskView = await flipImageDataUrl(maskView);
        }
      } catch (err) {
        console.warn('Failed to render layer mask view:', err);
      }

      // 2c — align the flipped albedo by matching mesh outlines: silhouette
      // renders from the source and mirrored angles, flip the source outline,
      // find the max-overlap offset, apply it to the flipped image.
      let alignedDataUrl = flippedDataUrl;
      try {
        const srcSilhouette = viewerRef.current?.captureSilhouetteImage?.(rotation, textureResolution);
        const tgtSilhouette = viewerRef.current?.captureSilhouetteImage?.(mirroredRotation, textureResolution);
        if (srcSilhouette && tgtSilhouette) {
          const { dx, dy } = await findOutlineOffset(srcSilhouette, tgtSilhouette);
          alignedDataUrl = await drawImageAtOffset(flippedDataUrl, dx, dy);
        }
      } catch (err) {
        console.warn('Mirror image alignment failed:', err);
      }

      // 3 — create "<name> Mirrored" and insert it directly above the source
      const layerRes = await layerApi.create(id, meshDbId, `${layer.name} Mirrored`, mirroredJson, 1, layer.referenceId ?? null);
      if (!layerRes.data?.success) throw new Error('Failed to create layer');
      newLayer = layerRes.data.data;
      const insertAt = Math.max(0, meshLayers.findIndex((l) => l.id === layer.id));
      const newList = [...meshLayers.slice(0, insertAt), newLayer, ...meshLayers.slice(insertAt)];
      setMeshLayers(newList);
      syncAllMeshLayers(newList);
      await layerApi.reorder(id, meshDbId, newList.map((l) => l.id));

      // 4 — angle thumb from the mirrored view, then save the flipped image
      const angleThumb = viewerRef.current?.captureThumbnail?.(75, mirroredRotation);
      if (angleThumb) {
        try { await layerApi.saveAngleThumb(id, newLayer.id, meshDbId, angleThumb); }
        catch (err) { console.warn('Failed to save layer angle thumbnail:', err); }
      }
      await layerApi.saveImage(id, newLayer.id, meshDbId, alignedDataUrl);

      // Debug artifacts in the layer folder: the albedo render before
      // alignment, and the flipped+aligned result fed to the model.
      try {
        if (composite) await layerApi.saveFile(id, newLayer.id, meshDbId, 'original.png', composite);
        await layerApi.saveFile(id, newLayer.id, meshDbId, 'original_flipped.png', alignedDataUrl);
      } catch (err) {
        console.warn('Failed to save mirror debug images:', err);
      }

      // 5 — run the flipped image through the projection (Depth to Image)
      // model conditioned on the mirrored view's depth map, then background
      // removal — same pipeline as generation/inpaint. The eye icon swaps to
      // a spinner and the thumbs row shows the generating state meanwhile.
      setMirroringLayerId(newLayer.id);
      setLayerAssetsGenerating(newLayer.id, true);
      let generatedImage;
      try {
        const depthMap = viewerRef.current?.captureDepthMap(textureResolution, mirroredRotation);
        if (!depthMap) throw new Error('Failed to generate depth map');

        const projectionModel = (allImageModels || []).find((m) => m.type === 1 && m.active !== false);
        if (!projectionModel) throw new Error('No Depth to Image model configured');

        if (isComfyUI || isGradio) {
          const hubUrl = isComfyUI ? '/hubs/comfyui' : '/hubs/gradio';
          const hubName = isComfyUI ? 'ComfyUI' : 'Gradio';
          await layerApi.saveDepthMap(id, newLayer.id, meshDbId, depthMap);
          generatedImage = await generateViaHub({
            hubUrl,
            hubName,
            layer: newLayer,
            meshDbId,
            fullPrompt: '',
            inputImage: alignedDataUrl,
            imageModelId: projectionModel.id,
          });
        } else {
          const genRes = await layerApi.generate(
            id,
            newLayer.id,
            meshDbId,
            projectionModel.id,
            '',
            depthMap,
            mirroredJson,
            null,
            alignedDataUrl,
            textureResolution
          );
          if (!genRes.data?.success) throw new Error(genRes.data?.message || 'Projection generation failed');
          generatedImage = genRes.data.data?.image;
        }

        if (generatedImage) {
          generatedImage = await removeBackground({ generatedImage, layer: newLayer, meshDbId, cameraAngleJson: mirroredJson });
        }
      } finally {
        setMirroringLayerId(null);
      }

      // The generate/saveComfyUiResult + background-removal paths overwrite
      // image.png with their model output — restore the aligned albedo as
      // the layer's image.
      await layerApi.saveImage(id, newLayer.id, meshDbId, alignedDataUrl);

      // 6 — project the model output onto the mesh from the mirrored angle,
      // and mirror the source mask the same way: render it onto the mesh in a
      // hidden canvas from the source angle, flip it horizontally, then
      // re-project onto the mesh from the mirrored angle.
      let mirroredMask = null;
      if (generatedImage) {
        const projected = await viewerRef.current?.projectImageToUvMap(generatedImage, mirroredRotation, textureResolution);
        if (projected?.uvMap) {
          await layerApi.saveUvMap(id, newLayer.id, meshDbId, projected.uvMap);
          updateLayerImageCache(newLayer.id, projected.uvMap, 'uvmap');
        }
        if (flippedMaskView) {
          try {
            const maskProjected = await viewerRef.current?.projectImageToUvMap(flippedMaskView, mirroredRotation, textureResolution);
            if (maskProjected?.uvMap) mirroredMask = await projectionToMask(maskProjected.uvMap);
          } catch (err) {
            console.warn('Failed to mirror layer mask:', err);
          }
        }
        const maskToSave = mirroredMask || projected?.mask;
        if (maskToSave) {
          await layerApi.saveMasks(id, meshDbId, [{ layerId: newLayer.id, base64Mask: maskToSave }]);
          updateLayerImageCache(newLayer.id, maskToSave, 'mask');
        }
      }

      // 7 — orbit the live camera to the mirrored side and refresh
      viewerRef.current?.setCameraRotation?.(mirroredRotation);
      const updatedLayers = await loadMeshLayers(meshDbId);
      setLayerThumbVersion((v) => v + 1);
      setMaskThumbVersions((prev) => ({ ...prev, [newLayer.id]: (prev[newLayer.id] || 0) + 1 }));
      await refreshLayerTextures(updatedLayers);
      setLayerAssetsGenerating(newLayer.id, false);
    } catch (err) {
      console.error('Mirror to new layer failed:', err);
      if (newLayer) {
        setMirroringLayerId(null);
        setLayerAssetsGenerating(newLayer.id, false);
      }
    }
  };

  // UV map thumb click → full-size uvmap.png in a preview modal
  const handleUvmapThumbClick = (layer) => {
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (!meshDbId || layer.hasImage === false) return;
    showModal({
      title: `${layer.name} — UV Map`,
      className: 'max-w-[90vw] max-h-[90vh]',
      onClose: hideModal,
      body: (
        <div className="flex items-center justify-center" onClick={hideModal}>
          <img
            src={`${layerApi.uvmapUrl(id, meshDbId, layer.id)}?r=${layerThumbVersion}`}
            alt={`${layer.name} UV map`}
            className="max-w-[85vw] max-h-[80vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ),
    });
  };

  // Map thumb click → full-size channel image in a preview modal.
  // Roughness/metallic render as grayscale of their orm.png channel with
  // the map alpha preserved (transparent = no data); emissive is rgb+alpha.
  const handleMapThumbClick = async (layer, mapKey) => {
    if (mapKey === 'base') { handleUvmapThumbClick(layer); return; }
    const url = await getLayerMapPreviewUrl(layer.id, mapKey);
    if (!url) return;
    const label = PAINT_MAPS.find((m) => m.key === mapKey)?.label || mapKey;
    showModal({
      title: `${layer.name} — ${label}`,
      className: 'max-w-[90vw] max-h-[90vh]',
      onClose: hideModal,
      body: (
        <div className="flex items-center justify-center" onClick={hideModal}>
          <img
            src={url}
            alt={`${layer.name} ${label}`}
            className="max-w-[85vw] max-h-[80vh] object-contain rounded-lg"
            style={CHECKERBOARD_BG}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ),
    });
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
    <>
      {/* Layers section */}
      {selectedMesh && (
        <div className="border-t border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Layers</h3>
              {layerSaveCount > 0 && (
                <Spinner className="text-sm text-blue-500" />
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleAddLayer}
                disabled={!selectedMesh || addingLayer}
                className="p-1 rounded text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                aria-label="New empty layer"
                title="New empty layer — added to the top of the stack"
              >
                {addingLayer ? (
                  <Spinner className="text-lg" />
                ) : (
                  <Icon name="add" className="text-lg" />
                )}
              </button>
              <button
                onClick={handleDownloadUvmap}
                disabled={!selectedMesh || meshLayers.length === 0 || downloadingUvmap}
                className="p-1 rounded text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                aria-label="Download baked textures"
                title="Download baked uvmap.png, orm.png, and emissive.png as a zip"
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
          <div className="overflow-y-auto flex-1" ref={layersListRef}>
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
                    data-layer-id={layer.id}
                    draggable={editingLayerId !== layer.id}
                    onDragStart={(e) => handleLayerDragStart(e, index)}
                    onDragEnd={endLayerDrag}
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
                      {/* Drag handle — visual affordance; the whole row drags */}
                      <span
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
                          {removingBgLayerId === layer.id || mirroringLayerId === layer.id || cleaningLayerId === layer.id ? (
                            <span className="flex-shrink-0 translate-y-1 pr-1" title={mirroringLayerId === layer.id ? 'Generating projection...' : cleaningLayerId === layer.id ? 'Cleaning image...' : 'Removing background...'}>
                              <Spinner className="text-2xl" />
                            </span>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleToggleLayerVisible(layer); }}
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

                          {layer.type === 2 ? (
                            <span className="flex-shrink-0 pr-2 text-green-600 dark:text-green-500 text-[10px] font-bold">
                              Inpainted
                            </span>
                          ) : layer.type === 1 ? (
                            <span className="flex-shrink-0 pr-2 text-purple-600 dark:text-purple-400 text-[10px] font-bold">
                              Generated
                            </span>
                          ) : layer.type === 3 ? (
                            <span className="flex-shrink-0 pr-2 text-blue-600 dark:text-blue-400 text-[10px] font-bold">
                              Flattened
                            </span>
                          ) : null}

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

                        {/* Row 2: UV map thumb + camera angle thumb + mask thumb + delete.
                            items-start — the map carousel's label makes its column taller
                            than the 47px thumbs; top-align keeps them flush with the image. */}
                        <div className="flex items-start justify-between mt-1">
                          <div className="flex items-start gap-2">
                            {assetGeneratingLayerIds?.has(layer.id) || mirroringLayerId === layer.id ? (
                              <div className="flex items-center gap-2" style={{ height: 47 }}>
                                <Spinner className="text-lg" />
                                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                  Generating layer assets...
                                </span>
                              </div>
                            ) : (
                              <>
                            {/* Paint-map carousel — the uvmap thumb cycles
                                through Base Color / Roughness / Metallic /
                                Emissive. The selection picks which map this
                                layer's drawing tools write into; orm/
                                emissive are shared mesh-level files, so all
                                layers show the same map thumbnails. */}
                            {(() => {
                              const mapKey = paintMapFor(layer.id);
                              const mapIdx = Math.max(0, PAINT_MAPS.findIndex((m) => m.key === mapKey));
                              const step = (dir) => {
                                const next = (mapIdx + dir + PAINT_MAPS.length) % PAINT_MAPS.length;
                                setLayerPaintMap(layer.id, PAINT_MAPS[next].key);
                              };
                              // Locked while the fill picker is open — switching
                              // maps mid-preview would strand a preview on the
                              // previous map's back buffer.
                              // Arrows are hidden until the thumb is hovered
                              // (group-hover); while the fill picker is open
                              // they hover in dimmed and stay unclickable.
                              const arrowCls = `absolute top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white px-px leading-none text-[10px] select-none opacity-0 transition-opacity ${fillLayer ? 'pointer-events-none group-hover:opacity-30' : 'group-hover:opacity-100'}`;
                              return (
                                <div className="flex-shrink-0 flex flex-col items-center" style={{ width: 47 }}>
                                  <div
                                    className="group relative rounded border border-gray-200 dark:border-gray-600 overflow-hidden hover:ring-1 hover:ring-purple-500 transition"
                                    style={{ width: 47, height: 47, ...CHECKERBOARD_BG }}
                                    title={`Paint target: ${PAINT_MAPS[mapIdx].label}`}
                                  >
                                    {mapKey === 'base' ? (
                                      <div
                                        className="w-full h-full cursor-pointer"
                                        onClick={() => handleUvmapThumbClick(layer)}
                                        title="View full UV map"
                                      >
                                        {layer.hasImage !== false && (
                                          <img
                                            src={`${layerApi.uvmapThumbUrl(id, meshDbIds[selectedMesh.key], layer.id)}?r=${layerThumbVersion}`}
                                            alt={layer.name}
                                            draggable={false}
                                            className="w-full h-full object-cover"
                                            onLoad={(e) => { e.target.style.display = ''; }}
                                            onError={(e) => { e.target.style.display = 'none'; }}
                                          />
                                        )}
                                      </div>
                                    ) : (
                                      <div
                                        className="w-full h-full flex items-center justify-center cursor-pointer"
                                        onClick={() => handleMapThumbClick(layer, mapKey)}
                                        title={`View full ${PAINT_MAPS[mapIdx].label}`}
                                      >
                                        {layerMapThumbs?.[layer.id]?.[mapKey] && (
                                          <img
                                            src={layerMapThumbs[layer.id][mapKey]}
                                            alt={PAINT_MAPS[mapIdx].label}
                                            draggable={false}
                                            className="w-full h-full object-cover"
                                          />
                                        )}
                                      </div>
                                    )}
                                    <button
                                      className={`${arrowCls} left-0`}
                                      onClick={(e) => { e.stopPropagation(); step(-1); }}
                                      title="Previous map"
                                    >
                                      <Icon name="chevron_left" className="text-[12px] leading-none" />
                                    </button>
                                    <button
                                      className={`${arrowCls} right-0`}
                                      onClick={(e) => { e.stopPropagation(); step(1); }}
                                      title="Next map"
                                    >
                                      <Icon name="chevron_right" className="text-[12px] leading-none" />
                                    </button>
                                  </div>
                                  <span className="text-[10px] leading-tight text-gray-500 dark:text-gray-400 mt-0.5 text-center w-full truncate">
                                    {PAINT_MAPS[mapIdx].label}
                                  </span>
                                </div>
                              );
                            })()}

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
                                      draggable={false}
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
                                    draggable={false}
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
                                  draggable={false}
                                  className="w-full h-full object-cover"
                                  onLoad={(e) => { e.target.style.display = ''; }}
                                  onError={(e) => { e.target.style.display = 'none'; }}
                                />
                              </div>
                            )}
                              </>
                            )}
                          </div>

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
              onClick={() => { setLayersMenuOpen(false); handleFlattenLayers(); }}
              disabled={flattening}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              <Icon name="layers" className="text-sm" />
              {flattening ? 'Flattening…' : 'Flatten All To New Layer'}
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
              onClick={() => { const lid = layerMenuOpenId; setLayerMenuOpenId(null); const layer = meshLayers.find((l) => l.id === lid); if (layer) handleMirrorLayer(layer); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
            >
              <Icon name="flip" className="text-sm" />
              Mirror To New Layer
            </button>
            <button
              onClick={() => { const lid = layerMenuOpenId; setLayerMenuOpenId(null); const layer = meshLayers.find((l) => l.id === lid); if (layer) handleDuplicateLayer(layer); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
            >
              <Icon name="content_copy" className="text-sm" />
              Duplicate Layer
            </button>
            <button
              onClick={() => { const lid = layerMenuOpenId; setLayerMenuOpenId(null); const layer = meshLayers.find((l) => l.id === lid); if (layer) handleFillLayer(layer); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
            >
              <Icon name="format_color_fill" className="text-sm" />
              {FILL_LABELS[paintMapFor(layerMenuOpenId)] || 'Fill Layer'}
            </button>
            <button
              onClick={() => { const lid = layerMenuOpenId; setLayerMenuOpenId(null); const layer = meshLayers.find((l) => l.id === lid); if (layer) handleCleanImage(layer); }}
              disabled={cleaningLayerId === layerMenuOpenId}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2 disabled:opacity-50"
            >
              <Icon name="auto_fix_high" className="text-sm" />
              {cleaningLayerId === layerMenuOpenId ? 'Cleaning…' : 'Clean Image'}
            </button>
            <button
              onClick={() => { const lid = layerMenuOpenId; setLayerMenuOpenId(null); const layer = meshLayers.find((l) => l.id === lid); if (layer) handleEraseMask(layer); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
            >
              <Icon name="ink_eraser" className="text-sm" />
              Erase Mask
            </button>
            {maskTool === 'inpaint' && (
              <button
                onClick={() => { const lid = layerMenuOpenId; setLayerMenuOpenId(null); const layer = meshLayers.find((l) => l.id === lid); if (layer) handleMaskFromSelection(layer); }}
                className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
              >
                <Icon name="select_all" className="text-sm" />
                Mask From Selection
              </button>
            )}
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
      {fillLayer && (
        <ColorPicker
          color={fillColor}
          onChange={previewFill}
          onOk={handleFillConfirm}
          onClose={closeFillPicker}
          projectId={id}
        />
      )}
    </>
  );
}
