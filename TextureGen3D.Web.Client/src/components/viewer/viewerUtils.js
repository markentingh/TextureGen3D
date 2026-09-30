/**
 * viewerUtils — shared CPU-side helpers for the ModelViewer: pixel floods,
 * image loading, render-target readback, and layout constants.
 */

// Screen-space scene offset in CSS pixels — shifts rendered content right.
// Applied via camera frustum/projection shift (NOT by translating the
// mesh/camera, which would cancel out).
// 160px centers the mesh between the 320px left popup and the 288px right sidebar:
//   (popupWidth + sidebarWidth) / 2 = (320 + 288) / 2 = 160
export const SCENE_OFFSET_PX = 160;

/**
 * fillTransparentRgb — multi-source BFS flood that gives every "hidden"
 * texel the rgb of its nearest visible texel. Bounded dilation (N passes ≈
 * N px) only covers linear filtering; deep mip levels still average in the
 * transparent-black rgb of distant texels, which reads as a dark fringe
 * around painted regions. BFS is complete coverage AND cheaper than a
 * multi-pass loop (each texel is visited once).
 *
 * @param {Uint8ClampedArray} data - RGBA pixel data (modified in place; alpha untouched)
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} visible - w*h, 1 = texel whose rgb is authoritative
 *   (kept + used as a BFS seed), 0 = hidden texel to fill
 */
export function fillTransparentRgb(data, w, h, visible) {
  const n = w * h;
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let p = 0; p < n; p++) if (visible[p]) queue[tail++] = p;
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    const i = p * 4;
    if (x > 0) {
      const q = p - 1;
      if (!visible[q]) { visible[q] = 1; const j = q * 4; data[j] = data[i]; data[j + 1] = data[i + 1]; data[j + 2] = data[i + 2]; queue[tail++] = q; }
    }
    if (x < w - 1) {
      const q = p + 1;
      if (!visible[q]) { visible[q] = 1; const j = q * 4; data[j] = data[i]; data[j + 1] = data[i + 1]; data[j + 2] = data[i + 2]; queue[tail++] = q; }
    }
    if (y > 0) {
      const q = p - w;
      if (!visible[q]) { visible[q] = 1; const j = q * 4; data[j] = data[i]; data[j + 1] = data[i + 1]; data[j + 2] = data[i + 2]; queue[tail++] = q; }
    }
    if (y < h - 1) {
      const q = p + w;
      if (!visible[q]) { visible[q] = 1; const j = q * 4; data[j] = data[i]; data[j + 1] = data[i + 1]; data[j + 2] = data[i + 2]; queue[tail++] = q; }
    }
  }
}

export const loadImgEl = (src) =>
  new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

/**
 * renderTargetToCanvas — read a WebGLRenderTarget's pixels back into a 2D
 * canvas, rows flipped (GL bottom-up → canvas top-down).
 */
export function renderTargetToCanvas(renderer, rt) {
  const w = rt.width;
  const h = rt.height;
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
