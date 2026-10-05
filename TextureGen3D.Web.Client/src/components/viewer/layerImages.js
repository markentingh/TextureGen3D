import * as THREE from 'three';
import { fillTransparentRgb, loadImgEl } from './viewerUtils';

// Let the browser breathe between layers — the per-layer flood + canvas ops
// are synchronous work at texture resolution, and a tall stack would
// otherwise freeze the page for the whole pass.
const yieldToMain = () =>
  (window.scheduler?.yield ? scheduler.yield() : new Promise((r) => setTimeout(r, 0)));

/**
 * layerImages — CPU-side layer compositing and texture preparation.
 *
 * All functions produce/consume ImageData and upload via DataTexture rather
 * than canvas→texture. Canvas2D storage is premultiplied, so any texel with
 * a==0 loses its rgb on putImageData/toBlob — which is exactly the hidden
 * edge color the flood fill writes. Raw upload keeps it.
 */

// Composite items (ordered top→bottom) onto a canvas, matching the layer
// shader's semantics: mask.r lerps the uvmap alpha (white = visible) and
// near-black rgb is treated as empty (contentMask = step(0.01, length(rgb))).
// Returns { canvas, imgData } — canvas for PNG-producing callers (hidden
// rgb is lost on PNG encode, unavoidable), imgData for texture upload via
// imageDataToLayerTexture (preserves the flooded hidden rgb).
export const compositeLayerImages = async (items) => {
  if (!items.length) return null;
  // Map-only layers are legal (orm/emissive painted with no uvmap) —
  // missing albedo loads as null and composites as fully transparent.
  const imgs = await Promise.all(items.map((e) => (e.url ? loadImgEl(e.url) : Promise.resolve(null))));

  // Per-layer PBR maps — orm.png (roughness R / metallic B) + emissive.png
  // composite like the uvmaps but with an extra gate: a layer's map only
  // contributes where the map itself has data (its own alpha marks painted
  // coverage — layers without a map file contribute nothing and let the
  // layers below show through). Weight = layer mask × map alpha, and
  // the accumulated alpha records total coverage for the shader.
  const needOrm = items.some((e) => e.ormUrl);
  const needEmis = items.some((e) => e.emisUrl);
  const ormImgs = needOrm ? await Promise.all(items.map((e) => (e.ormUrl ? loadImgEl(e.ormUrl) : Promise.resolve(null)))) : null;
  const emisImgs = needEmis ? await Promise.all(items.map((e) => (e.emisUrl ? loadImgEl(e.emisUrl) : Promise.resolve(null)))) : null;
  // Canvas dims — first image that exists across albedo or either map
  // (a stack of map-only layers has no albedo image to size from).
  const firstImg = [...imgs, ...(ormImgs || []), ...(emisImgs || [])].find(Boolean);
  if (!firstImg) return null;
  const w = firstImg.naturalWidth || firstImg.width;
  const h = firstImg.naturalHeight || firstImg.height;
  const np = w * h * 4;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  const mc = document.createElement('canvas');
  mc.width = w;
  mc.height = h;
  const mctx = mc.getContext('2d', { willReadFrequently: true });

  const ormAcc = needOrm ? new Uint8ClampedArray(np) : null;
  const emisAcc = needEmis ? new Uint8ClampedArray(np) : null;
  // rgb seeds = the generated defaults (rough 1 / metal 0 / no emission);
  // alpha starts 0 — source-over accumulation of each layer's weight.
  if (ormAcc) for (let p = 0; p < np; p += 4) ormAcc[p] = 255;

  for (let i = items.length - 1; i >= 0; i--) { // bottom → top
    await yieldToMain();
    // Map-only layer (no uvmap) — fully transparent albedo; its mask and
    // maps still apply through the PBR composite below.
    const imgData = imgs[i]
      ? (() => {
          tctx.clearRect(0, 0, w, h);
          tctx.drawImage(imgs[i], 0, 0, w, h);
          return tctx.getImageData(0, 0, w, h);
        })()
      : new ImageData(w, h);
    let md = null;
    if (items[i].maskDataUrl) {
      const maskImg = await loadImgEl(items[i].maskDataUrl);
      mctx.clearRect(0, 0, w, h);
      mctx.drawImage(maskImg, 0, 0, w, h);
      md = mctx.getImageData(0, 0, w, h).data;
    }
    const d = imgData.data;
    // Near-black cull only applies to mask-less layers — when a mask is
    // present it alone defines visibility (same as the live shader's
    // cm = hasMask ? 1 : step). Runs before the rgb flood so culled
    // texels don't act as fill sources.
    if (!md) {
      for (let p = 0; p < d.length; p += 4) {
        if (d[p] * d[p] + d[p + 1] * d[p + 1] + d[p + 2] * d[p + 2] < 7) d[p + 3] = 0;
      }
    }
    // Flood rgb from visible texels into every hidden one (alpha==0, or
    // mask==0) — nearest-neighbor fill so no mip level can pull in black.
    // Semi-transparent texels keep their own rgb — they're real content.
    const seeds = new Uint8Array(w * h);
    for (let p = 0, px = 0; p < d.length; p += 4, px++) {
      if (d[p + 3] !== 0 && (!md || md[p] !== 0)) seeds[px] = 1;
    }
    fillTransparentRgb(d, w, h, seeds);
    // Apply the mask to alpha after the flood so masked-out texels keep
    // their filled rgb (invisible, but mip-safe).
    if (md) {
      for (let p = 0; p < d.length; p += 4) {
        d[p + 3] = Math.round((d[p + 3] * md[p]) / 255);
      }
    }

    // PBR channels — weight = this layer's mask × the map's own has-data
    // alpha (mask-less → 1). NOT the albedo alpha: the maps carry their
    // own coverage, so a roughness stroke on a transparent-albedo texel
    // still applies. Layers without a map file contribute nothing at all.
    const maskW = (p) => (md ? md[p] / 255 : 1);
    if (ormAcc || emisAcc) {
      if (ormAcc && ormImgs[i]) {
        mctx.clearRect(0, 0, w, h);
        mctx.drawImage(ormImgs[i], 0, 0, w, h);
        const ormD = mctx.getImageData(0, 0, w, h).data;
        for (let p = 0; p < np; p += 4) {
          // Coverage is split per channel — G = roughness alpha,
          // A = metallic alpha — so a metallic-only stroke can't claim
          // the texel's seeded rough=255. g==0 under a>0 = pre-split
          // file: its shared alpha covered both channels.
          const g8 = ormD[p + 1];
          const a8 = ormD[p + 3];
          const wtR = maskW(p) * ((g8 === 0 ? a8 : g8) / 255);
          const wtM = maskW(p) * (a8 / 255);
          if (wtR > 0) ormAcc[p] += (ormD[p] - ormAcc[p]) * wtR;
          if (wtM > 0) ormAcc[p + 2] += (ormD[p + 2] - ormAcc[p + 2]) * wtM;
          ormAcc[p + 1] += (255 - ormAcc[p + 1]) * wtR; // rough coverage
          // Metal-only texels (g==0, a>0) would decode downstream as a
          // pre-split "both channels" texel — write the 16/255 marker.
          if (wtM > 0 && ormAcc[p + 1] === 0) ormAcc[p + 1] = 16;
          ormAcc[p + 3] += (255 - ormAcc[p + 3]) * wtM; // metal coverage
        }
      }
      if (emisAcc && emisImgs[i]) {
        tctx.clearRect(0, 0, w, h);
        tctx.drawImage(emisImgs[i], 0, 0, w, h);
        const emisD = tctx.getImageData(0, 0, w, h).data;
        for (let p = 0; p < np; p += 4) {
          const wt = maskW(p) * (emisD[p + 3] / 255);
          if (wt === 0) continue;
          emisAcc[p] += (emisD[p] - emisAcc[p]) * wt;
          emisAcc[p + 1] += (emisD[p + 1] - emisAcc[p + 1]) * wt;
          emisAcc[p + 2] += (emisD[p + 2] - emisAcc[p + 2]) * wt;
          emisAcc[p + 3] += (255 - emisAcc[p + 3]) * wt;
        }
      }
    }

    tctx.clearRect(0, 0, w, h);
    tctx.putImageData(imgData, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  }

  // Flood every transparent texel's rgb with the nearest visible color.
  // Masked-out and unpainted texels keep hidden (usually dark) rgb — at any
  // mip level, sampling blends it into visible edge texels as a dark
  // fringe. Filling ALL of them (not just an N-px ring) makes every mip
  // fade to the edge color instead.
  const cd = ctx.getImageData(0, 0, w, h);
  const cdData = cd.data;
  const visible = new Uint8Array(w * h);
  for (let p = 0, px = 0; p < cdData.length; p += 4, px++) {
    if (cdData[p + 3] !== 0) visible[px] = 1;
  }
  fillTransparentRgb(cdData, w, h, visible);
  ctx.putImageData(cd, 0, 0);

  const out = { canvas, imgData: cd };
  if (ormAcc) out.ormImgData = new ImageData(ormAcc, w, h);
  if (emisAcc) out.emisImgData = new ImageData(emisAcc, w, h);
  return out;
};

// Upload raw RGBA pixels as a mipmapped texture via DataTexture — NOT
// canvas/PNG. Canvas storage is premultiplied, so putImageData/toBlob
// destroy rgb wherever a==0 — which is exactly the hidden edge color the
// flood fill writes. Raw upload keeps it. Rows are flipped manually so
// canvas row 0 lands at v=1 (same as flipY file loads).
export const imageDataToLayerTexture = (imgData) => {
  const w = imgData.width;
  const h = imgData.height;
  const src = imgData.data;
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    buf.set(src.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  }
  const tex = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
};

// Load one layer's uvmap for a live (selected) shader slot. Raw file
// textures carry hidden dark rgb in their transparent texels — mipmapped
// sampling blends it into visible edges as a dark fringe (the CPU bake
// avoids this via dilation). Mirror that here: fill rgb in every hidden
// texel (alpha=0, or mask=0 when the layer has a mask) with the nearest
// visible color. Alpha is left untouched — the shader still owns
// visibility (mask multiply / near-black cull).
export const loadLiveLayerTexture = async (item) => {
  const img = await loadImgEl(item.url);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  let md = null;
  if (item.maskDataUrl) {
    const maskImg = await loadImgEl(item.maskDataUrl);
    const mc = document.createElement('canvas');
    mc.width = w;
    mc.height = h;
    const mctx = mc.getContext('2d', { willReadFrequently: true });
    mctx.drawImage(maskImg, 0, 0, w, h);
    md = mctx.getImageData(0, 0, w, h).data;
  }

  // Seeds = texels the shader actually shows: alpha>0 and (masked →
  // mask.r>0) or (mask-less → not near-black). Semi-transparent texels
  // keep their own rgb — only fully hidden texels get filled.
  const filled = new Uint8Array(w * h);
  for (let p = 0, px = 0; p < d.length; p += 4, px++) {
    if (!md && d[p] * d[p] + d[p + 1] * d[p + 1] + d[p + 2] * d[p + 2] < 7) {
      // Same cull as the shader's near-black step — zero the alpha so the
      // texel becomes fillable without becoming visible.
      d[p + 3] = 0;
      continue;
    }
    if (d[p + 3] !== 0 && (!md || md[p] !== 0)) filled[px] = 1;
  }

  // Same BFS fill as the bake — every hidden texel gets the nearest
  // visible color so no mip level can pull in black. Upload via
  // DataTexture: canvas/PNG storage is premultiplied and would zero the
  // filled rgb on a==0 texels, undoing the fill entirely.
  fillTransparentRgb(d, w, h, filled);
  return { tex: imageDataToLayerTexture(imgData), url: null };
};
