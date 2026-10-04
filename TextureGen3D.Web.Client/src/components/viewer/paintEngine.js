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
  const bindInpaintOverlay = (entry) => {
    currentMeshRef.current?.traverse((child) => {
      const u = child.isMesh && child.material && child.material.uniforms;
      if (u && u.u_inpaintMask) {
        u.u_inpaintMask.value = entry.front.texture;
        u.u_inpaintTile.value = inpaintTileTexRef.current;
        u.u_hasInpaint.value = inpaintVisibleRef.current ? 1 : 0;
      }
    });
  };

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

  const stampMaskAtHit = (layerIds, hit, signOverride = null) => {
    const cfg = maskPaintCfgRef.current?.current;
    const renderer = rendererRef.current;
    if (!cfg || !renderer || !layerIds?.length) return;
    const isInpaint = cfg.tool === 'inpaint';
    const rtt = getPaintRtt();

    const geom = hit.object.geometry;
    const pos = geom?.attributes?.position;
    const uvAttr = geom?.attributes?.uv;
    if (!pos || !uvAttr) return;

    const R = brushWorldRadius(hit);

    const h = cfg.hardness ?? 50;
    const u = rtt.mat.uniforms;
    u.u_modelMatrix.value.copy(hit.object.matrixWorld);
    u.u_mouseWorldPos.value.copy(hit.point);
    // Stamp: reveal the mask a bit past the color footprint so the mask
    // edge clears the stamped color's feather instead of cutting it.
    const mR = cfg.tool === 'stamp' ? R * 1.08 : R;
    u.u_brushRadius.value = mR;
    u.u_innerRadius.value = mR * Math.max(0, 1 - h / 100);
    u.u_brushStrength.value = Math.min(1, Math.max(0.01, ((cfg.opacity ?? 100) / 100) * pressureAlphaScale()));
    u.u_paintSign.value =
      signOverride ?? ((cfg.tool === 'mask' && cfg.maskSign === 'eraser') || (cfg.tool === 'inpaint' && cfg.sign === 'subtract') ? -1.0 : 1.0);
    u.u_isDrawing.value = 1.0;

    // Populate the paint group with every submesh's geometry so all UV
    // islands are rasterized each stamp — otherwise texels belonging to
    // submeshes we didn't hit keep the back buffer's stale values and
    // earlier strokes silently revert.
    populateMaskPaintGroup(rtt);
    const pg = rtt.paintGroup;
    pg.visible = true;
    rtt.blitQuad.visible = false;

    // Rebuild the island coverage map when the mesh changes — one rasterize
    // pass writing solid white wherever any submesh's triangles land.
    ensureMaskCoverage(rtt);

    // Paint pass per selected layer: read front → write back. autoClear is
    // OFF globally, so back is NOT cleared — blit the existing mask into it
    // first so every texel (inside AND outside islands) keeps its current
    // value, then the paint group adds the stroke on top. Purely additive.
    const bu = rtt.bleedMat.uniforms;
    const prevClear = tmpColor;
    renderer.getClearColor(prevClear);
    const prevClearAlpha = renderer.getClearAlpha();
    for (const layerId of layerIds) {
      const entry = isInpaint ? getInpaintEntry() : cfg.getOrCreateLayerMask?.(layerId);
      if (!entry) continue;
      if (!entry.initialized) clearMaskTarget(entry, isInpaint ? 0x000000 : 0xffffff);
      // Loaded before the mesh existed → run the deferred edge dilation now
      if (entry.needsDilate && dilateMaskEntry(rtt, entry)) entry.needsDilate = false;
      u.u_baseTexture.value = entry.front.texture;

      const back = entry.front === entry.a ? entry.b : entry.a;
      // 1) Blit prev → back (isDrawing=0 passthrough writes every texel)
      u.u_isDrawing.value = 0.0;
      rtt.paintGroup.visible = false;
      rtt.blitQuad.visible = true;
      renderer.setRenderTarget(back);
      renderer.render(rtt.scene, rtt.cam);
      // 2) Paint islands on top of the blit
      u.u_isDrawing.value = 1.0;
      rtt.blitQuad.visible = false;
      rtt.paintGroup.visible = true;
      renderer.render(rtt.scene, rtt.cam);

      // Bleed pass: back → front. Outside-island texels within 2px of an
      // island edge adopt the nearest inside-island mask value, so the mask
      // doesn't produce seam lines where a stroke crosses a UV boundary.
      bu.u_base.value = back.texture;
      bu.u_coverage.value = rtt.coverageRT.texture;
      bu.u_texelSize.value = 1 / 1024;
      rtt.paintGroup.visible = false;
      rtt.bleedQuad.visible = true;
      renderer.setRenderTarget(entry.front);
      renderer.render(rtt.scene, rtt.cam);
      rtt.bleedQuad.visible = false;
      rtt.paintGroup.visible = true;

      if (isInpaint) {
        // front.texture is updated in place — make sure it's bound (e.g. if
        // the entry was created by this first stroke before beginInpaint ran)
        bindInpaintOverlay(entry);
      } else {
        syncMaskUniform(layerId, entry.front.texture);
        cfg.markMaskModified?.(layerId);
      }
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevClearAlpha);
  };

  // Clone-stamp dab — screen-space clone: every destination texel projects
  // its world position through the capture-time camera and samples the
  // captured composite view at copy + flip*(texel − strokeStart). Writing
  // through the flattened-UV rasterization makes the stamp seam-safe — each
  // texel is found via the mesh's own UV mapping, so it doesn't matter how
  // the destination island is oriented or whether the stroke crosses seams.
  const stampUvmapAtHit = (layerIds, hit) => {
    const cfg = maskPaintCfgRef.current?.current;
    const renderer = rendererRef.current;
    const view = stampViewRef.current;
    if (!cfg || !renderer || !hit || !view) return;
    // Generated/inpainted layers are never stamp targets
    layerIds = layerIds.filter((lid) => cfg.isStampableLayer?.(lid) ?? true);
    if (!layerIds.length) return;

    // Populate the paint group with every submesh's geometry so all UV
    // islands are rasterized each stamp (same as the mask pass — skipping
    // islands would revert their paint on the next stamp).
    const rtt = getPaintRtt();
    populateMaskPaintGroup(rtt);
    const pg = rtt.paintGroup;
    pg.visible = true;
    rtt.blitQuad.visible = false;

    // Capture per-dab values — the async init callback may run after later
    // dabs have overwritten the shared uniforms.
    const R = brushWorldRadius(hit);
    const h = cfg.hardness ?? 50;
    const dabWorld = hit.point.clone();
    const modelMat = hit.object.matrixWorld.clone();
    const startWorld = paintingRef.current?.stampStartWorld || hit.point;
    const opacity = Math.min(1, Math.max(0.01, ((cfg.opacity ?? 100) / 100) * pressureAlphaScale()));
    const flipX = cfg.stampInvertX ? -1 : 1;
    const flipY = cfg.stampInvertY ? -1 : 1;
    const su = rtt.stampColorMat.uniforms;

    // Project the stroke start through the CURRENT camera so the stamp tracks
    // the cursor even if the user orbited after copying. Only the copy anchor
    // stays in capture-space pixels — the captured image behaves like a
    // floating screenshot (same semantics as the ring preview).
    const cam = cameraRef.current;
    if (!cam) return;
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
    const res = cfg.textureResolution || 1024;

    // Color-park margin in WORLD units, sized to cover ~6 UV texels at the
    // dab — derived from the hit triangle's local uv-per-world density so
    // it's a fixed number of texels at any zoom or UV density (a screen-px
    // margin shrinks below a texel when zoomed out → halo returns).
    let marginWorld = R * 0.1;
    const face = hit.face;
    const posAttr = hit.object.geometry?.attributes?.position;
    const hitUvAttr = hit.object.geometry?.attributes?.uv;
    if (face && posAttr && hitUvAttr) {
      const uvA = new THREE.Vector2().fromBufferAttribute(hitUvAttr, face.a);
      const uvB = new THREE.Vector2().fromBufferAttribute(hitUvAttr, face.b);
      const pA = new THREE.Vector3().fromBufferAttribute(posAttr, face.a).applyMatrix4(modelMat);
      const pB = new THREE.Vector3().fromBufferAttribute(posAttr, face.b).applyMatrix4(modelMat);
      const duv = uvA.distanceTo(uvB);
      if (duv > 1e-8) marginWorld = Math.max(marginWorld, (6 / res) * (pA.distanceTo(pB) / duv));
    }

    for (const layerId of layerIds) {
      ensureStampEntry(layerId, cfg).then((entry) => {
        if (!entry) return;
        // Rebuild island coverage when the mesh changes (needed by bleed)
        ensureMaskCoverage(rtt);
        su.u_baseTexture.value = entry.front.texture;
        su.u_srcTexture.value = view.rt.texture;
        su.u_modelMatrix.value.copy(modelMat);
        su.u_viewProj.value.copy(curVP);
        su.u_viewport.value.set(view.w, view.h);
        su.u_mouseWorldPos.value.copy(dabWorld);
        su.u_copyPx.value.copy(copyPx);
        su.u_startPx.value.copy(startPx);
        su.u_brushRadius.value = R;
        su.u_innerRadius.value = R * Math.max(0, 1 - h / 100);
        su.u_brushStrength.value = opacity;
        su.u_flip.value.set(flipX, flipY);
        su.u_zoomRatio.value = zoomRatio;
        su.u_marginWorld.value = marginWorld;
        pg.children.forEach((c) => { c.material = rtt.stampColorMat; });
        const back = entry.front === entry.a ? entry.b : entry.a;
        // Preserve current state in the write target first — autoClear is
        // off globally, so without this blit `back` keeps two-dabs-old
        // content and off-island texels (parked edge colors included)
        // alternate between stale states on each dab.
        rtt.copyMat.uniforms.u_tex.value = entry.front.texture;
        pg.visible = false;
        rtt.copyQuad.visible = true;
        renderer.setRenderTarget(back);
        renderer.render(rtt.scene, rtt.cam);
        rtt.copyQuad.visible = false;
        pg.visible = true;
        renderer.render(rtt.scene, rtt.cam);
        // Bleed stamped color ~2px beyond UV-island edges to hide seams
        const bs = rtt.bleedMat.uniforms;
        bs.u_base.value = back.texture;
        bs.u_coverage.value = rtt.coverageRT.texture;
        bs.u_texelSize.value = 1 / res;
        pg.visible = false;
        rtt.bleedQuad.material = rtt.bleedMat;
        rtt.bleedQuad.visible = true;
        renderer.setRenderTarget(entry.front);
        renderer.render(rtt.scene, rtt.cam);
        // Spread rgb into alpha-0 texels near content (6px per dab) so the
        // live-bound texture can't filter in transparent black — covers
        // island-boundary and source-empty texels the park ring misses.
        rtt.bleedQuad.visible = false;
        rtt.alphaFillQuad.visible = true;
        rtt.alphaFillMat.uniforms.u_texelSize.value = 1 / res;
        {
          let src = entry.front;
          let dst = back;
          for (let i = 0; i < 6; i++) {
            rtt.alphaFillMat.uniforms.u_base.value = src.texture;
            renderer.setRenderTarget(dst);
            renderer.render(rtt.scene, rtt.cam);
            const t = src; src = dst; dst = t;
          }
        }
        renderer.setRenderTarget(null);
        rtt.alphaFillQuad.visible = false;
        pg.visible = true;
        pg.children.forEach((c) => { c.material = rtt.mat; });
        stampTexRef.current.set(layerId, entry.front.texture);
        bindLayerTexture(layerId, entry.front.texture);
      });
    }
    // Reveal the stamped pixels through the layer mask
    stampMaskAtHit(layerIds, hit, 1);
  };

  // Color paint/erase dab — paints cfg.color into the selected layers'
  // uvmap (stamp RT) under the brush disc, or erases uvmap alpha when the
  // eraser tool is active. Same ping-pong sequence as the stamp dab:
  // blit front→back, paint through the flattened-UV rasterization, then
  // island-edge bleed + rgb alpha-fill.
  const paintColorAtHit = (layerIds, hit) => {
    const cfg = maskPaintCfgRef.current?.current;
    const renderer = rendererRef.current;
    if (!cfg || !renderer || !hit || !layerIds?.length) return;

    const rtt = getPaintRtt();
    populateMaskPaintGroup(rtt);
    const pg = rtt.paintGroup;
    pg.visible = true;
    rtt.blitQuad.visible = false;

    // Capture per-dab values — the async init callback may run after later
    // dabs have overwritten the shared uniforms.
    const R = brushWorldRadius(hit);
    const h = cfg.hardness ?? 50;
    const dabWorld = hit.point.clone();
    const modelMat = hit.object.matrixWorld.clone();
    const opacity = Math.min(1, Math.max(0.01, ((cfg.opacity ?? 100) / 100) * pressureAlphaScale()));
    const erase = cfg.tool === 'eraser' ? 1.0 : 0.0;
    // Parse the hex into raw sRGB components — Color.set() would convert to
    // linear working space and the RT would store ~2.2x darker bytes than
    // the color the user picked. setRGB defaults to working-space (raw).
    const m = /^#?([0-9a-fA-F]{6})$/.exec(cfg.color || '');
    tmpColor.setRGB(
      m ? parseInt(m[1].slice(0, 2), 16) / 255 : 1,
      m ? parseInt(m[1].slice(2, 4), 16) / 255 : 0,
      m ? parseInt(m[1].slice(4, 6), 16) / 255 : 0
    );
    const paintColor = tmpColor.clone();
    const res = cfg.textureResolution || 1024;

    for (const layerId of layerIds) {
      ensureStampEntry(layerId, cfg).then((entry) => {
        if (!entry) return;
        ensureMaskCoverage(rtt);
        const back = entry.front === entry.a ? entry.b : entry.a;

        // Preserve current state in the write target (off-island texels)
        pg.visible = false;
        rtt.copyMat.uniforms.u_tex.value = entry.front.texture;
        rtt.copyQuad.visible = true;
        renderer.setRenderTarget(back);
        renderer.render(rtt.scene, rtt.cam);
        rtt.copyQuad.visible = false;

        // Paint the color/erase dab through the flattened-UV rasterization
        const cu = rtt.colorPaintMat.uniforms;
        cu.u_baseTexture.value = entry.front.texture;
        cu.u_paintColor.value.copy(paintColor);
        cu.u_erase.value = erase;
        cu.u_modelMatrix.value.copy(modelMat);
        cu.u_mouseWorldPos.value.copy(dabWorld);
        cu.u_brushRadius.value = R;
        cu.u_innerRadius.value = R * Math.max(0, 1 - h / 100);
        cu.u_brushStrength.value = opacity;
        pg.children.forEach((c) => { c.material = rtt.colorPaintMat; });
        pg.visible = true;
        renderer.render(rtt.scene, rtt.cam);

        // Bleed island edges then spread rgb into alpha-0 texels near
        // content — same post passes the stamp dab runs.
        const bs = rtt.bleedMat.uniforms;
        bs.u_base.value = back.texture;
        bs.u_coverage.value = rtt.coverageRT.texture;
        bs.u_texelSize.value = 1 / res;
        pg.visible = false;
        rtt.bleedQuad.visible = true;
        renderer.setRenderTarget(entry.front);
        renderer.render(rtt.scene, rtt.cam);
        rtt.bleedQuad.visible = false;
        rtt.alphaFillQuad.visible = true;
        rtt.alphaFillMat.uniforms.u_texelSize.value = 1 / res;
        {
          let src = entry.front;
          let dst = back;
          for (let i = 0; i < 6; i++) {
            rtt.alphaFillMat.uniforms.u_base.value = src.texture;
            renderer.setRenderTarget(dst);
            renderer.render(rtt.scene, rtt.cam);
            const t = src; src = dst; dst = t;
          }
        }
        renderer.setRenderTarget(null);
        rtt.alphaFillQuad.visible = false;
        pg.visible = true;
        pg.children.forEach((c) => { c.material = rtt.mat; });
        stampTexRef.current.set(layerId, entry.front.texture);
        bindLayerTexture(layerId, entry.front.texture);
      });
    }
    // Painting reveals the painted pixels through the layer mask (same as
    // the stamp tool); erasing leaves the mask untouched.
    if (!erase) stampMaskAtHit(layerIds, hit, 1);
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

  // Blur dab — softens a layer's uvmap under the brush disc. Per dab:
  //   1) blur the layer's whole stamp RT into a scratch target
  //   2) blit front → back (preserve off-island texels)
  //   3) composite mix(front, blurred) into back through the flattened-UV
  //      rasterization, masked by the brush falloff × Strength
  //   4) island-edge bleed + rgb alpha-fill, same as the stamp pass
  const blurUvmapAtHit = (layerIds, hit) => {
    const cfg = maskPaintCfgRef.current?.current;
    const renderer = rendererRef.current;
    if (!cfg || !renderer || !hit || !layerIds?.length) return;

    const rtt = getPaintRtt();
    populateMaskPaintGroup(rtt);
    const pg = rtt.paintGroup;
    pg.visible = true;
    rtt.blitQuad.visible = false;

    const R = brushWorldRadius(hit);
    const h = cfg.hardness ?? 50;
    const dabWorld = hit.point.clone();
    const modelMat = hit.object.matrixWorld.clone();
    const strength = Math.min(1, Math.max(0.01, ((cfg.blurStrength ?? 50) / 100) * pressureAlphaScale()));
    const res = cfg.textureResolution || 1024;

    // Blur kernel radius in uvmap texels — derived from the hit triangle's
    // uv-per-world density so the blur footprint tracks the brush disc.
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
    const blurTexels = Math.min(96, Math.max(1.5,
      uvPerWorld > 0 ? R * uvPerWorld * res * 0.4 : res * 0.015));
    const scratch = getBlurScratch(res);

    for (const layerId of layerIds) {
      ensureStampEntry(layerId, cfg).then((entry) => {
        if (!entry) return;
        ensureMaskCoverage(rtt);
        const back = entry.front === entry.a ? entry.b : entry.a;

        // 1) Blur the whole texture: front → scratch
        pg.visible = false;
        rtt.blitQuad.visible = false;
        rtt.copyQuad.visible = false;
        rtt.bleedQuad.visible = false;
        rtt.alphaFillQuad.visible = false;
        const bu = rtt.blurMat.uniforms;
        bu.u_tex.value = entry.front.texture;
        bu.u_texelSize.value = 1 / res;
        bu.u_radiusPx.value = blurTexels;
        rtt.blurQuad.visible = true;
        renderer.setRenderTarget(scratch);
        renderer.render(rtt.scene, rtt.cam);
        rtt.blurQuad.visible = false;

        // 2) Preserve current state in the write target (off-island texels)
        rtt.copyMat.uniforms.u_tex.value = entry.front.texture;
        rtt.copyQuad.visible = true;
        renderer.setRenderTarget(back);
        renderer.render(rtt.scene, rtt.cam);
        rtt.copyQuad.visible = false;

        // 3) Composite the blur through the brush disc into back
        const mu = rtt.blurMixMat.uniforms;
        mu.u_baseTexture.value = entry.front.texture;
        mu.u_blurTexture.value = scratch.texture;
        mu.u_modelMatrix.value.copy(modelMat);
        mu.u_mouseWorldPos.value.copy(dabWorld);
        mu.u_brushRadius.value = R;
        mu.u_innerRadius.value = R * Math.max(0, 1 - h / 100);
        mu.u_brushStrength.value = strength;
        pg.children.forEach((c) => { c.material = rtt.blurMixMat; });
        pg.visible = true;
        renderer.render(rtt.scene, rtt.cam);

        // 4) Bleed island edges then spread rgb into alpha-0 texels near
        // content — same post passes the stamp dab runs.
        const bs = rtt.bleedMat.uniforms;
        bs.u_base.value = back.texture;
        bs.u_coverage.value = rtt.coverageRT.texture;
        bs.u_texelSize.value = 1 / res;
        pg.visible = false;
        rtt.bleedQuad.visible = true;
        renderer.setRenderTarget(entry.front);
        renderer.render(rtt.scene, rtt.cam);
        rtt.bleedQuad.visible = false;
        rtt.alphaFillQuad.visible = true;
        rtt.alphaFillMat.uniforms.u_texelSize.value = 1 / res;
        {
          let src = entry.front;
          let dst = back;
          for (let i = 0; i < 6; i++) {
            rtt.alphaFillMat.uniforms.u_base.value = src.texture;
            renderer.setRenderTarget(dst);
            renderer.render(rtt.scene, rtt.cam);
            const t = src; src = dst; dst = t;
          }
        }
        renderer.setRenderTarget(null);
        rtt.alphaFillQuad.visible = false;
        pg.visible = true;
        pg.children.forEach((c) => { c.material = rtt.mat; });
        stampTexRef.current.set(layerId, entry.front.texture);
        bindLayerTexture(layerId, entry.front.texture);
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
    getStampCanvasDataUrl,
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
