import * as THREE from 'three';

/**
 * brushRing — the DOM cursor ring that tracks the pointer while a paint
 * tool is active: white outline at screen-space brush size, a circular
 * stamp-source preview inside it (clone-stamp draw mode), and a copy-mode
 * icon in the center.
 *
 * DOM writes are deferred to the animation loop via ringStateRef.dirty —
 * one style update per frame max, positioned via `transform` (compositor-
 * only). The element is created/destroyed by setActive() when maskTool
 * changes so it only exists while a paint tool is on.
 */
export function createBrushRing(ctx) {
  const {
    containerRef, rendererRef, cameraRef,
    ringStateRef, ringElRef, stampPreviewRef, stampCopyIconRef, pickerSwatchRef,
    maskPaintCfgRef, stampViewRef, paintingRef,
  } = ctx;

  // White 1px ring that tracks the cursor at a fixed screen-space size —
  // the Size slider value in px (the brush's world-space footprint varies
  // with UV density, so projecting it made the ring misleading).
  const hide = () => {
    const ringState = ringStateRef.current;
    if (ringState.visible) {
      ringState.visible = false;
      ringState.dirty = true;
    }
  };

  const hideStampPreview = () => {
    const pv = stampPreviewRef.current;
    if (pv && pv.style.display !== 'none') pv.style.display = 'none';
  };

  // Eyedropper swatch — a color circle anchored to the ring's bottom-right
  // corner showing the uvmap color sampled under the cursor. hex=null hides.
  const setPickColor = (hex) => {
    const sw = pickerSwatchRef.current;
    if (!sw) return;
    if (!hex) {
      if (sw.style.display !== 'none') sw.style.display = 'none';
      return;
    }
    if (sw.style.display !== 'block') sw.style.display = 'block';
    if (sw.dataset.hex !== hex) {
      sw.dataset.hex = hex;
      sw.style.background = hex;
    }
  };

  // Renders the captured-view region that would land at the cursor into a
  // canvas inside the brush ring. Screen-space clone: the crop center is
  // copyPx + flip*(mouse − strokeStart), matching the stamp shader exactly.
  // Invert flips the crop, opacity applies, and the hardness falloff
  // (alpha = 1 - smoothstep(innerFrac, 1, r)) shows the soft edge.
  const updateStampPreview = (e) => {
    const pv = stampPreviewRef.current;
    const cfg = maskPaintCfgRef.current?.current;
    const view = stampViewRef.current;
    if (!pv || !view?.canvas || !view.copyPx) {
      hideStampPreview();
      return;
    }
    pv.style.display = 'block';
    const px = Math.max(8, Math.round(cfg.size || 50));
    if (pv.width !== px) { pv.width = px; pv.height = px; }
    const c2 = pv.getContext('2d');
    c2.clearRect(0, 0, px, px);

    const rect = ctx.getCanvasRect();
    const scale = view.w / (rect.width || 1); // capture px per CSS px
    const mx = (e.clientX - rect.left) * scale;
    const my = (e.clientY - rect.top) * scale;
    const startPx = paintingRef.current?.stampStartPx || { x: mx, y: my };
    const fx = cfg.stampInvertX ? -1 : 1;
    const fy = cfg.stampInvertY ? -1 : 1;
    // Zoom compensation — the shader samples a zoom-ratio-scaled region of
    // the captured image, so the preview crop does the same.
    let zoomRatio = 1;
    const cam = cameraRef.current;
    if (cam && view.ndcPerWorld && view.centerWorld) {
      cam.updateMatrixWorld();
      const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
      const a = view.centerWorld.clone().applyMatrix4(vp);
      const b = view.centerWorld.clone().addScaledVector(right, 0.01).applyMatrix4(vp);
      const curNdc = Math.hypot(b.x - a.x, b.y - a.y) / 0.01;
      if (curNdc > 1e-8) zoomRatio = view.ndcPerWorld / curNdc;
    }
    const sx = view.copyPx.x + fx * (mx - startPx.x) * zoomRatio;
    const sy = view.copyPx.y + fy * (my - startPx.y) * zoomRatio;
    const rSrc = Math.max(1, (cfg.size || 50) / 2 * scale * zoomRatio); // ring radius in capture px

    c2.save();
    c2.beginPath();
    c2.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
    c2.clip();
    c2.globalAlpha = Math.min(1, Math.max(0.01, (cfg.opacity ?? 100) / 100)) * 0.85;
    if (cfg.stampInvertX || cfg.stampInvertY) {
      c2.translate(px / 2, px / 2);
      c2.scale(cfg.stampInvertX ? -1 : 1, cfg.stampInvertY ? -1 : 1);
      c2.drawImage(view.canvas, sx - rSrc, sy - rSrc, rSrc * 2, rSrc * 2, -px / 2, -px / 2, px, px);
    } else {
      c2.drawImage(view.canvas, sx - rSrc, sy - rSrc, rSrc * 2, rSrc * 2, 0, 0, px, px);
    }
    c2.restore();

    const h = cfg.hardness ?? 50;
    const innerFrac = Math.max(0, 1 - h / 100);
    if (innerFrac < 1) {
      const grad = c2.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
      const stops = 16;
      for (let i = 0; i <= stops; i++) {
        const t = i / stops;
        let a = 1;
        if (t > innerFrac) {
          const x = (t - innerFrac) / (1 - innerFrac);
          a = 1 - x * x * (3 - 2 * x); // 1 - smoothstep, same as shader
        }
        grad.addColorStop(t, `rgba(0,0,0,${a})`);
      }
      c2.globalCompositeOperation = 'destination-in';
      c2.fillStyle = grad;
      c2.fillRect(0, 0, px, px);
      c2.globalCompositeOperation = 'source-over';
    }
  };

  const update = (e) => {
    const el = rendererRef.current?.domElement;
    const cfg = maskPaintCfgRef.current?.current;
    if (!el || !cfg) {
      hide();
      return;
    }
    // pointermove is bound on window — when the pointer is over an overlay
    // (toolbar, panels, hints) e.target is that element, not the canvas.
    if (e.target !== el) {
      hide();
      return;
    }
    const rect = ctx.getCanvasRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      hide();
      return;
    }
    const ringState = ringStateRef.current;
    // Eyedropper mode — the ring becomes a point_scan icon: hide the border
    // and shrink the box so the swatch hugs the cursor.
    const picking = cfg.tool === 'brush' && !!cfg.brushPick;
    ringState.x = e.clientX - rect.left;
    ringState.y = e.clientY - rect.top;
    ringState.d = picking ? 28 : Math.max(2, cfg.size || 50);
    ringState.picker = picking;
    ringState.visible = true;
    ringState.dirty = true;
    el.style.cursor = 'none';
    // Stamp preview — show the captured region inside the ring in draw mode
    if (cfg.tool === 'stamp' && cfg.stampMode === 'draw' && stampViewRef.current) {
      updateStampPreview(e);
    } else {
      hideStampPreview();
    }
    // Center icon — copy mode for stamp, or the point_scan eyedropper while
    // the brush picker is active. cfg.stampMode is the effective mode, so
    // this covers both the toolbar selection and Alt-held-in-draw.
    const ic = stampCopyIconRef.current;
    if (ic) {
      const show = (cfg.tool === 'stamp' && cfg.stampMode === 'copy') || picking;
      if (ic.style.display !== (show ? 'block' : 'none')) ic.style.display = show ? 'block' : 'none';
    }
    // Eyedropper — while active, sample the uvmap color under the cursor
    // into the swatch at the ring's bottom-right corner.
    if (picking && cfg.sampleColor) {
      Promise.resolve(cfg.sampleColor(e.clientX, e.clientY)).then(setPickColor);
    } else {
      setPickColor(null);
    }
  };

  /**
   * Create/destroy the brush cursor ring — the project context calls this
   * when maskTool changes so the element only exists while a paint tool
   * (brush/eraser/inpaint/stamp) is active.
   */
  const setActive = (active) => {
    const container = containerRef.current;
    const ringState = ringStateRef.current;
    if (active && container && !ringElRef.current) {
      const el = document.createElement('div');
      el.className = 'absolute rounded-full border border-white pointer-events-none';
      // overflow stays visible — the stamp preview canvas clips itself with
      // border-radius, and the eyedropper swatch overhangs the ring edge.
      el.style.cssText = 'display:none;left:0;top:0;transform:translate(-50%,-50%);z-index:10;overflow:visible;';
      const pv = document.createElement('canvas');
      pv.style.cssText = 'display:none;position:absolute;inset:0;width:100%;height:100%;border-radius:50%;';
      el.appendChild(pv);
      // Copy-mode indicator — shown centered while the stamp tool is in
      // copy mode (selected, or Alt-held in draw mode). 2× the toolbar
      // icon size (14px → 28px).
      const ic = document.createElement('span');
      ic.className = 'material-symbols-rounded';
      ic.textContent = 'point_scan';
      ic.style.cssText = 'display:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:28px;line-height:1;color:#fff;text-shadow:0 0 3px rgba(0,0,0,0.9);';
      el.appendChild(ic);
      // Eyedropper swatch — 28px circle pinned just outside the ring's
      // bottom-right corner; shown only while the pick tool is sampling.
      const sw = document.createElement('div');
      sw.style.cssText = 'display:none;position:absolute;left:100%;top:100%;transform:translate(-40%,-40%);width:28px;height:28px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.9);';
      el.appendChild(sw);
      container.appendChild(el);
      ringElRef.current = el;
      stampPreviewRef.current = pv;
      stampCopyIconRef.current = ic;
      pickerSwatchRef.current = sw;
      ringState.appliedD = -1;
      ringState.appliedPicker = undefined;
      ringState.dirty = true;
    } else if (!active && ringElRef.current) {
      ringElRef.current.remove();
      ringElRef.current = null;
      stampPreviewRef.current = null;
      stampCopyIconRef.current = null;
      pickerSwatchRef.current = null;
      ringState.visible = false;
    }
  };

  // Flush pending DOM writes — called once per frame from the animate loop.
  const applyFrame = () => {
    const ringState = ringStateRef.current;
    if (!ringState.dirty) return;
    ringState.dirty = false;
    const ring = ringElRef.current;
    if (!ring) return;
    if (!ringState.visible) {
      if (ring.style.display !== 'none') ring.style.display = 'none';
    } else {
      if (ring.style.display !== 'block') ring.style.display = 'block';
      if (ringState.d !== ringState.appliedD) {
        ringState.appliedD = ringState.d;
        ring.style.width = `${ringState.d}px`;
        ring.style.height = `${ringState.d}px`;
      }
      if (ringState.picker !== ringState.appliedPicker) {
        ringState.appliedPicker = ringState.picker;
        ring.style.borderColor = ringState.picker ? 'transparent' : '';
      }
      ring.style.transform = `translate(${ringState.x}px, ${ringState.y}px) translate(-50%, -50%)`;
    }
  };

  return { setActive, update, hide, applyFrame, setPickColor };
}
