import * as THREE from 'three';
import { createPaintRtt } from './materials';
import { loadImgEl } from './viewerUtils';

/**
 * paintEngine — all UV-space painting state + GPU passes: mask ping-pong
 * buffers, clone-stamp ping-pong color targets, island coverage/bleed, the
 * inpaint overlay mask, raycasting helpers, and RT readback.
 *
 * createPaintEngine(ctx) — ctx is the shared viewer context object: the
 * component's refs plus late-bound helpers (getCanvasRect). Everything the
 * engine needs is read from refs at call time, so the engine survives mesh
 * swaps and shader rebuilds untouched.
 */
export function createPaintEngine(ctx) {
  const {
    rendererRef, cameraRef, currentMeshRef, raycasterRef,
    maskPaintCfgRef, paintingRef, stampViewRef,
    stampCanvasRef, stampRtRef, stampTexRef, stampLoadRef,
    paintRttRef, shaderLayerIdsRef,
    inpaintMaskRef, inpaintTileTexRef, inpaintActiveRef, inpaintVisibleRef,
    meshMapRtRef, meshMapTexRef, meshMapLoadRef, meshMapCanvasRef,
  } = ctx;

  // Pre-allocated temps shared by the raycast/brush helpers
  const tmpColor = new THREE.Color();
  const tmpVec = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const rayNdc = new THREE.Vector2();
  const faceNormal = new THREE.Vector3();

  const getPaintRtt = () => {
    if (!paintRttRef.current) paintRttRef.current = createPaintRtt();
    return paintRttRef.current;
  };

  // Initialize both ping-pong buffers to a solid color
  const clearMaskTarget = (entry, hex = 0xffffff) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(hex, 1);
    for (const rt of [entry.a, entry.b]) {
      renderer.setRenderTarget(rt);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevColor, prevAlpha);
    entry.initialized = true;
  };

  // Bind a texture as the inpaint overlay mask — used both for the live
  // stroke preview (back buffer) and the committed front buffer.
  const bindInpaintTexture = (tex) => {
    currentMeshRef.current?.traverse((child) => {
      const u = child.isMesh && child.material && child.material.uniforms;
      if (u && u.u_inpaintMask) {
        u.u_inpaintMask.value = tex;
        u.u_inpaintTile.value = inpaintTileTexRef.current;
        u.u_hasInpaint.value = inpaintVisibleRef.current ? 1 : 0;
      }
    });
  };

  // Populate the paint group with every submesh's geometry so all UV islands
  // are rasterized each pass — shared by the mask dab, the stamp color pass,
  // and the coverage rebuild.
  const populateMaskPaintGroup = (rtt) => {
    const geos = [];
    currentMeshRef.current?.traverse((child) => {
      if (child.isMesh && child.geometry?.attributes?.uv && child.geometry?.attributes?.position) {
        geos.push(child.geometry);
      }
    });
    const pg = rtt.paintGroup;
    while (pg.children.length < geos.length) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), rtt.mat);
      m.frustumCulled = false;
      pg.add(m);
    }
    pg.children.forEach((c, i) => {
      c.visible = i < geos.length;
      if (c.visible) c.geometry = geos[i];
    });
  };

  // Rasterize the island coverage map for the current mesh when stale —
  // solid white wherever any submesh's triangles land. Required by the
  // bleed/dilate pass (both painting and mask loads).
  const ensureMaskCoverage = (rtt) => {
    const renderer = rendererRef.current;
    if (!renderer || !currentMeshRef.current || rtt.coverageMesh === currentMeshRef.current) return;
    populateMaskPaintGroup(rtt);
    const pg = rtt.paintGroup;
    const prevVisible = pg.visible;
    const quadVis = [rtt.blitQuad.visible, rtt.bleedQuad.visible, rtt.copyQuad.visible];
    rtt.blitQuad.visible = false;
    rtt.bleedQuad.visible = false;
    rtt.copyQuad.visible = false;
    pg.visible = true;
    pg.children.forEach((c) => { c.material = rtt.coverageMat; });
    const pc = tmpColor;
    renderer.getClearColor(pc);
    const pa = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rtt.coverageRT);
    renderer.clear(true, false, false);
    renderer.render(rtt.scene, rtt.cam);
    renderer.setRenderTarget(null);
    renderer.setClearColor(pc, pa);
    pg.children.forEach((c) => { c.material = rtt.mat; });
    pg.visible = prevVisible;
    rtt.blitQuad.visible = quadVis[0];
    rtt.bleedQuad.visible = quadVis[1];
    rtt.copyQuad.visible = quadVis[2];
    rtt.coverageMesh = currentMeshRef.current;
  };

  // Push island-edge mask values into off-island texels so a saved mask
  // with black off-island regions doesn't darken filtered edge samples
  // along island borders (mask RTs use LinearFilter — no mipmaps, so a few
  // dilated texels is enough). Returns false when no mesh/coverage exists
  // yet so callers can retry later.
  const dilateMaskEntry = (rtt, entry, passes = 4) => {
    const renderer = rendererRef.current;
    if (!renderer || !currentMeshRef.current || !entry) return false;
    ensureMaskCoverage(rtt);
    if (rtt.coverageMesh !== currentMeshRef.current) return false;
    const bu = rtt.bleedMat.uniforms;
    const prevPg = rtt.paintGroup.visible;
    rtt.paintGroup.visible = false;
    rtt.blitQuad.visible = false;
    rtt.copyQuad.visible = false;
    rtt.bleedQuad.visible = true;
    let src = entry.front;
    let dst = entry.front === entry.a ? entry.b : entry.a;
    for (let i = 0; i < passes; i++) {
      bu.u_base.value = src.texture;
      bu.u_coverage.value = rtt.coverageRT.texture;
      bu.u_texelSize.value = 1 / entry.front.width;
      renderer.setRenderTarget(dst);
      renderer.render(rtt.scene, rtt.cam);
      const t = src;
      src = dst;
      dst = t;
    }
    rtt.bleedQuad.visible = false;
    rtt.paintGroup.visible = prevPg;
    renderer.setRenderTarget(null);
    return true;
  };

  // Push a mask's current front texture into the live layer shader
  const syncMaskUniform = (layerId, texture) => {
    const slot = shaderLayerIdsRef.current.indexOf(layerId);
    if (slot < 0) return;
    currentMeshRef.current?.traverse((child) => {
      const uniforms = child.isMesh && child.material && child.material.uniforms;
      if (uniforms && uniforms[`mask${slot}`]) {
        uniforms[`mask${slot}`].value = texture;
        uniforms[`hasMask${slot}`].value = 1;
      }
    });
  };

  // Push a stamped uvmap texture into the live layer shader's layerN slot
  const bindLayerTexture = (layerId, texture) => {
    const slot = shaderLayerIdsRef.current.indexOf(layerId);
    if (slot < 0) return;
    currentMeshRef.current?.traverse((child) => {
      const uniforms = child.isMesh && child.material && child.material.uniforms;
      if (uniforms && uniforms[`layer${slot}`]) uniforms[`layer${slot}`].value = texture;
    });
  };

  // The stamp tool paints into per-layer ping-pong color render targets in
  // uvmap space. Lazily created and seeded with the saved uvmap.png (or the
  // existing stamp canvas) if the layer has one; the front RT's texture is
  // bound into the live shader slot.
  const ensureStampEntry = (layerId, cfg) => {
    let p = stampLoadRef.current.get(layerId);
    if (p) return p;
    p = (async () => {
      const renderer = rendererRef.current;
      const res = cfg?.textureResolution || 1024;
      const mk = () => new THREE.WebGLRenderTarget(res, res, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
      });
      const entry = { a: mk(), b: mk() };
      entry.front = entry.a;
      stampRtRef.current.set(layerId, entry);

      const prevColor = renderer.getClearColor(new THREE.Color());
      const prevAlpha = renderer.getClearAlpha();
      try {
        const url = await cfg?.loadStampLayerImage?.(layerId);
        let tex = null;
        if (url) {
          try {
            const img = await loadImgEl(url);
            tex = new THREE.Texture(img);
            tex.flipY = true;
            tex.needsUpdate = true;
          } catch { /* start blank */ }
          URL.revokeObjectURL(url);
        }
        if (tex) {
          const rtt = getPaintRtt();
          rtt.paintGroup.visible = false;
          rtt.blitQuad.visible = false;
          rtt.copyQuad.visible = true;
          rtt.copyMat.uniforms.u_tex.value = tex;
          for (const rt of [entry.a, entry.b]) {
            renderer.setRenderTarget(rt);
            renderer.render(rtt.scene, rtt.cam);
          }
          rtt.copyQuad.visible = false;
          tex.dispose();
        } else {
          renderer.setClearColor(0x000000, 0);
          for (const rt of [entry.a, entry.b]) {
            renderer.setRenderTarget(rt);
            renderer.clear(true, true, false);
          }
        }
      } finally {
        renderer.setRenderTarget(null);
        renderer.setClearColor(prevColor, prevAlpha);
      }

      stampTexRef.current.set(layerId, entry.front.texture);
      bindLayerTexture(layerId, entry.front.texture);
      return entry;
    })();
    stampLoadRef.current.set(layerId, p);
    return p;
  };

  // ── Per-layer PBR maps — orm.png (roughness R / metallic B) + emissive.png
  // One ping-pong entry per (layerId, kind) — keyed `${layerId}|${kind}` —
  // mirroring the per-layer stamp entries. The carousel picks a paint
  // target per layer; targets resolve to the layer's two map files.
  // Map ALPHA is the has-data flag: files seed fully transparent (so a
  // layer with no painted map contributes nothing — lower layers' maps
  // show through), and every channel mask includes .w so strokes mark
  // coverage where they land. The layer's own mask still gates the map
  // in the compositor shader on top of that.
  const FULL_CHANNEL_MASK = new THREE.Vector4(1, 1, 1, 1);
  // orm targets include .g in the mask — coverage is split per channel:
  // G = roughness alpha, A = metallic alpha (a rough dab also floors A
  // so premultiplied PNG saves don't destroy R/G; a metal dab floors G
  // so metal-only texels stay distinguishable from pre-split files).
  const CHANNEL_MASKS = {
    rough: new THREE.Vector4(1, 1, 0, 1),
    metal: new THREE.Vector4(0, 1, 1, 1),
    emissive: new THREE.Vector4(1, 1, 1, 1),
  };
  const MAP_ORM_CHANNEL = { rough: 1, metal: 2, emissive: 0 };
  const MAP_KINDS = { rough: 'orm', metal: 'orm', emissive: 'emissive' };
  // Generated default rgb — written under every texel (visible or not) so
  // channel-masked strokes always see sane values in unwritten channels:
  // orm.png: rgb(255,0,0) = fully rough, non-metal; emissive.png: black.
  const MAP_DEFAULTS = {
    orm: new THREE.Color(1, 0, 0),
    emissive: new THREE.Color(0, 0, 0),
  };
  const layerMapKey = (layerId, kind) => `${layerId}|${kind}`;
  const ormUniform = (slot) => `orm${slot}`;
  const emisUniform = (slot) => `emis${slot}`;

  // Push a layer map's texture into its live shader slot (orm{s}/emis{s}).
  // Slots with no entry keep the default 1x1 textures the compositor
  // seeds — a layer without a map contributes defaults at its coverage.
  // Non-live layers (baked ops) have no slot; their maps reach the shader
  // through the bake's u_bakeOrm{s}/u_bakeEmis{s} textures instead.
  const mapBindWarned = new Set();
  const bindLayerMapTexture = (layerId, kind, tex) => {
    const slot = shaderLayerIdsRef.current.indexOf(layerId);
    if (slot < 0) {
      // Layer isn't a live slot right now (combined/baked shader) — the
      // data is still in the RT and reaches the next build via
      // meshMapTexRef. Warn once per layer+kind so we can see it.
      const k = `noslot:${layerId}|${kind}`;
      if (!mapBindWarned.has(k)) {
        mapBindWarned.add(k);
        console.warn(`[paint] map bind skipped — layer ${layerId} ${kind} has no live slot (shaderLayerIds:`, shaderLayerIdsRef.current, ')');
      }
      return;
    }
    const name = kind === 'orm' ? ormUniform(slot) : emisUniform(slot);
    let bound = false;
    currentMeshRef.current?.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        const u = m.uniforms;
        if (u && u[name]) { u[name].value = tex; bound = true; }
      }
    });
    if (!bound) {
      const k = `nouniform:${layerId}|${kind}`;
      if (!mapBindWarned.has(k)) {
        mapBindWarned.add(k);
        console.warn(`[paint] map bind skipped — no ${name} uniform on mesh materials (slot ${slot})`);
      }
    }
  };

  const ensureLayerMapEntry = (layerId, kind, cfg) => {
    cfg = cfg || maskPaintCfgRef.current?.current;
    const key = layerMapKey(layerId, kind);
    const existing = meshMapRtRef.current.get(key);
    if (existing) return Promise.resolve(existing);
    let p = meshMapLoadRef.current.get(key);
    if (p) return p;
    p = (async () => {
      const renderer = rendererRef.current;
      const res = cfg?.textureResolution || 1024;
      const mk = () => new THREE.WebGLRenderTarget(res, res, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
      });
      const entry = { a: mk(), b: mk() };
      entry.front = entry.a;
      meshMapRtRef.current.set(key, entry);

      const prevColor = renderer.getClearColor(new THREE.Color());
      const prevAlpha = renderer.getClearAlpha();
      try {
        const url = await cfg?.loadLayerMap?.(layerId, kind);
        let tex = null;
        if (url) {
          try {
            const img = await loadImgEl(url);
            tex = new THREE.Texture(img);
            tex.flipY = true;
            tex.needsUpdate = true;
          } catch { /* seed default */ }
        }
        const rtt = getPaintRtt();
        if (tex) {
          // Normalize while blitting (mode 8): the saved PNG has no rgb
          // under alpha=0, so restore the generated default rgb there —
          // a later channel-masked stroke must find rough=1/metal=0, not
          // premultiplied black.
          hideAllRtt(rtt);
          rtt.strokeCompQuad.visible = true;
          const su = rtt.strokeCompMat.uniforms;
          su.u_baseTexture.value = tex;
          su.u_mode.value = 8;
          su.u_paintColor.value.copy(MAP_DEFAULTS[kind]);
          su.u_channelMask.value.copy(FULL_CHANNEL_MASK);
          for (const rt of [entry.a, entry.b]) {
            renderer.setRenderTarget(rt);
            renderer.render(rtt.scene, rtt.cam);
          }
          rtt.strokeCompQuad.visible = false;
          su.u_mode.value = 0;
          tex.dispose();
        } else {
          // Generated file — fully transparent (alpha = has-data), with
          // the default rgb underneath so channel writes start sane:
          // orm: rgba(255,0,0,0); emissive: rgba(0,0,0,0).
          renderer.setClearColor(MAP_DEFAULTS[kind], 0);
          for (const rt of [entry.a, entry.b]) {
            renderer.setRenderTarget(rt);
            renderer.clear(true, true, false);
          }
        }
      } finally {
        renderer.setRenderTarget(null);
        renderer.setClearColor(prevColor, prevAlpha);
      }
      meshMapTexRef.current.set(key, entry.front.texture);
      bindLayerMapTexture(layerId, kind, entry.front.texture);
      return entry;
    })();
    // A rejected init must not sit in the cache forever — every later dab
    // awaiting it would silently no-op. Log + evict so the next dab retries.
    p.catch((err) => {
      console.error('Layer map init failed:', layerId, kind, err);
      meshMapLoadRef.current.delete(key);
    });
    meshMapLoadRef.current.set(key, p);
    return p;
  };

  // Layer-stack or mesh switch — the entries belong to the previous
  // selection's layers. Capture unsaved edits into the context stash
  // first so the debounced save can still upload them after the RTs are
  // gone.
  const resetLayerMaps = () => {
    const cfg = maskPaintCfgRef.current?.current;
    for (const key of meshMapRtRef.current.keys()) {
      const [layerId, kind] = key.split('|');
      if (cfg?.isLayerMapModified?.(layerId, kind)) {
        const dataUrl = getLayerMapDataUrl(layerId, kind);
        if (dataUrl) cfg?.stashLayerMap?.(layerId, kind, dataUrl);
      }
    }
    for (const entry of meshMapRtRef.current.values()) {
      entry.a.dispose();
      entry.b.dispose();
    }
    meshMapRtRef.current.clear();
    meshMapTexRef.current.clear();
    meshMapLoadRef.current.clear();
    meshMapCanvasRef.current.clear();
  };

  const getLayerMapDataUrl = (layerId, kind) => {
    const key = layerMapKey(layerId, kind);
    const entry = meshMapRtRef.current.get(key);
    const renderer = rendererRef.current;
    if (!entry || !renderer) return null;
    const res = entry.front.width;
    const buf = new Uint8Array(res * res * 4);
    renderer.readRenderTargetPixels(entry.front, 0, 0, res, res, buf);
    let canvas = meshMapCanvasRef.current.get(key);
    if (!canvas || canvas.width !== res) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = res;
      meshMapCanvasRef.current.set(key, canvas);
    }
    const c2 = canvas.getContext('2d');
    const img = c2.createImageData(res, res);
    for (let y = 0; y < res; y++) {
      img.data.set(buf.subarray((res - 1 - y) * res * 4, (res - y) * res * 4), y * res * 4);
    }
    c2.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };

  // Mesh-wide inpaint mask — same ping-pong pair as layer masks, but cleared
  // to black (0 = not marked) and never persisted.
  const getInpaintEntry = () => {
    let entry = inpaintMaskRef.current;
    if (!entry) {
      const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
      entry = {
        a: new THREE.WebGLRenderTarget(1024, 1024, opts),
        b: new THREE.WebGLRenderTarget(1024, 1024, opts),
        initialized: false,
      };
      entry.front = entry.a;
      inpaintMaskRef.current = entry;
    }
    return entry;
  };

  // Free the inpaint ping-pong buffers (mesh swap / unmount). Tool switches
  // keep them alive so re-selecting the inpaint tool restores the mask.
  const disposeInpaintEntry = () => {
    if (inpaintMaskRef.current) {
      inpaintMaskRef.current.a.dispose();
      inpaintMaskRef.current.b.dispose();
      inpaintMaskRef.current = null;
    }
  };

  // Bind the inpaint mask + tile texture into the live layer shader materials
  const bindInpaintOverlay = (entry) => bindInpaintTexture(entry.front.texture);

  // Pen pressure — pointer events carry 0..1 pressure only for stylus input;
  // mouse/touch report a fixed value, so those always paint full-strength.
  // cfg.penPressure maps pressure onto the dab radius ('size') or its
  // alpha/strength ('opacity'), scaled relative to that slider's value.
  const penPressureValue = () => {
    const cfg = maskPaintCfgRef.current?.current;
    if (!cfg?.penPressure) return 1;
    const p = paintingRef.current?.pressure;
    return p == null ? 1 : Math.min(1, Math.max(0, p));
  };
  // Each checked target scales independently — with both on, pressure
  // shrinks the dab radius AND dims its strength.
  const pressureSizeScale = () =>
    (maskPaintCfgRef.current?.current?.penPressureTargets || []).includes('size') ? penPressureValue() : 1;
  const pressureAlphaScale = () =>
    (maskPaintCfgRef.current?.current?.penPressureTargets || []).includes('opacity') ? penPressureValue() : 1;

  // Brush radius in world units — the Size slider is screen px, converted to
  // world units at the hit's depth so the painted circle matches the cursor
  // ring exactly, at any zoom.
  const brushWorldRadius = (hit) => {
    const cfg = maskPaintCfgRef.current?.current;
    const cam = cameraRef.current;
    const el = rendererRef.current?.domElement;
    if (!cfg || !cam || !el) return 0;
    const rPx = Math.max(0.5, ((cfg.size || 50) / 2) * pressureSizeScale());
    const rectH = ctx.getCanvasRect().height || 1;
    if (cam.isOrthographicCamera) {
      const worldH = (cam.top - cam.bottom) / (cam.zoom || 1);
      return rPx * (worldH / rectH);
    }
    // Perspective — visible world height at the hit's depth along the view axis
    cam.getWorldDirection(tmpDir);
    tmpVec.subVectors(hit.point, cam.position);
    const depth = Math.max(1e-6, tmpVec.dot(tmpDir));
    const worldH = 2 * depth * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
    return rPx * (worldH / rectH);
  };

  const raycastHitAt = (clientX, clientY) => {
    const mesh = currentMeshRef.current;
    const cam = cameraRef.current;
    if (!mesh || !cam) return null;
    const rect = ctx.getCanvasRect();
    rayNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycasterRef.current.setFromCamera(rayNdc, cam);
    const intersects = raycasterRef.current.intersectObject(mesh, true);
    const hit = intersects.length > 0 ? intersects[0] : null;
    if (!hit || !hit.uv || !hit.face) return null;
    // Reject backfaces — materials are DoubleSide so the raycaster can
    // return triangles facing away from the camera; those can't be painted
    faceNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (faceNormal.dot(raycasterRef.current.ray.direction) > 0) return null;
    return hit;
  };

  // Fallback when the center ray misses: sample points on the brush ring
  // circumference so strokes can start/continue where the ring overlaps
  // the mesh edge even though the cursor center is off the mesh. The hit
  // is re-centered on the cursor — we project the ring hit's depth back
  // along the center ray so the painted disc matches the ring's screen
  // footprint exactly instead of stamping a full circle at the edge.
  const raycastRingHitAt = (clientX, clientY) => {
    const cfg = maskPaintCfgRef.current?.current;
    const cam = cameraRef.current;
    if (!cam) return null;
    const rPx = Math.max(0.5, (cfg?.size || 50) / 2);
    const rect = ctx.getCanvasRect();
    const STEPS = 12;
    for (let i = 0; i < STEPS; i++) {
      const a = (i / STEPS) * Math.PI * 2;
      const hit = raycastHitAt(clientX + Math.cos(a) * rPx, clientY + Math.sin(a) * rPx);
      if (!hit) continue;

      // Center ray at the cursor (for ortho cams each ray has its own
      // origin — must recompute rather than reuse the ring hit's ray)
      rayNdc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycasterRef.current.setFromCamera(rayNdc, cam);
      const ray = raycasterRef.current.ray;
      const t = tmpVec.subVectors(hit.point, ray.origin).dot(ray.direction);
      const centerPoint = ray.direction.clone().multiplyScalar(t).add(ray.origin);
      return { ...hit, point: centerPoint };
    }
    return null;
  };

  // ── Stroke-mask pipeline ──────────────────────────────────────────────
  // Dabs no longer write straight into a layer's render target — at opacity
  // < 100 the overlapping discs visibly summed. Instead each dab accumulates
  // into a shared stroke buffer: .a = max coverage (falloff × pen-pressure
  // alpha — the opacity slider is deliberately excluded and applied once at
  // composite time), .rgb = the dab color (brush color, or the captured-view
  // sample for the stamp tool). Each dab then composites
  // base ∘ effect(stroke) into the layer's back buffer for the live preview
  // while front stays a pristine stroke-start snapshot; endStroke() re-runs
  // the same composite followed by the bleed/alpha-fill post passes into
  // front, making the result permanent and wiping the stroke buffer black.

  let strokeRts = null; // { a, b, front, res } — shared coverage buffer
  let stroke = null;    // { tool, layerIds, dirty, blurTexels }

  const getStrokeRts = (res) => {
    if (!strokeRts || strokeRts.res !== res) {
      if (strokeRts) { strokeRts.a.dispose(); strokeRts.b.dispose(); }
      const mk = () => new THREE.WebGLRenderTarget(res, res, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
      });
      strokeRts = { a: mk(), b: mk(), res };
      strokeRts.front = strokeRts.a;
    }
    return strokeRts;
  };

  // Erase the stroke buffer back to black — on stroke start and mouse-up.
  const clearStrokeRts = () => {
    const renderer = rendererRef.current;
    if (!renderer || !strokeRts) return;
    const pc = new THREE.Color();
    renderer.getClearColor(pc);
    const pa = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const rt of [strokeRts.a, strokeRts.b]) {
      renderer.setRenderTarget(rt);
      renderer.clear(true, true, false);
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(pc, pa);
  };

  // Begin the stroke if one isn't already running for this tool — commits a
  // stale stroke whose pointer-up never arrived as a defensive measure.
  const ensureStroke = (tool, layerIds) => {
    const cfg = maskPaintCfgRef.current?.current;
    getStrokeRts(cfg?.textureResolution || 1024);
    if (!stroke || stroke.tool !== tool) {
      if (stroke) endStroke();
      clearStrokeRts();
      stroke = { tool, layerIds: layerIds.slice(), dirty: false, blurTexels: 0 };
    }
    return stroke;
  };

  // Hide every helper object in the paint scene — each pass then flips on
  // exactly what it renders.
  const hideAllRtt = (rtt) => {
    rtt.paintGroup.visible = false;
    rtt.blitQuad.visible = false;
    rtt.bleedQuad.visible = false;
    rtt.copyQuad.visible = false;
    rtt.alphaFillQuad.visible = false;
    rtt.blurQuad.visible = false;
    rtt.strokeCompQuad.visible = false;
    rtt.fillCompQuad.visible = false;
  };

  // Parse cfg.color into raw sRGB components — Color.set() would convert to
  // linear working space and the RT would store ~2.2x darker bytes than the
  // color the user picked. setRGB defaults to working-space (raw).
  const parseBrushColor = () => {
    const cfg = maskPaintCfgRef.current?.current;
    const m = /^#?([0-9a-fA-F]{6})$/.exec(cfg?.color || '');
    return tmpColor.clone().setRGB(
      m ? parseInt(m[1].slice(0, 2), 16) / 255 : 1,
      m ? parseInt(m[1].slice(2, 4), 16) / 255 : 0,
      m ? parseInt(m[1].slice(4, 6), 16) / 255 : 0
    );
  };

  // Stamp source projection — projects the stroke start through the CURRENT
  // camera so the stamp tracks the cursor even if the user orbited after
  // copying. Only the copy anchor stays in capture-space pixels — the
  // captured image behaves like a floating screenshot.
  const stampViewUniforms = (hit) => {
    const view = stampViewRef.current;
    const cam = cameraRef.current;
    if (!view || !cam) return null;
    const startWorld = paintingRef.current?.stampStartWorld || hit.point;
    cam.updateMatrixWorld();
    const curVP = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const startNdc = startWorld.clone().applyMatrix4(curVP);
    const startPx = new THREE.Vector2(
      (startNdc.x * 0.5 + 0.5) * view.w,
      (startNdc.y * 0.5 + 0.5) * view.h
    );
    // Current px-per-world — probed along the camera's RIGHT vector so
    // rotation doesn't affect the measurement, only zoom/depth does.
    const curRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const probeNdc = startWorld.clone().addScaledVector(curRight, 0.01).applyMatrix4(curVP);
    const curNdcPerWorld = Math.hypot(probeNdc.x - startNdc.x, probeNdc.y - startNdc.y) / 0.01;
    const zoomRatio = curNdcPerWorld > 1e-8 ? (view.ndcPerWorld || curNdcPerWorld) / curNdcPerWorld : 1;
    // copyPx is stored y-down (canvas coords); the shader works in y-up px
    const copyPx = new THREE.Vector2(view.copyPx.x, view.h - view.copyPx.y);
    return { curVP, startPx, copyPx, zoomRatio };
  };

  // Rasterize one dab into the shared stroke buffer — copy prev → back for
  // off-island texels, then draw the disc on top through the flattened-UV
  // rasterization (max coverage; strongest dab at a texel owns the color).
  const strokeDab = (hit, stampMode) => {
    const cfg = maskPaintCfgRef.current?.current;
    const renderer = rendererRef.current;
    if (!cfg || !renderer || !stroke) return;
    const rtt = getPaintRtt();
    populateMaskPaintGroup(rtt);

    const R = brushWorldRadius(hit);
    const h = cfg.hardness ?? 50;
    const u = rtt.strokeDabMat.uniforms;
    u.u_baseTexture.value = strokeRts.front.texture;
    u.u_modelMatrix.value.copy(hit.object.matrixWorld);
    u.u_mouseWorldPos.value.copy(hit.point);
    u.u_brushRadius.value = R;
    u.u_innerRadius.value = R * Math.max(0, 1 - h / 100);
    u.u_alphaScale.value = pressureAlphaScale();
    u.u_stampMode.value = stampMode ? 1.0 : 0.0;
    u.u_paintColor.value.copy(parseBrushColor());
    if (stampMode) {
      const sv = stampViewUniforms(hit);
      const view = stampViewRef.current;
      if (!sv || !view) return;
      u.u_srcTexture.value = view.rt.texture;
      u.u_viewProj.value.copy(sv.curVP);
      u.u_viewport.value.set(view.w, view.h);
      u.u_copyPx.value.copy(sv.copyPx);
      u.u_startPx.value.copy(sv.startPx);
      u.u_flip.value.set(cfg.stampInvertX ? -1 : 1, cfg.stampInvertY ? -1 : 1);
      u.u_zoomRatio.value = sv.zoomRatio;
    }

    const back = strokeRts.front === strokeRts.a ? strokeRts.b : strokeRts.a;
    hideAllRtt(rtt);
    rtt.copyMat.uniforms.u_tex.value = strokeRts.front.texture;
    rtt.copyQuad.visible = true;
    renderer.setRenderTarget(back);
    renderer.render(rtt.scene, rtt.cam);
    rtt.copyQuad.visible = false;
    rtt.paintGroup.children.forEach((c) => { c.material = rtt.strokeDabMat; });
    rtt.paintGroup.visible = true;
    renderer.render(rtt.scene, rtt.cam);
    renderer.setRenderTarget(null);
    rtt.paintGroup.children.forEach((c) => { c.material = rtt.mat; });
    strokeRts.front = back;
    stroke.dirty = true;
  };

  // Composite base ∘ effect(stroke) into `entry`'s back buffer and return
  // its texture for live binding. `opacity` is the slider value — pen
  // pressure is already baked into the stroke buffer's alpha.
  const compositeStroke = (entry, mode, opacity, opts = {}) => {
    const renderer = rendererRef.current;
    const rtt = getPaintRtt();
    const back = entry.front === entry.a ? entry.b : entry.a;
    const cu = rtt.strokeCompMat.uniforms;
    cu.u_baseTexture.value = entry.front.texture;
    cu.u_stroke.value = strokeRts.front.texture;
    cu.u_mode.value = mode;
    cu.u_opacity.value = opacity;
    cu.u_channelMask.value.copy(opts.channelMask || FULL_CHANNEL_MASK);
    cu.u_ormChannel.value = opts.ormChannel || 0;
    if (opts.color) cu.u_paintColor.value.copy(opts.color);
    cu.u_blurTexture.value = opts.blurTex || null;
    hideAllRtt(rtt);
    rtt.strokeCompQuad.visible = true;
    renderer.setRenderTarget(back);
    renderer.render(rtt.scene, rtt.cam);
    renderer.setRenderTarget(null);
    rtt.strokeCompQuad.visible = false;
    return back.texture;
  };

  // Island-edge bleed back → front (shared by mask and uvmap commits).
  const bleedBackToFront = (rtt, entry) => {
    const renderer = rendererRef.current;
    const back = entry.front === entry.a ? entry.b : entry.a;
    const bu = rtt.bleedMat.uniforms;
    bu.u_base.value = back.texture;
    bu.u_coverage.value = rtt.coverageRT.texture;
    bu.u_texelSize.value = 1 / entry.front.width;
    hideAllRtt(rtt);
    rtt.bleedQuad.visible = true;
    renderer.setRenderTarget(entry.front);
    renderer.render(rtt.scene, rtt.cam);
    renderer.setRenderTarget(null);
    rtt.bleedQuad.visible = false;
  };

  // RGB spread into alpha-0 texels near content — 6 ping-pong passes,
  // ending with the result in front (same as the old per-dab post pass).
  const alphaFillFront = (rtt, entry) => {
    const renderer = rendererRef.current;
    rtt.alphaFillMat.uniforms.u_texelSize.value = 1 / entry.front.width;
    hideAllRtt(rtt);
    rtt.alphaFillQuad.visible = true;
    let src = entry.front;
    let dst = entry.front === entry.a ? entry.b : entry.a;
    for (let i = 0; i < 6; i++) {
      rtt.alphaFillMat.uniforms.u_base.value = src.texture;
      renderer.setRenderTarget(dst);
      renderer.render(rtt.scene, rtt.cam);
      const t = src; src = dst; dst = t;
    }
    rtt.alphaFillQuad.visible = false;
    renderer.setRenderTarget(null);
  };

  // Commit the accumulated stroke: re-run the composite into each target's
  // back buffer, then the usual bleed (+ alpha-fill for uvmaps) lands the
  // result in front, which gets rebound to the live shader and is what the
  // debounced saves read back. Then the stroke buffer is wiped to black.
  const endStroke = () => {
    const s = stroke;
    if (!s) return;
    stroke = null;
    const cfg = maskPaintCfgRef.current?.current;
    const renderer = rendererRef.current;
    const rtt = paintRttRef.current;
    const pending = [];
    if (s.dirty && cfg && renderer && rtt && strokeRts) {
      ensureMaskCoverage(rtt);
      const opacity = Math.min(1, Math.max(0.01, (cfg.opacity ?? 100) / 100));
      const strength = Math.min(1, Math.max(0.01, (cfg.blurStrength ?? 50) / 100));
      const paintColor = parseBrushColor();
      // Same luminance conversion as the per-dab path — the commit must
      // write what the preview showed.
      const lum = 0.2126 * paintColor.r + 0.7152 * paintColor.g + 0.0722 * paintColor.b;
      const channelColor = new THREE.Color(lum, lum, lum);
      for (const layerId of s.layerIds) {
        if (s.tool === 'mask' || s.tool === 'inpaint') {
          const isInpaint = s.tool === 'inpaint';
          const entry = isInpaint ? getInpaintEntry() : cfg.getOrCreateLayerMask?.(layerId);
          if (!entry) continue;
          if (!entry.initialized) clearMaskTarget(entry, isInpaint ? 0x000000 : 0xffffff);
          if (entry.needsDilate && dilateMaskEntry(rtt, entry)) entry.needsDilate = false;
          const subtract = isInpaint ? cfg.sign === 'subtract' : cfg.maskSign === 'eraser';
          compositeStroke(entry, subtract ? 3 : 2, opacity);
          bleedBackToFront(rtt, entry);
          const tex = entry.front.texture;
          if (isInpaint) bindInpaintTexture(tex);
          else { syncMaskUniform(layerId, tex); cfg.markMaskModified?.(layerId); }
        } else {
          // Layer-map target — commit into that layer's orm/emissive
          // entry, channel-masked so the stroke only writes its map's
          // channels.
          const target = cfg.getPaintMap?.(layerId) || 'base';
          if (target !== 'base') {
            const kind = MAP_KINDS[target];
            const key = layerMapKey(layerId, kind);
            const channelMask = CHANNEL_MASKS[target] || FULL_CHANNEL_MASK;
            pending.push(ensureLayerMapEntry(layerId, kind, cfg).then((entry) => {
              if (!entry) return;
              ensureMaskCoverage(rtt);
              let blurTex = null;
              // Mode 7 (map erase) resets rgb to the file defaults and
              // clears alpha — the texel carries no map data again.
              const mode = s.tool === 'eraser' ? 7 : s.tool === 'stamp' ? 4 : s.tool === 'blur' ? 5 : 0;
              if (s.tool === 'blur') blurTex = blurLayerIntoScratch(entry, s.blurTexels);
              compositeStroke(entry, mode, s.tool === 'blur' ? strength : opacity, {
                color: s.tool === 'eraser' ? MAP_DEFAULTS[kind] : (target === 'emissive' ? paintColor : channelColor),
                blurTex,
                channelMask: s.tool === 'eraser' ? FULL_CHANNEL_MASK : channelMask,
                ormChannel: MAP_ORM_CHANNEL[target] || 0,
              });
              bleedBackToFront(rtt, entry);
              alphaFillFront(rtt, entry);
              meshMapTexRef.current.set(key, entry.front.texture);
              bindLayerMapTexture(layerId, kind, entry.front.texture);
              cfg.markLayerMapModified?.(layerId, kind);
            }));
            continue;
          }
          // Stamp entries initialize asynchronously — commit inside the
          // promise so a stroke ending before first-init still lands.
          pending.push(ensureStampEntry(layerId, cfg).then((entry) => {
            if (!entry) return;
            ensureMaskCoverage(rtt);
            let blurTex = null;
            const mode = s.tool === 'eraser' ? 1 : s.tool === 'stamp' ? 4 : s.tool === 'blur' ? 5 : 0;
            if (s.tool === 'blur') blurTex = blurLayerIntoScratch(entry, s.blurTexels);
            compositeStroke(entry, mode, s.tool === 'blur' ? strength : opacity, { color: paintColor, blurTex });
            bleedBackToFront(rtt, entry);
            alphaFillFront(rtt, entry);
            stampTexRef.current.set(layerId, entry.front.texture);
            bindLayerTexture(layerId, entry.front.texture);
          }));
          if (s.tool === 'brush' || s.tool === 'stamp') {
            const maskEntry = cfg.getOrCreateLayerMask?.(layerId);
            if (maskEntry) {
              if (!maskEntry.initialized) clearMaskTarget(maskEntry, 0xffffff);
              if (maskEntry.needsDilate && dilateMaskEntry(rtt, maskEntry)) maskEntry.needsDilate = false;
              compositeStroke(maskEntry, 6, 1);
              bleedBackToFront(rtt, maskEntry);
              syncMaskUniform(layerId, maskEntry.front.texture);
              cfg.markMaskModified?.(layerId);
            }
          }
        }
      }
    }
    if (pending.length) {
      // Deferred commits still sample the stroke buffer — wipe once they land.
      Promise.all(pending).then(clearStrokeRts);
    } else {
      clearStrokeRts();
    }
  };

  // Mask/inpaint dab — accumulate the disc into the stroke buffer, then
  // composite onto each layer mask's (or the inpaint overlay's) snapshot
  // into its back buffer, which is bound to the live shader as a preview.
  const stampMaskAtHit = (layerIds, hit, signOverride = null) => {
    const cfg = maskPaintCfgRef.current?.current;
    const renderer = rendererRef.current;
    if (!cfg || !renderer || !layerIds?.length) return;
    const isInpaint = cfg.tool === 'inpaint';
    const rtt = getPaintRtt();
    ensureStroke(isInpaint ? 'inpaint' : 'mask', layerIds);
    strokeDab(hit, false);
    const sign =
      signOverride ?? ((cfg.tool === 'mask' && cfg.maskSign === 'eraser') || (isInpaint && cfg.sign === 'subtract') ? -1 : 1);
    const opacity = Math.min(1, Math.max(0.01, (cfg.opacity ?? 100) / 100));
    for (const layerId of layerIds) {
      const entry = isInpaint ? getInpaintEntry() : cfg.getOrCreateLayerMask?.(layerId);
      if (!entry) continue;
      if (!entry.initialized) clearMaskTarget(entry, isInpaint ? 0x000000 : 0xffffff);
      // Loaded before the mesh existed → run the deferred edge dilation now
      if (entry.needsDilate && dilateMaskEntry(rtt, entry)) entry.needsDilate = false;
      const tex = compositeStroke(entry, sign < 0 ? 3 : 2, opacity);
      if (isInpaint) {
        bindInpaintTexture(tex);
      } else {
        syncMaskUniform(layerId, tex);
        cfg.markMaskModified?.(layerId);
      }
    }
  };

  // Clone-stamp dab — screen-space clone: every destination texel projects
  // its world position through the capture-time camera and samples the
  // captured composite view at copy + flip*(texel − strokeStart). The dab
  // accumulates into the shared stroke buffer (coverage + sampled color),
  // then the per-layer composite previews the stroke over the layer's
  // stroke-start snapshot — overlapping dabs can't double-apply color or
  // opacity the way direct stamping did.
  const stampUvmapAtHit = (layerIds, hit) => {
    const cfg = maskPaintCfgRef.current?.current;
    const renderer = rendererRef.current;
    const view = stampViewRef.current;
    if (!cfg || !renderer || !hit || !view) return;
    // Generated/inpainted layers are never stamp targets
    layerIds = layerIds.filter((lid) => cfg.isStampableLayer?.(lid) ?? true);
    if (!layerIds.length) return;

    ensureStroke('stamp', layerIds);
    strokeDab(hit, true);
    const opacity = Math.min(1, Math.max(0.01, (cfg.opacity ?? 100) / 100));
    const rtt = getPaintRtt();
    for (const layerId of layerIds) {
      // Layer-map target — sample into the channel instead of the uvmap.
      const target = cfg.getPaintMap?.(layerId) || 'base';
      if (target !== 'base') {
        const kind = MAP_KINDS[target];
        const channelMask = CHANNEL_MASKS[target] || FULL_CHANNEL_MASK;
        ensureLayerMapEntry(layerId, kind, cfg).then((entry) => {
          if (!entry || !stroke || stroke.tool !== 'stamp') return;
          const tex = compositeStroke(entry, 4, opacity, { channelMask, ormChannel: MAP_ORM_CHANNEL[target] || 0 });
          meshMapTexRef.current.set(layerMapKey(layerId, kind), tex);
          bindLayerMapTexture(layerId, kind, tex);
          cfg.markLayerMapModified?.(layerId, kind);
        });
        continue;
      }
      ensureStampEntry(layerId, cfg).then((entry) => {
        if (!entry || !stroke || stroke.tool !== 'stamp') return;
        const tex = compositeStroke(entry, 4, opacity);
        bindLayerTexture(layerId, tex);
      });
      // Reveal the stamped pixels through the layer mask
      const maskEntry = cfg.getOrCreateLayerMask?.(layerId);
      if (maskEntry) {
        if (!maskEntry.initialized) clearMaskTarget(maskEntry, 0xffffff);
        if (maskEntry.needsDilate && dilateMaskEntry(rtt, maskEntry)) maskEntry.needsDilate = false;
        const mtex = compositeStroke(maskEntry, 6, 1);
        syncMaskUniform(layerId, mtex);
        cfg.markMaskModified?.(layerId);
      }
    }
  };

  // Color paint/erase dab — the disc accumulates into the shared stroke
  // buffer (color in .rgb, coverage in .a), then each layer composites
  // base ∘ paint/erase into its back buffer for the live preview. Because
  // the stroke buffer is a max-accumulated mask rather than summed alpha,
  // overlapping dabs at <100% opacity no longer show their overlap.
  const paintColorAtHit = (layerIds, hit) => {
    const cfg = maskPaintCfgRef.current?.current;
    const renderer = rendererRef.current;
    if (!cfg || !renderer || !hit || !layerIds?.length) return;

    const erase = cfg.tool === 'eraser';
    const rtt = getPaintRtt();
    ensureStroke(cfg.tool, layerIds);
    strokeDab(hit, false);
    const opacity = Math.min(1, Math.max(0.01, (cfg.opacity ?? 100) / 100));
    const paintColor = parseBrushColor();
    // Single-channel mesh maps (rough/metal) take the brush color's
    // luminance — same 709 weights as the fill path. Writing the raw
    // channel (e.g. R of a red brush → orm.R) leaves the value at ~1
    // so the stroke is invisible.
    const lum = 0.2126 * paintColor.r + 0.7152 * paintColor.g + 0.0722 * paintColor.b;
    const channelColor = new THREE.Color(lum, lum, lum);

    for (const layerId of layerIds) {
      // Layer-map target — brush writes the picked color into the
      // channel (mask includes alpha so the stroke marks coverage);
      // eraser (mode 7) resets rgb to the file defaults and clears
      // alpha so the texel carries no map data again.
      const target = cfg.getPaintMap?.(layerId) || 'base';
      if (target !== 'base') {
        const kind = MAP_KINDS[target];
        const channelMask = erase ? FULL_CHANNEL_MASK : (CHANNEL_MASKS[target] || FULL_CHANNEL_MASK);
        const strokeColor = erase ? MAP_DEFAULTS[kind] : (target === 'emissive' ? paintColor : channelColor);
        ensureLayerMapEntry(layerId, kind, cfg).then((entry) => {
          if (!entry || !stroke || (stroke.tool !== 'brush' && stroke.tool !== 'eraser')) return;
          const tex = compositeStroke(entry, erase ? 7 : 0, opacity, {
            color: strokeColor,
            channelMask,
            ormChannel: MAP_ORM_CHANNEL[target] || 0,
          });
          meshMapTexRef.current.set(layerMapKey(layerId, kind), tex);
          bindLayerMapTexture(layerId, kind, tex);
          cfg.markLayerMapModified?.(layerId, kind);
        });
        continue;
      }
      ensureStampEntry(layerId, cfg).then((entry) => {
        if (!entry || !stroke || (stroke.tool !== 'brush' && stroke.tool !== 'eraser')) return;
        const tex = compositeStroke(entry, erase ? 1 : 0, opacity, { color: paintColor });
        bindLayerTexture(layerId, tex);
      });
      // Painting reveals the painted pixels through the layer mask (same as
      // the stamp tool); erasing leaves the mask untouched.
      if (!erase) {
        const maskEntry = cfg.getOrCreateLayerMask?.(layerId);
        if (maskEntry) {
          if (!maskEntry.initialized) clearMaskTarget(maskEntry, 0xffffff);
          if (maskEntry.needsDilate && dilateMaskEntry(rtt, maskEntry)) maskEntry.needsDilate = false;
          const mtex = compositeStroke(maskEntry, 6, 1);
          syncMaskUniform(layerId, mtex);
          cfg.markMaskModified?.(layerId);
        }
      }
    }
  };

  // Scratch render target for the blur tool's whole-texture blur pass —
  // resized to the project's texture resolution on demand.
  let blurScratch = null;
  const getBlurScratch = (res) => {
    if (!blurScratch || blurScratch.width !== res) {
      blurScratch?.dispose();
      blurScratch = new THREE.WebGLRenderTarget(res, res, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
      });
    }
    return blurScratch;
  };

  // Blur a layer's stroke-start snapshot into the shared scratch RT —
  // 24-tap disc blur. Recomputed per composite; cheap relative to the old
  // per-dab whole-texture blur.
  const blurLayerIntoScratch = (entry, texels) => {
    const renderer = rendererRef.current;
    const rtt = getPaintRtt();
    const res = entry.front.width;
    const scratch = getBlurScratch(res);
    hideAllRtt(rtt);
    const bu = rtt.blurMat.uniforms;
    bu.u_tex.value = entry.front.texture;
    bu.u_texelSize.value = 1 / res;
    bu.u_radiusPx.value = texels;
    rtt.blurQuad.visible = true;
    renderer.setRenderTarget(scratch);
    renderer.render(rtt.scene, rtt.cam);
    renderer.setRenderTarget(null);
    rtt.blurQuad.visible = false;
    return scratch.texture;
  };

  // Blur dab — the disc accumulates into the shared stroke buffer, then
  // each layer previews mix(snapshot, blurred snapshot, stroke × Strength).
  // Blurring the immutable snapshot (not the accumulating buffer) is what
  // lets the blur tool share the stroke-mask pipeline — the effect applies
  // once per texel no matter how many dabs overlap.
  const blurUvmapAtHit = (layerIds, hit) => {
    const cfg = maskPaintCfgRef.current?.current;
    const renderer = rendererRef.current;
    if (!cfg || !renderer || !hit || !layerIds?.length) return;

    ensureStroke('blur', layerIds);
    strokeDab(hit, false);

    const R = brushWorldRadius(hit);
    const strength = Math.min(1, Math.max(0.01, (cfg.blurStrength ?? 50) / 100));
    const res = cfg.textureResolution || 1024;

    // Blur kernel radius in uvmap texels — derived from the hit triangle's
    // uv-per-world density so the blur footprint tracks the brush disc.
    const modelMat = hit.object.matrixWorld;
    let uvPerWorld = 0;
    const posAttr = hit.object.geometry?.attributes?.position;
    const uvAttr = hit.object.geometry?.attributes?.uv;
    if (hit.face && posAttr && uvAttr) {
      const uvA = new THREE.Vector2().fromBufferAttribute(uvAttr, hit.face.a);
      const uvB = new THREE.Vector2().fromBufferAttribute(uvAttr, hit.face.b);
      const pA = new THREE.Vector3().fromBufferAttribute(posAttr, hit.face.a).applyMatrix4(modelMat);
      const pB = new THREE.Vector3().fromBufferAttribute(posAttr, hit.face.b).applyMatrix4(modelMat);
      const dw = pA.distanceTo(pB);
      if (dw > 1e-8) uvPerWorld = uvA.distanceTo(uvB) / dw;
    }
    // ~40% of the brush radius; fallback ~1.5% of the map when the face
    // offers no usable density. Clamped so degenerate faces can't explode it.
    stroke.blurTexels = Math.min(96, Math.max(1.5,
      uvPerWorld > 0 ? R * uvPerWorld * res * 0.4 : res * 0.015));

    for (const layerId of layerIds) {
      // Layer-map target — blur the channel the same way, masked so
      // roughness blurs never smear the metallic channel (or vice versa).
      const target = cfg.getPaintMap?.(layerId) || 'base';
      if (target !== 'base') {
        const kind = MAP_KINDS[target];
        const channelMask = CHANNEL_MASKS[target] || FULL_CHANNEL_MASK;
        ensureLayerMapEntry(layerId, kind, cfg).then((entry) => {
          if (!entry || !stroke || stroke.tool !== 'blur') return;
          const blurTex = blurLayerIntoScratch(entry, stroke.blurTexels);
          const tex = compositeStroke(entry, 5, strength, { blurTex, channelMask, ormChannel: MAP_ORM_CHANNEL[target] || 0 });
          meshMapTexRef.current.set(layerMapKey(layerId, kind), tex);
          bindLayerMapTexture(layerId, kind, tex);
          cfg.markLayerMapModified?.(layerId, kind);
        });
        continue;
      }
      ensureStampEntry(layerId, cfg).then((entry) => {
        if (!entry || !stroke || stroke.tool !== 'blur') return;
        const blurTex = blurLayerIntoScratch(entry, stroke.blurTexels);
        const tex = compositeStroke(entry, 5, strength, { blurTex });
        bindLayerTexture(layerId, tex);
      });
    }
  };

  /**
   * The stamp tool's per-layer uvmap content as a PNG data URL — reads the
   * layer's stamp render target back into a canvas (row-flipped to PNG
   * top-down) so it can persist via saveUvMap when a stroke ends.
   */
  const getStampCanvasDataUrl = (layerId) => {
    const entry = stampRtRef.current.get(layerId);
    const renderer = rendererRef.current;
    if (!entry || !renderer) return null;
    const res = entry.front.width;
    const buf = new Uint8Array(res * res * 4);
    renderer.readRenderTargetPixels(entry.front, 0, 0, res, res, buf);
    let canvas = stampCanvasRef.current.get(layerId);
    if (!canvas || canvas.width !== res) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = res;
      stampCanvasRef.current.set(layerId, canvas);
    }
    const c2 = canvas.getContext('2d');
    const img = c2.createImageData(res, res);
    for (let y = 0; y < res; y++) {
      img.data.set(buf.subarray((res - 1 - y) * res * 4, (res - y) * res * 4), y * res * 4);
    }
    c2.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };

  /**
   * Drop a layer's stamp render targets/texture — call when its uvmap is
   * replaced externally (regenerate, inpaint, reproject) so the next stamp
   * re-seeds from the current uvmap.png instead of a stale buffer.
   */
  const invalidateStampCanvas = (layerId) => {
    stampCanvasRef.current.delete(layerId);
    stampLoadRef.current.delete(layerId);
    stampTexRef.current.delete(layerId);
    const entry = stampRtRef.current.get(layerId);
    if (entry) {
      stampRtRef.current.delete(layerId);
      entry.a.dispose();
      entry.b.dispose();
    }
  };

  /**
   * Upload a saved mask image into a layer mask's ping-pong buffers.
   * Blits the image through the paint material (isDrawing=0 → passthrough)
   * using the fullscreen quad so every texel is written.
   */
  const uploadMaskImage = (entry, bitmap) => {
    const renderer = rendererRef.current;
    const rtt = getPaintRtt();
    if (!renderer || !rtt || !entry) return;
    const tex = new THREE.Texture(bitmap);
    // Bitmap arrives already flipped (imageOrientation:'flipY' at decode) —
    // texture.flipY must stay false so it isn't flipped twice.
    tex.flipY = false;
    tex.needsUpdate = true;

    // Clear both buffers to white so pixels outside UV islands are visible
    clearMaskTarget(entry);

    const u = rtt.mat.uniforms;
    u.u_baseTexture.value = tex;
    u.u_isDrawing.value = 0.0;
    rtt.paintGroup.visible = false;
    rtt.bleedQuad.visible = false;
    rtt.blitQuad.visible = true;
    renderer.setRenderTarget(entry.front);
    renderer.render(rtt.scene, rtt.cam);
    renderer.setRenderTarget(null);
    rtt.blitQuad.visible = false;
    tex.dispose();
    // Off-island texels adopt island-edge values so old saved masks with
    // black off-island regions don't darken filtered edge samples. If the
    // mesh isn't loaded yet the dab path retries via entry.needsDilate.
    entry.needsDilate = !dilateMaskEntry(rtt, entry);
    // Mark initialized so the first paint stroke doesn't clear the
    // loaded mask back to white via clearMaskTarget.
    entry.initialized = true;
  };

  // 1-texel readback of a mask entry's front buffer at a UV point — returns
  // mask.r (0-255, white = visible). RT row 0 = v 0 (GL convention). Returns
  // null when no entry/renderer — caller treats that as fully visible.
  const sampleMaskAtUv = (entry, u, v) => {
    const renderer = rendererRef.current;
    if (!renderer || !entry?.front) return null;
    const w = entry.front.width;
    const h = entry.front.height;
    const x = Math.min(w - 1, Math.max(0, Math.round(u * (w - 1))));
    const y = Math.min(h - 1, Math.max(0, Math.round(v * (h - 1))));
    const buf = new Uint8Array(4);
    renderer.readRenderTargetPixels(entry.front, x, y, 1, 1, buf);
    return buf[0];
  };

  // Same for a layer's stamp render target — returns the RGBA texel at the
  // UV, or null when the layer has no stamp buffer (caller falls back to
  // the uvmap.png file contents).
  const sampleStampColorAtUv = (layerId, u, v) => {
    const renderer = rendererRef.current;
    const entry = stampRtRef.current.get(layerId);
    if (!renderer || !entry?.front) return null;
    const w = entry.front.width;
    const h = entry.front.height;
    const x = Math.min(w - 1, Math.max(0, Math.round(u * (w - 1))));
    const y = Math.min(h - 1, Math.max(0, Math.round(v * (h - 1))));
    const buf = new Uint8Array(4);
    renderer.readRenderTargetPixels(entry.front, x, y, 1, 1, buf);
    return buf;
  };

  // Alpha-only variant — used by the pointer pick's visibility gate.
  const sampleStampAtUv = (layerId, u, v) => {
    const texel = sampleStampColorAtUv(layerId, u, v);
    return texel ? texel[3] : null;
  };

  /**
   * Read back a layer mask's front buffer and return it as a PNG data URL
   * (rows flipped so png top = uv.y 1, matching the saved-mask convention).
   */
  const maskToDataURL = (entry) => {
    const renderer = rendererRef.current;
    if (!renderer || !entry?.front) return null;
    const w = entry.front.width;
    const h = entry.front.height;
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(entry.front, 0, 0, w, h, buf);
    // All-zero buffer means the readback silently failed (no framebuffer)
    let nonZero = false;
    for (let i = 0; i < buf.length; i += 4099) {
      if (buf[i] !== 0) { nonZero = true; break; }
    }
    if (!nonZero) {
      console.warn('[mask save] readback produced an empty buffer — mask may not be initialized');
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c2 = canvas.getContext('2d');
    const img = c2.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      img.data.set(buf.subarray(src, src + w * 4), y * w * 4);
    }
    c2.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };

  // Read back the inpaint tool's mask render target (UV space, white =
  // painted) as a PNG data URL — the same format as layer mask saves.
  const inpaintMaskToDataURL = () => {
    const entry = inpaintMaskRef.current;
    if (!entry) return null;
    return maskToDataURL(entry);
  };

  // Wipe a layer mask's ping-pong buffers back to pure white (fully
  // visible). Expects an entry from context's getOrCreateLayerMask.
  const clearLayerMask = (entry) => {
    if (!entry) return;
    clearMaskTarget(entry, 0xffffff);
  };

  // Clear the inpaint overlay mask back to empty (all black). No-op if the
  // inpaint tool was never activated on this mesh.
  const clearInpaintMask = () => {
    if (!inpaintMaskRef.current) return;
    clearMaskTarget(inpaintMaskRef.current, 0x000000);
  };

  // Load a mask bitmap (white = painted) into the inpaint overlay mask —
  // e.g. seeding the inpaint tool from a layer's saved mask.png. Decode
  // with imageOrientation:'flipY', same as uploadMaskImage's callers.
  const loadInpaintMask = (bitmap) => {
    if (!bitmap) return;
    uploadMaskImage(getInpaintEntry(), bitmap);
  };

  /**
   * Inpainting overlay — create a mesh-wide mask cleared to black, load the
   * repeating tile texture, and bind both into the layer shader so painted
   * regions show the tile pattern across all layers.
   */
  const beginInpaint = () => {
    // Preserve an existing mask — switching tools doesn't discard strokes
    const hadMask = !!inpaintMaskRef.current;
    const entry = getInpaintEntry();
    if (!hadMask) clearMaskTarget(entry, 0x000000);
    if (!inpaintTileTexRef.current) {
      const tex = new THREE.TextureLoader().load('/inpaint-tile.png');
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      inpaintTileTexRef.current = tex;
    }
    inpaintActiveRef.current = true;
    bindInpaintOverlay(entry);
  };

  // Remove the inpaint mask + tile from the shader. The GPU buffers stay
  // alive so the mask is restored when the tool is re-selected — they are
  // only freed on mesh swap / unmount.
  const endInpaint = () => {
    inpaintActiveRef.current = false;
    currentMeshRef.current?.traverse((child) => {
      const u = child.isMesh && child.material && child.material.uniforms;
      if (u && u.u_inpaintMask) {
        u.u_hasInpaint.value = 0;
        u.u_inpaintMask.value = null;
        u.u_inpaintTile.value = null;
      }
    });
  };

  // Show/hide the inpaint overlay without clearing the painted mask
  const setInpaintMaskVisible = (visible) => {
    inpaintVisibleRef.current = visible;
    currentMeshRef.current?.traverse((child) => {
      const u = child.isMesh && child.material && child.material.uniforms;
      if (u && u.u_hasInpaint) u.u_hasInpaint.value = inpaintActiveRef.current && visible ? 1 : 0;
    });
  };

  // Fill Layer — fills the layer's back buffer with a solid color and binds
  // it for live preview. front is left untouched until commit, so canceling
  // is just a rebind of the committed texture. fillSession makes the latest
  // preview win and lets cancel/commit drop previews still awaiting
  // ensureStampEntry.
  let fillSession = 0;
  const previewLayerFill = async (layerId, hex, alpha = 1) => {
    const cfg = maskPaintCfgRef.current?.current;
    const session = ++fillSession;
    const entry = await ensureStampEntry(layerId, cfg);
    const renderer = rendererRef.current;
    if (session !== fillSession || !entry || !renderer) return;
    const back = entry.front === entry.a ? entry.b : entry.a;
    const pc = renderer.getClearColor(new THREE.Color());
    const pa = renderer.getClearAlpha();
    // Raw byte values — new THREE.Color('#..') would convert sRGB→linear and
    // push dark fills under the layer shader's black=transparent threshold
    // (and darken every fill ~2.2x vs. the raw sRGB bytes textures store).
    const fillColor = new THREE.Color(
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255
    );
    renderer.setRenderTarget(back);
    renderer.setClearColor(fillColor, alpha);
    renderer.clear(true, true, false);
    renderer.setRenderTarget(null);
    renderer.setClearColor(pc, pa);
    bindLayerTexture(layerId, back.texture);
  };

  // Cancel the fill preview — rebind the committed front texture.
  const cancelLayerFill = (layerId) => {
    fillSession++;
    const entry = stampRtRef.current.get(layerId);
    if (entry) bindLayerTexture(layerId, entry.front.texture);
  };

  // Bake the previewed fill (already in back) into front permanently.
  const commitLayerFill = (layerId) => {
    fillSession++;
    const entry = stampRtRef.current.get(layerId);
    const renderer = rendererRef.current;
    if (!entry || !renderer) return;
    const back = entry.front === entry.a ? entry.b : entry.a;
    const rtt = getPaintRtt();
    rtt.paintGroup.visible = false;
    rtt.blitQuad.visible = false;
    rtt.copyQuad.visible = true;
    rtt.copyMat.uniforms.u_tex.value = back.texture;
    renderer.setRenderTarget(entry.front);
    renderer.render(rtt.scene, rtt.cam);
    renderer.setRenderTarget(null);
    rtt.copyQuad.visible = false;
    bindLayerTexture(layerId, entry.front.texture);
  };

  // Layer-map fill (Fill Roughness / Fill Metallic / Fill Emissive) —
  // same preview/commit/cancel pattern as previewLayerFill, but rendered
  // through fillCompMat so only the map's channels are written. `map` is
  // the carousel selection: 'rough' | 'metal' | 'emissive'.
  let mapFillSession = 0;
  const previewLayerMapFill = async (layerId, map, r, g, b, a = 1) => {
    const cfg = maskPaintCfgRef.current?.current;
    const session = ++mapFillSession;
    const kind = MAP_KINDS[map];
    if (!kind) return;
    const entry = await ensureLayerMapEntry(layerId, kind, cfg);
    const renderer = rendererRef.current;
    if (session !== mapFillSession || !entry || !renderer) return;
    const back = entry.front === entry.a ? entry.b : entry.a;
    const rtt = getPaintRtt();
    hideAllRtt(rtt);
    const fu = rtt.fillCompMat.uniforms;
    fu.u_baseTexture.value = entry.front.texture;
    fu.u_fill.value.set(r, g, b, a);
    fu.u_channelMask.value.copy(CHANNEL_MASKS[map] || FULL_CHANNEL_MASK);
    fu.u_ormChannel.value = MAP_ORM_CHANNEL[map] || 0;
    rtt.fillCompQuad.visible = true;
    renderer.setRenderTarget(back);
    renderer.render(rtt.scene, rtt.cam);
    renderer.setRenderTarget(null);
    rtt.fillCompQuad.visible = false;
    meshMapTexRef.current.set(layerMapKey(layerId, kind), back.texture);
    bindLayerMapTexture(layerId, kind, back.texture);
  };

  const cancelLayerMapFill = (layerId, map) => {
    mapFillSession++;
    const kind = MAP_KINDS[map];
    const entry = kind && meshMapRtRef.current.get(layerMapKey(layerId, kind));
    if (!entry) return;
    meshMapTexRef.current.set(layerMapKey(layerId, kind), entry.front.texture);
    bindLayerMapTexture(layerId, kind, entry.front.texture);
  };

  // Bake the previewed channel fill into front permanently. Returns the
  // layer-map kind ('orm' | 'emissive') so the caller can persist it.
  const commitLayerMapFill = (layerId, map) => {
    mapFillSession++;
    const kind = MAP_KINDS[map];
    const entry = kind && meshMapRtRef.current.get(layerMapKey(layerId, kind));
    const renderer = rendererRef.current;
    if (!entry || !renderer) return null;
    const back = entry.front === entry.a ? entry.b : entry.a;
    const rtt = getPaintRtt();
    hideAllRtt(rtt);
    rtt.copyQuad.visible = true;
    rtt.copyMat.uniforms.u_tex.value = back.texture;
    renderer.setRenderTarget(entry.front);
    renderer.render(rtt.scene, rtt.cam);
    renderer.setRenderTarget(null);
    rtt.copyQuad.visible = false;
    meshMapTexRef.current.set(layerMapKey(layerId, kind), entry.front.texture);
    bindLayerMapTexture(layerId, kind, entry.front.texture);
    return kind;
  };

  return {
    getPaintRtt,
    clearMaskTarget,
    populateMaskPaintGroup,
    ensureMaskCoverage,
    dilateMaskEntry,
    syncMaskUniform,
    bindLayerMask: syncMaskUniform, // imperative API name
    bindLayerTexture,
    ensureStampEntry,
    getInpaintEntry,
    disposeInpaintEntry,
    bindInpaintOverlay,
    brushWorldRadius,
    raycastHitAt,
    raycastRingHitAt,
    sampleMaskAtUv,
    sampleStampAtUv,
    sampleStampColorAtUv,
    stampMaskAtHit,
    stampUvmapAtHit,
    blurUvmapAtHit,
    paintColorAtHit,
    endStroke,
    getStampCanvasDataUrl,
    previewLayerFill,
    cancelLayerFill,
    commitLayerFill,
    ensureLayerMapEntry,
    resetLayerMaps,
    bindLayerMapTexture,
    getLayerMapDataUrl,
    previewLayerMapFill,
    cancelLayerMapFill,
    commitLayerMapFill,
    invalidateStampCanvas,
    uploadMaskImage,
    maskToDataURL,
    inpaintMaskToDataURL,
    clearLayerMask,
    clearInpaintMask,
    loadInpaintMask,
    beginInpaint,
    endInpaint,
    setInpaintMaskVisible,
  };
}
