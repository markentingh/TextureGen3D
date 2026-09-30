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
  const imgs = await Promise.all(items.map((e) => loadImgEl(e.url)));
  const w = imgs[0].naturalWidth || imgs[0].width;
  const h = imgs[0].naturalHeight || imgs[0].height;
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

  for (let i = items.length - 1; i >= 0; i--) { // bottom → top
    await yieldToMain();
    tctx.clearRect(0, 0, w, h);
    tctx.drawImage(imgs[i], 0, 0, w, h);
    const imgData = tctx.getImageData(0, 0, w, h);
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
  return { canvas, imgData: cd };
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
