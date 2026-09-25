import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createThumbScene, disposeThumbScene, generateAngleThumbnail } from '@/helpers/camera-angle';
import Icon from '@/components/ui/icon';

/**
 * ModelViewer — full-screen Three.js canvas that renders the selected mesh.
 *
 * Includes an integrated 3D rotation gizmo anchored to the top-right corner:
 *   - Red ring   → drag to rotate the model around X
 *   - Green ring  → drag to rotate the model around Y
 *   - Blue ring   → drag to rotate the model around Z
 *   - White ring  → drag to orbit the camera (azimuth)
 *   - Space between rings → drag for free rotation of the model
 *
 * Props:
 *   selectedMesh — the mesh object from parseModel result (contains `.object`,
 *                  a live THREE.Mesh). When null, shows nothing.
 *
 * Ref methods (via forwardRef):
 *   captureThumbnail(size=75) — renders the current view to a data URL thumbnail
 *   getCameraRotation() — returns { x, y, z } rotation of the camera in degrees
 */

// Shared checkerboard texture for the grey material's backface pass —
// loaded lazily so it matches the layer shader's checker exactly.
let greyCheckerTex = null;
function getGreyCheckerTex() {
  if (!greyCheckerTex) {
    greyCheckerTex = new THREE.TextureLoader().load('/mesh-checkerboard.jpg');
    greyCheckerTex.wrapS = greyCheckerTex.wrapT = THREE.RepeatWrapping;
    greyCheckerTex.flipY = true;
  }
  return greyCheckerTex;
}

// Grey fallback mesh material — DoubleSide; backfaces render as the
// checkerboard texture (same as the layer shader) so polys facing away are
// unmistakable. userData.uDimBackface toggles it; captures set it to 0 so
// generated input images keep the undimmed color.
function makeGreyMeshMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9ca3af,
    metalness: 0.1,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  mat.userData.uDimBackface = { value: 1 };
  mat.defines = { USE_UV: '' }; // expose vUv for the checker sample
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.u_dimBackface = mat.userData.uDimBackface;
    shader.uniforms.u_backfaceChecker = { value: getGreyCheckerTex() };
    shader.fragmentShader = (
      'uniform float u_dimBackface;\nuniform sampler2D u_backfaceChecker;\n' + shader.fragmentShader
    ).replace(
      '#include <opaque_fragment>',
      'if (!gl_FrontFacing && u_dimBackface > 0.5) outgoingLight = texture2D(u_backfaceChecker, vUv * 64.0).rgb * 0.3;\n\t\t#include <opaque_fragment>'
    );
  };
  return mat;
}

const ModelViewer = forwardRef(function ModelViewer({ selectedMesh, onMeshLoaded, maskPaintConfig }, ref) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const currentMeshRef = useRef(null);
  const animationFrameRef = useRef(null);
  const ringElRef = useRef(null);
  const stampPreviewRef = useRef(null);  // canvas inside the ring — stamp source preview
  // Brush ring state — shared between the imperative setBrushRingActive()
  // (tool changes via project context), pointer handlers, and animate().
  const ringStateRef = useRef({ visible: false, x: 0, y: 0, d: 0, appliedD: -1, dirty: false });
  const gridRef = useRef(null);
  const orthoCameraRef = useRef(null);
  const onMeshLoadedRef = useRef(onMeshLoaded);
  useEffect(() => { onMeshLoadedRef.current = onMeshLoaded; });

  // Mask painting — maskPaintConfig is a stable ref object from project
  // context; maskPaintCfgRef.current.current holds the live config.
  const maskPaintCfgRef = useRef(maskPaintConfig);
  useEffect(() => { maskPaintCfgRef.current = maskPaintConfig; }, [maskPaintConfig]);
  const paintingRef = useRef(null);        // { layerId, lastX, lastY } during a stroke
  const stampViewRef = useRef(null);       // captured composite view { rt, canvas, w, h, viewProj, copyWorld, copyPx }
  const stampCopyUVRef = useRef(null);     // UV-space source point picked in copy mode
  const stampCanvasRef = useRef(new Map()); // layerId -> offscreen canvas (save scratchpad)
  const stampRtRef = useRef(new Map());     // layerId -> { a, b, front } ping-pong color RTs
  const stampTexRef = useRef(new Map());    // layerId -> texture currently bound in the shader
  const stampLoadRef = useRef(new Map());   // layerId -> in-flight RT init promise
  const emptyTexRef = useRef(null);         // 1x1 transparent dummy for url-less live slots
  const paintRttRef = useRef(null);        // lazily-built offscreen paint scene (RTT)
  const shaderLayerIdsRef = useRef([]);    // shader slot index -> layerId
  const whiteMaskTexRef = useRef(null);    // 1x1 white dummy for layers without a mask
  const layerBuildIdRef = useRef(0);       // stale-build guard for async compositing
  const perspCameraRef = useRef(null);

  // ── Mask painting helpers (GPU render-to-texture, ping-pong) ──
  // The mesh is rasterized flattened by its own UVs, so every fragment knows
  // the exact 3D world position of that texel — brush hits are evaluated by
  // world-space distance, which paints seamlessly across UV islands.
  const getPaintRtt = () => {
    if (paintRttRef.current) return paintRttRef.current;
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        u_baseTexture: { value: null },        // previous mask (front buffer)
        u_modelMatrix: { value: new THREE.Matrix4() },
        u_mouseWorldPos: { value: new THREE.Vector3() },
        u_brushRadius: { value: 0.1 },         // world units
        u_innerRadius: { value: 0.0 },         // fully-opaque core (hardness)
        u_brushStrength: { value: 1.0 },       // opacity 0..1
        u_paintSign: { value: 1.0 },           // +1 brush (white), -1 eraser (black)
        u_isDrawing: { value: 1.0 },
      },
      vertexShader: `
        uniform mat4 u_modelMatrix;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
          vUv = uv;
          vWorldPosition = (u_modelMatrix * vec4(position, 1.0)).xyz;
          // Flatten the mesh into texture space via its own UV coordinates
          gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D u_baseTexture;
        uniform vec3 u_mouseWorldPos;
        uniform float u_brushRadius;
        uniform float u_innerRadius;
        uniform float u_brushStrength;
        uniform float u_paintSign;
        uniform float u_isDrawing;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
          float prev = texture2D(u_baseTexture, vUv).r;
          float paint = 0.0;
          if (u_isDrawing > 0.5) {
            float d = distance(vWorldPosition, u_mouseWorldPos);
            if (u_innerRadius >= u_brushRadius - 1e-6) {
              paint = d < u_brushRadius ? 1.0 : 0.0;
            } else {
              paint = 1.0 - smoothstep(u_innerRadius, u_brushRadius, d);
            }
            paint *= u_brushStrength;
          }
          float m = clamp(prev + paint * u_paintSign, 0.0, 1.0);
          gl_FragColor = vec4(m, m, m, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending, // output fully replaces the target pixel
    });
    // Group of meshes flattened by UV — children are populated per-stamp with
    // EVERY submesh's geometry so all UV islands are written each pass (the
    // ping-pong buffers only stay consistent if every stamp covers the same
    // texels; painting just the hit submesh would revert other islands' paint).
    const paintGroup = new THREE.Group();
    paintGroup.visible = false;
    // Fullscreen quad — used to blit saved mask images into a target
    const blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    blitQuad.frustumCulled = false;
    blitQuad.visible = false;

    // Solid-white material for rasterizing the UV island coverage map
    const coverageMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
        }
      `,
      fragmentShader: `void main() { gl_FragColor = vec4(1.0); }`,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    // Island coverage target: r=1 inside a UV island, 0 outside
    const coverageRT = new THREE.WebGLRenderTarget(1024, 1024, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });

    // Bleed pass: outside-island texels adopt the nearest inside-island mask
    // value within 2px — prevents seam lines at UV island edges.
    const bleedMat = new THREE.ShaderMaterial({
      uniforms: {
        u_base: { value: null },
        u_coverage: { value: null },
        u_texelSize: { value: 1 / 1024 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D u_base;
        uniform sampler2D u_coverage;
        uniform float u_texelSize;
        varying vec2 vUv;
        void main() {
          vec4 self = texture2D(u_base, vUv);
          if (texture2D(u_coverage, vUv).r > 0.5) { gl_FragColor = self; return; }
          vec2 texel = vec2(u_texelSize);
          vec4 best = self;
          float bestD = 3.0;
          for (int dy = -2; dy <= 2; dy++)
          for (int dx = -2; dx <= 2; dx++) {
            if (dx == 0 && dy == 0) continue;
            float d = max(abs(float(dx)), abs(float(dy)));
            if (d >= bestD) continue;
            vec2 nuv = vUv + vec2(float(dx), float(dy)) * texel;
            if (texture2D(u_coverage, nuv).r > 0.5) {
              bestD = d;
              best = texture2D(u_base, nuv);
            }
          }
          gl_FragColor = best;
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const bleedQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bleedMat);
    bleedQuad.frustumCulled = false;
    bleedQuad.visible = false;

    // Fullscreen texture copy — seeds a layer's stamp RT from its uvmap image
    const copyMat = new THREE.ShaderMaterial({
      uniforms: { u_tex: { value: null } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D u_tex;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(u_tex, vUv); }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat);
    copyQuad.frustumCulled = false;
    copyQuad.visible = false;

    // Clone-stamp material — for every flattened-UV texel, project its world
    // position through the CURRENT camera, offset by (copy − strokeStart) in
    // screen px, and sample the captured composite view like a floating image.
    // Sampling the projected view (not the uvmap) is what makes the stamp
    // match what's on the mesh across UV seams/islands.
    const stampColorMat = new THREE.ShaderMaterial({
      uniforms: {
        u_baseTexture: { value: null },        // layer's previous uvmap (front RT)
        u_srcTexture: { value: null },         // captured composite view RT
        u_modelMatrix: { value: new THREE.Matrix4() },
        u_viewProj: { value: new THREE.Matrix4() },   // current camera VP
        u_viewport: { value: new THREE.Vector2(1, 1) }, // capture buffer px
        u_mouseWorldPos: { value: new THREE.Vector3() }, // dab center
        u_copyPx: { value: new THREE.Vector2() },     // copy pt, capture px (y-up)
        u_startPx: { value: new THREE.Vector2() },    // stroke start, current px (y-up)
        u_brushRadius: { value: 0.1 },         // world units
        u_innerRadius: { value: 0.0 },         // hardness core
        u_brushStrength: { value: 1.0 },       // opacity
        u_flip: { value: new THREE.Vector2(1, 1) },    // -1 per axis = invert
        u_zoomRatio: { value: 1.0 },           // capture px-per-world / current px-per-world
      },
      vertexShader: `
        uniform mat4 u_modelMatrix;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
          vUv = uv;
          vWorldPosition = (u_modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D u_baseTexture;
        uniform sampler2D u_srcTexture;
        uniform mat4 u_viewProj;
        uniform vec2 u_viewport;
        uniform vec3 u_mouseWorldPos;
        uniform vec2 u_copyPx;
        uniform vec2 u_startPx;
        uniform float u_brushRadius;
        uniform float u_innerRadius;
        uniform float u_brushStrength;
        uniform vec2 u_flip;
        uniform float u_zoomRatio;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        vec2 scrPx(vec3 w) {
          vec4 c = u_viewProj * vec4(w, 1.0);
          return (c.xy / c.w * 0.5 + 0.5) * u_viewport;
        }
        void main() {
          vec4 prev = texture2D(u_baseTexture, vUv);
          float d = distance(vWorldPosition, u_mouseWorldPos);
          float paint = 0.0;
          if (u_innerRadius >= u_brushRadius - 1e-6) {
            paint = d < u_brushRadius ? 1.0 : 0.0;
          } else {
            paint = 1.0 - smoothstep(u_innerRadius, u_brushRadius, d);
          }
          paint *= u_brushStrength;
          vec2 srcPx = u_copyPx + u_flip * (scrPx(vWorldPosition) - u_startPx) * u_zoomRatio;
          vec4 src = texture2D(u_srcTexture, srcPx / u_viewport);
          // Source-over composite: the brush falloff lives in ALPHA only.
          // Mixing rgb toward prev.rgb would darken feathered edges over
          // transparent texels (prev is black there) → visible dark border.
          float srcA = paint * src.a; // don't stamp where the view shows no mesh
          float outA = srcA + prev.a * (1.0 - srcA);
          vec3 outRgb = (src.rgb * srcA + prev.rgb * prev.a * (1.0 - srcA)) / max(outA, 1e-5);
          gl_FragColor = vec4(outRgb, outA);
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    scene.add(paintGroup, blitQuad, bleedQuad, copyQuad);
    paintRttRef.current = {
      scene, cam, mat, paintGroup, blitQuad,
      coverageMat, coverageRT, coverageMesh: null,
      bleedMat, bleedQuad,
      copyMat, copyQuad, stampColorMat,
    };
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

  // Eye toggle on the light gizmo — u_unlit bypasses the layer shader's
  // shadow term; the scene's directional lights are also zeroed so the grey
  // MeshStandardMaterial fallback renders flat too.
  const toggleUnlit = () => {
    const next = !unlitRef.current;
    unlitRef.current = next;
    setUnlit(next);
    currentMeshRef.current?.traverse((child) => {
      const u = child.isMesh && child.material && child.material.uniforms;
      if (u && u.u_unlit) u.u_unlit.value = next ? 1 : 0;
    });
    if (dirLight1Ref.current) dirLight1Ref.current.intensity = next ? 0 : 1.0;
    if (dirLight2Ref.current) dirLight2Ref.current.intensity = next ? 0 : 0.5;
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

  // Render the composite as the user currently sees it into a persistent RT —
  // unlit, front-side only, transparent background (alpha=0 marks "no mesh"
  // so the stamp shader won't copy empty space). Keeps the RT texture for the
  // GPU stamp pass and a row-flipped canvas copy for the ring preview.
  const captureStampView = () => {
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    const mesh = currentMeshRef.current;
    if (!renderer || !cam || !mesh) return null;
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    if (!w || !h) return null;

    const mats = [];
    mesh.traverse((c) => {
      if (c.isMesh && c.material) {
        (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => mats.push(m));
      }
    });
    mats.forEach((m) => {
      if (m.uniforms?.u_unlit) m.uniforms.u_unlit.value = 1;
      if (m.uniforms?.u_hasInpaint) m.uniforms.u_hasInpaint.value = 0;
      if (m.uniforms?.u_dimBackface) m.uniforms.u_dimBackface.value = 0;
      if (m.userData?.uDimBackface) m.userData.uDimBackface.value = 0;
      m.userData._stampCapSide = m.side;
      m.side = THREE.FrontSide;
    });

    const rt = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    // Hide non-mesh scene objects (grid etc.) so they don't get stamped
    const grid = sceneRef.current?.getObjectByName('__grid');
    const gridWasVisible = grid?.visible;
    if (grid) grid.visible = false;
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const buf = new Uint8Array(w * h * 4);
    let canvas = null;
    try {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(sceneRef.current, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      }
      ctx.putImageData(img, 0, 0);
    } finally {
      if (grid) grid.visible = gridWasVisible;
      renderer.setRenderTarget(null);
      renderer.setClearColor(prevColor, prevAlpha);
      mats.forEach((m) => {
        if (m.uniforms?.u_unlit) m.uniforms.u_unlit.value = unlitRef.current ? 1 : 0;
        if (m.uniforms?.u_hasInpaint) m.uniforms.u_hasInpaint.value = inpaintActiveRef.current && inpaintVisibleRef.current ? 1 : 0;
        if (m.uniforms?.u_dimBackface) m.uniforms.u_dimBackface.value = 1;
        if (m.userData?.uDimBackface) m.userData.uDimBackface.value = 1;
        if (m.userData._stampCapSide !== undefined) {
          m.side = m.userData._stampCapSide;
          delete m.userData._stampCapSide;
        }
      });
    }
    const viewProj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    // Screen-px-per-world-unit at capture time — lets the stamp shader rescale
    // the screen-space delta when the user zooms between copy and draw. The
    // probe offsets along the camera's RIGHT vector (screen-aligned), so mesh
    // rotation doesn't foreshorten the measurement — only zoom/depth changes it.
    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    const p0 = center.clone().applyMatrix4(viewProj);
    const p1 = center.clone().addScaledVector(right, 0.01).applyMatrix4(viewProj);
    const ndcPerWorld = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 0.01;
    return { rt, canvas, w, h, viewProj, ndcPerWorld, centerWorld: center };
  };

  // ── CPU layer compositing ──
  // Bakes a set of layers into a single image so the shader only needs a
  // couple of sampler2D slots regardless of the layer count.

  const loadImgEl = (src) =>
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });

  // Composite items (ordered top→bottom) onto a canvas, matching the layer
  // shader's semantics: mask.r lerps the uvmap alpha (white = visible) and
  // near-black rgb is treated as empty (contentMask = step(0.01, length(rgb))).
  const compositeLayerImages = async (items) => {
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
      for (let p = 0; p < d.length; p += 4) {
        const r = d[p], g = d[p + 1], b = d[p + 2];
        // Near-black cull only applies to mask-less layers — when a mask is
        // present it alone defines visibility (same as the live shader's
        // cm = hasMask ? 1 : step). Culling masked dark content opens holes
        // that read as a dark fringe around the mask boundary.
        if (!md && r * r + g * g + b * b < 7) {
          d[p + 3] = 0;
        } else if (md) {
          d[p + 3] = Math.round((d[p + 3] * md[p]) / 255);
        }
      }
      tctx.putImageData(imgData, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    }

    // Dilate edge colors ~3px into transparent areas. Masked-out texels keep
    // their (usually dark) rgb — mipmapped sampling then blends that hidden
    // dark rgb into visible edge texels, producing a dark fringe around the
    // mask boundary. Filling transparent texels with the nearest visible
    // color makes mip levels fade to the edge color instead.
    const cd = ctx.getImageData(0, 0, w, h);
    const cdData = cd.data;
    const filled = new Uint8Array(w * h);
    for (let pass = 0; pass < 3; pass++) {
      const src = cdData.slice();
      const filledPrev = filled.slice();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (src[i + 3] !== 0 || filledPrev[y * w + x]) continue;
          let r = 0, g = 0, b = 0, n = 0;
          for (let k = 0; k < 4; k++) {
            const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = (ny * w + nx) * 4;
            if (src[j + 3] > 0 || filledPrev[ny * w + nx]) {
              r += src[j]; g += src[j + 1]; b += src[j + 2]; n++;
            }
          }
          if (n) {
            cdData[i] = r / n;
            cdData[i + 1] = g / n;
            cdData[i + 2] = b / n;
            filled[y * w + x] = 1;
          }
        }
      }
    }
    ctx.putImageData(cd, 0, 0);
    return canvas;
  };

  // Upload a composited canvas as a THREE texture (tracked for disposal).
  // flipY=true matches the uvmap textures — canvas row 0 is v=1.
  const canvasToLayerTexture = async (canvas) => {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.flipY = true;
    return { tex, url };
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

  // Gizmo refs
  const gizmoSceneRef = useRef(null);       // axis scene (synced camera)
  const gizmoRingSceneRef = useRef(null);  // ring scene (fixed camera)
  const gizmoCameraRef = useRef(null);
  const gizmoRingCameraRef = useRef(null);
  const gizmoRingsRef = useRef([]); // axis cones
  const gizmoAxisLinesRef = useRef([]); // axis lines
  const gizmoPickArrayRef = useRef([]); // pre-built combined array for picking
  const gizmoOrbitRingRef = useRef(null);
  const gizmoFreeSphereRef = useRef(null);
  const gizmoSizeRef = useRef(140);
  const gizmoInteractionRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const hoveredRingRef = useRef(null);

  // Lighting gizmo refs
  const lightGizmoSceneRef = useRef(null);
  const lightGizmoCameraRef = useRef(null);      // picking camera (original frustum)
  const lightGizmoRenderCamRef = useRef(null);   // render camera (pre-scaled frustum)
  const lightGizmoRingRef = useRef(null);
  const lightGizmoIconRef = useRef(null);
  const lightGizmoFillRef = useRef(null);
  const lightGizmoInteractionRef = useRef(null);
  const dirLight1Ref = useRef(null);
  const dirLight2Ref = useRef(null);
  const lightGizmoSizeRef = useRef(70);
  const [unlit, setUnlit] = useState(false); // eye toggle on the light gizmo — flat shading
  const unlitRef = useRef(false);

  // Inpainting overlay — mesh-wide mask + repeating tile texture
  const inpaintMaskRef = useRef(null);    // { a, b, front, initialized }
  const inpaintTileTexRef = useRef(null);
  const checkerTexRef = useRef(null);
  const inpaintActiveRef = useRef(false);
  const inpaintVisibleRef = useRef(true); // eye toggle — hides the overlay without clearing the mask

  // GPU resources owned by the current layer-texture batch — disposed on the
  // next updateLayerTextures call so rebuilds don't leak textures/blob URLs
  const layerGpuRef = useRef({ textures: [], blobUrls: [] });
  const stampTmpColor = new THREE.Color();
  const stampTmpVec = new THREE.Vector3();
  const stampTmpDir = new THREE.Vector3();

  const [ready, setReady] = useState(false);

  // Screen-space scene offset in CSS pixels — shifts rendered content right.
  // Applied via camera frustum/projection shift (NOT by translating the
  // mesh/camera, which would cancel out).
  // 160px centers the mesh between the 320px left popup and the 288px right sidebar:
  //   (popupWidth + sidebarWidth) / 2 = (320 + 288) / 2 = 160
  const SCENE_OFFSET_PX = 160;
  const sceneOffsetXRef = useRef(0);
  const sceneOffsetYRef = useRef(0);
  // Track ortho zoom to recompute frustum shift when it changes
  const lastOrthoZoomRef = useRef(1);

  // Initialize scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Main scene ──
    const scene = new THREE.Scene();

    // Screen-space scene offset: shift rendered content right by 1/3 of the
    // viewport width (in world units). Applied via frustum/projection shift
    // so the mesh, lights, and orbit target all stay at world origin.
    const aspect = container.clientWidth / container.clientHeight;
    const orthoSize = 5;
    // SCENE_OFFSET_PX in world units: px * (frustumWidth / viewportWidthPx)
    const initOffsetX = SCENE_OFFSET_PX * (2 * orthoSize * aspect) / container.clientWidth;
    sceneOffsetXRef.current = initOffsetX;
    sceneOffsetYRef.current = 0;

    // Grid helper — shown only when no mesh is loaded
    const grid = new THREE.GridHelper(20, 40, 0x444466, 0x333344);
    grid.material.opacity = 0.3;
    grid.material.transparent = true;
    grid.name = '__grid';
    scene.add(grid);
    gridRef.current = grid;

    // Camera (perspective — used when toggled)
    const perspCamera = new THREE.PerspectiveCamera(
      50,
      aspect,
      0.001,
      10000
    );
    perspCamera.position.set(0, 0, 8);
    perspCamera.lookAt(0, 0, 0);
    perspCamera.up.set(0, 1, 0);
    // Shift perspective content right by SCENE_OFFSET_PX via setViewOffset.
    // Content shift = (fullWidth - vw) / 2, so fullWidth = vw + 2 * SCENE_OFFSET_PX.
    {
      const vw = container.clientWidth;
      const vh = container.clientHeight;
      perspCamera.setViewOffset(vw + 2 * SCENE_OFFSET_PX, vh, 0, 0, vw, vh);
    }
    perspCamera.updateProjectionMatrix();

    // Orthographic camera (default) — frustum shifted right by initOffsetX
    // (at zoom=1; the animation loop re-applies with /zoom when zoom changes)
    const camera = new THREE.OrthographicCamera(
      -orthoSize * aspect - initOffsetX, orthoSize * aspect - initOffsetX,
      orthoSize, -orthoSize,
      0.001, 10000
    );
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);
    camera.up.set(0, 1, 0);
    lastOrthoZoomRef.current = 1;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambient);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight1.position.set(10, 10, 10);
    scene.add(dirLight1);
    dirLight1Ref.current = dirLight1;

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight2.position.set(-10, 5, -10);
    scene.add(dirLight2);
    dirLight2Ref.current = dirLight2;

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.rotateSpeed = 1.0;
    controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };

    // Ctrl + middle mouse = zoom (dolly); without Ctrl = rotate
    const updateMiddleButton = (ctrlHeld) => {
      if (controlsRef.current) {
        controlsRef.current.mouseButtons.MIDDLE = ctrlHeld ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
      }
    };
    const handleKeyDown = (e) => { if (e.key === 'Control') updateMiddleButton(true); };
    const handleKeyUp = (e) => { if (e.key === 'Control') updateMiddleButton(false); };
    const handleBlur = () => updateMiddleButton(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    // Store main refs
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera; // ortho by default
    controlsRef.current = controls;
    perspCameraRef.current = perspCamera;
    orthoCameraRef.current = camera;

    // ── Gizmo (overlay) — Blender-style navigation gizmo ──
    // Z is up (blue), Y is forward (green), X is right (red) — Blender convention.
    // Two separate scenes: axisScene (synced with main camera) and ringScene (fixed).

    // Axis scene — circle sprites rotate to reflect the current view direction
    const axisScene = new THREE.Scene();
    const gizmoCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    gizmoCamera.position.set(0, 0, 10);
    gizmoCamera.lookAt(0, 0, 0);

    // Ring scene — rendered with a fixed camera so the white ring never rotates
    const ringScene = new THREE.Scene();
    const ringCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    ringCamera.position.set(0, 0, 10);
    ringCamera.lookAt(0, 0, 0);

    const baseOpacity = 1.0;
    const hoverOpacity = 1.0;
    const axisLength = 1.1;

    // Blender convention: Z up (blue), Y forward (green), X right (red)
    const axisDefs = [
      { dir: new THREE.Vector3(1, 0, 0), color: '#ff0000', label: 'X' },    // red — right
      { dir: new THREE.Vector3(-1, 0, 0), color: '#ff0000', label: '-X' },  // red — left
      { dir: new THREE.Vector3(0, 0, 1), color: '#008000', label: 'Y' },    // green — forward
      { dir: new THREE.Vector3(0, 0, -1), color: '#008000', label: '-Y' },  // green — back
      { dir: new THREE.Vector3(0, 1, 0), color: '#0000ff', label: 'Z' },    // blue — up
      { dir: new THREE.Vector3(0, -1, 0), color: '#0000ff', label: '-Z' },  // blue — down
    ];

    // Helper: orient a cylinder (default points +Y) along a given direction
    const orientAlong = (obj, dir) => {
      if (dir.x > 0) obj.rotation.z = -Math.PI / 2;       // +X
      else if (dir.x < 0) obj.rotation.z = Math.PI / 2;    // -X
      else if (dir.z > 0) obj.rotation.x = Math.PI / 2;    // +Z (forward)
      else if (dir.z < 0) obj.rotation.x = -Math.PI / 2;   // -Z (back)
      else if (dir.y > 0) { /* +Y up — no rotation needed */ }
      else if (dir.y < 0) obj.rotation.x = Math.PI;        // -Y down — flip
    };

    // Helper: create a canvas texture with a solid colored circle + axis label text
    const makeAxisSpriteTexture = (color, label) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      // Solid filled circle (no outline)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(64, 64, 44, 0, Math.PI * 2);
      ctx.fill();
      // Label text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 64, 64);
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return texture;
    };

    const axisSprites = [];
    const axisLines = [];
    axisDefs.forEach((def) => {
      // Line (cylinder) from origin toward the axis
      const lineGeom = new THREE.CylinderGeometry(0.03, 0.03, axisLength, 8);
      const lineMat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: baseOpacity, depthTest: false });
      const line = new THREE.Mesh(lineGeom, lineMat);
      line.position.copy(def.dir).multiplyScalar(axisLength / 2);
      orientAlong(line, def.dir);
      line.renderOrder = 999;
      line.userData = { ...def, type: 'axis', baseOpacity, hoverOpacity };
      axisScene.add(line);
      axisLines.push(line);

      // Circle sprite with axis text at the end of the line (twice as large)
      const tex = makeAxisSpriteTexture(def.color, def.label);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: baseOpacity,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(def.dir).multiplyScalar(axisLength + 0.3);
      sprite.scale.set(1.1, 1.1, 1);
      sprite.renderOrder = 1000;
      sprite.userData = { ...def, type: 'axis', baseOpacity, hoverOpacity, texture: tex };
      axisScene.add(sprite);
      axisSprites.push(sprite);
    });

    // Center sphere removed — Blender gizmo has no center dot

    // Outer white ring removed — only axis arrows remain.

    // Inner free-tumble sphere (invisible, fills the area inside the gizmo)
    const freeSphereRadius = 2.2;
    const freeSphere = new THREE.Mesh(
      new THREE.SphereGeometry(freeSphereRadius, 32, 32),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    freeSphere.renderOrder = 997;
    freeSphere.userData = { type: 'free' };
    ringScene.add(freeSphere);

    gizmoSceneRef.current = axisScene;
    gizmoRingSceneRef.current = ringScene;
    gizmoCameraRef.current = gizmoCamera;
    gizmoRingCameraRef.current = ringCamera;
    gizmoRingsRef.current = axisSprites;
    gizmoAxisLinesRef.current = axisLines;
    // Pre-built combined array for picking (avoids per-pointermove array allocation)
    gizmoPickArrayRef.current = axisSprites.concat(axisLines);
    gizmoOrbitRingRef.current = null;
    gizmoFreeSphereRef.current = freeSphere;

    // ── Lighting gizmo (left of navigation gizmo) ──
    // Single white ring with a lightbulb icon. Dragging the ring orbits
    // the scene's directional light around the model.
    const lightScene = new THREE.Scene();
    const lightGizmoCam = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    lightGizmoCam.position.set(0, 0, 10);
    lightGizmoCam.lookAt(0, 0, 0);

    // Dedicated render camera with pre-scaled frustum so the animation loop
    // never needs to mutate/restore the picking camera's frustum per frame.
    // frustumScale = vpW / lgs = (lgs + lgs*3*2) / lgs = 7 (constant).
    const _lgsInit = lightGizmoSizeRef.current;
    const _frustumScale = (_lgsInit + _lgsInit * 3 * 2) / _lgsInit;
    const lightGizmoRenderCam = new THREE.OrthographicCamera(
      -2 * _frustumScale, 2 * _frustumScale,
      2 * _frustumScale, -2 * _frustumScale,
      0.1, 100
    );
    lightGizmoRenderCam.position.set(0, 0, 10);
    lightGizmoRenderCam.lookAt(0, 0, 0);

    // Google Material "light_mode" icon as a canvas texture
    const makeLightbulbTexture = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffcc00';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '80px "Material Symbols Rounded"';
      // light_mode — sun with rays icon
      ctx.fillText('light_mode', 64, 64);
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return texture;
    };

    // Ensure the Material Symbols font is loaded before creating the texture,
    // then update the texture once the font is ready.
    const bulbTex = makeLightbulbTexture();
    if (document.fonts && document.fonts.load) {
      document.fonts.load('80px "Material Symbols Rounded"').then(() => {
        // Re-render the texture with the loaded font
        const canvas = bulbTex.image;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 128, 128);
        ctx.fillStyle = '#ffcc00';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '80px "Material Symbols Rounded"';
        ctx.fillText('light_mode', 64, 64);
        bulbTex.needsUpdate = true;
      });
    }

    const lightRingRadius = 1.9;
    const lightRing = new THREE.Mesh(
      new THREE.TorusGeometry(lightRingRadius, 0.08, 16, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthTest: false })
    );
    lightRing.renderOrder = 998;
    lightRing.userData = { type: 'light', baseOpacity: 0.5, hoverOpacity: 1.0, baseTube: 0.08, hoverTube: 0.12 };
    lightScene.add(lightRing);

    // Lightbulb icon sprite sitting on the ring (at the top of the ring)
    const bulbMat = new THREE.SpriteMaterial({ map: bulbTex, transparent: true, opacity: 0.9, depthTest: false });
    const bulbSprite = new THREE.Sprite(bulbMat);
    bulbSprite.position.set(0, lightRingRadius, 0); // on the ring at the top
    bulbSprite.scale.set(2.8, 2.8, 1);
    bulbSprite.renderOrder = 999;
    bulbSprite.userData = { type: 'light', texture: bulbTex };
    lightScene.add(bulbSprite);

    // Invisible fill sphere so the entire gizmo area is draggable
    const lightFill = new THREE.Mesh(
      new THREE.SphereGeometry(lightRingRadius * 0.95, 32, 32),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false })
    );
    lightFill.renderOrder = 997;
    lightFill.userData = { type: 'light' };
    lightScene.add(lightFill);

    lightGizmoSceneRef.current = lightScene;
    lightGizmoCameraRef.current = lightGizmoCam;
    lightGizmoRenderCamRef.current = lightGizmoRenderCam;
    lightGizmoRingRef.current = lightRing;
    lightGizmoIconRef.current = bulbSprite;
    lightGizmoFillRef.current = lightFill;

    setReady(true);

    // Pre-allocated temp objects for the animation loop (avoid per-frame allocation)
    const animTmpDir = new THREE.Vector3();
    const animTmpCamDir = new THREE.Vector3();
    // Change-detection snapshots — gizmo/light sync only runs when something
    // actually moved instead of every frame
    const lastGizmoQuat = new THREE.Quaternion();
    const lastGizmoUp = new THREE.Vector3();
    const lastBulbPos = new THREE.Vector3();
    // Forces a gizmo-shade recompute (e.g. when a hover ends — baseOpacity
    // isn't the computed shade for back-facing sprites)
    let gizmoSyncDirty = true;

    // Helper: apply zoom-aware frustum offset to the ortho camera.
    // Three.js ortho zoom keeps (left+right)/2 fixed but shrinks half-width
    // by /zoom, so a fixed frustum shift drifts as zoom changes.
    // Fix: scale the shift by 1/zoom so NDC stays constant.
    const applyOrthoOffset = (cam) => {
      const z = cam.zoom;
      const sx = sceneOffsetXRef.current / z;
      const sy = sceneOffsetYRef.current / z;
      const aspect = container.clientWidth / container.clientHeight;
      const Oa = 5 * aspect;
      cam.left = -Oa - sx;
      cam.right = Oa - sx;
      cam.top = 5 + sy;
      cam.bottom = -5 + sy;
      cam.updateProjectionMatrix();
      lastOrthoZoomRef.current = z;
    };

    // Canvas metrics cache — refreshed once here and again only on window
    // resize, so neither pointer handlers nor the animation loop do per-frame
    // layout reads (the sidebar never changes size without a resize/zoom).
    let canvasRect = null;
    let containerW = 0;
    let containerH = 0;
    const syncCanvasMetrics = () => {
      canvasRect = renderer.domElement.getBoundingClientRect();
      containerW = container.clientWidth;
      containerH = container.clientHeight;
    };
    syncCanvasMetrics();
    const getCanvasRect = () => {
      if (!canvasRect) syncCanvasMetrics();
      return canvasRect;
    };

    // Brush ring — element created/destroyed via the imperative
    // setBrushRingActive() (the project context calls it when maskTool
    // changes). DOM writes deferred to the animation loop: one style update
    // per frame max, positioned via `transform` (compositor-only).
    const ringState = ringStateRef.current;

    // ── Animation loop ──
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      // Apply pending brush-ring DOM writes — one write per frame max.
      if (ringState.dirty) {
        ringState.dirty = false;
        const ring = ringElRef.current;
        if (ring) {
          if (!ringState.visible) {
            if (ring.style.display !== 'none') ring.style.display = 'none';
          } else {
            if (ring.style.display !== 'block') ring.style.display = 'block';
            if (ringState.d !== ringState.appliedD) {
              ringState.appliedD = ringState.d;
              ring.style.width = `${ringState.d}px`;
              ring.style.height = `${ringState.d}px`;
            }
            ring.style.transform = `translate(${ringState.x}px, ${ringState.y}px) translate(-50%, -50%)`;
          }
        }
      }

      // Apply zoom-aware ortho frustum offset before controls.update() so
      // the projection matrix is correct when OrbitControls uses it.
      const orthoCam = orthoCameraRef.current;
      if (orthoCam && orthoCam.zoom !== lastOrthoZoomRef.current) {
        applyOrthoOffset(orthoCam);
      }

      controlsRef.current?.update();

      // Sync gizmo axis orientation with main camera so the axis arrows reflect
      // the current view direction (like Blender's navigation gizmo).
      // Skipped unless the camera orientation or up vector changed.
      const mainCam = cameraRef.current;
      if (mainCam && gizmoCameraRef.current &&
          (gizmoSyncDirty || !mainCam.quaternion.equals(lastGizmoQuat) || !mainCam.up.equals(lastGizmoUp))) {
        gizmoSyncDirty = false;
        lastGizmoQuat.copy(mainCam.quaternion);
        lastGizmoUp.copy(mainCam.up);
        mainCam.getWorldDirection(animTmpDir);
        gizmoCameraRef.current.position.copy(animTmpDir).multiplyScalar(-10);
        gizmoCameraRef.current.up.copy(mainCam.up);
        gizmoCameraRef.current.lookAt(0, 0, 0);

        // Depth shading: only darken axis sprites & lines that are farther from
        // the camera than the gizmo center (i.e. behind the center point).
        animTmpCamDir.copy(animTmpDir).negate(); // direction from origin toward camera
        gizmoRingsRef.current.forEach((sprite) => {
          if (!sprite.userData.dir) return;
          const dot = sprite.userData.dir.dot(animTmpCamDir);
          // dot > 0 = in front of center (full opacity), dot < 0 = behind center (dark)
          const shade = dot >= 0 ? 1.0 : 0.35 + 0.65 * (1 + dot);
          if (!hoveredRingRef.current || hoveredRingRef.current !== sprite) {
            sprite.material.opacity = shade;
          }
        });
        gizmoAxisLinesRef.current.forEach((line) => {
          if (!line.userData.dir) return;
          const dot = line.userData.dir.dot(animTmpCamDir);
          const shade = dot >= 0 ? 1.0 : 0.35 + 0.65 * (1 + dot);
          if (!hoveredRingRef.current || hoveredRingRef.current !== line) {
            line.material.opacity = shade;
          }
        });
      }

      // Update lightbulb icon position on the ring based on current light direction.
      // The light orbits in the XZ plane; map (x, z) to the ring's (x, y).
      // Skipped unless the light actually moved.
      const light = dirLight1Ref.current;
      const bulbIcon = lightGizmoIconRef.current;
      if (light && bulbIcon && !light.position.equals(lastBulbPos)) {
        lastBulbPos.copy(light.position);
        const lx = light.position.x;
        const lz = light.position.z;
        const len = Math.sqrt(lx * lx + lz * lz) || 1;
        const ringR = 1.9;
        bulbIcon.position.set((lx / len) * ringR, -(lz / len) * ringR, 0);
      }

      // Animate the inpaint tile — slow scroll to the right
      if (inpaintActiveRef.current) {
        const off = (performance.now() / 1000) * 0.15 % 1;
        currentMeshRef.current?.traverse((child) => {
          const u = child.isMesh && child.material && child.material.uniforms;
          if (u && u.u_inpaintOffset) u.u_inpaintOffset.value = off;
        });
      }

      const w = containerW;
      const h = containerH;
      const gs = gizmoSizeRef.current;

      // Clear and render main scene full screen
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.setScissor(0, 0, w, h);
      renderer.clear();
      renderer.render(scene, cameraRef.current);

      // Render gizmo in top-right corner region (scissor + viewport)
      // Shifted down-left by 12px padding so the larger ring doesn't bleed off the edge
      const pad = 12;
      renderer.setScissorTest(true);
      renderer.setViewport(w - gs - pad, h - gs - pad, gs, gs);
      renderer.setScissor(w - gs - pad, h - gs - pad, gs, gs);
      renderer.clearDepth();

      // Render axis arrows with the camera-synced gizmo camera.
      // autoClear stays false (set once at init) so this render does NOT
      // wipe the main scene's color buffer in the gizmo scissor region —
      // the mesh stays visible behind the transparent gizmo.
      renderer.render(gizmoSceneRef.current, gizmoCameraRef.current);

      // Render the orbit ring + free sphere with the fixed ring camera
      // (so the white circle never rotates — always faces the viewer)
      renderer.clearDepth();
      renderer.render(gizmoRingSceneRef.current, gizmoRingCameraRef.current);

      // Render lighting gizmo to the left of the navigation gizmo (half size, centered)
      const lgs = lightGizmoSizeRef.current;
      const lgGap = 32; // 2em gap between the two gizmos
      // Center vertically with the navigation gizmo
      const lgY = h - gs - pad + (gs - lgs) / 2;
      const lgX = w - gs - pad - lgs - lgGap;
      // Enlarge both viewport and scissor so the oversized icon isn't clipped.
      // The render camera already has a pre-scaled frustum (set once at init),
      // so the ring stays the same visual size — no per-frame frustum mutation.
      const scissorPad = lgs * 3;
      const vpW = lgs + scissorPad * 2;
      const vpH = lgs + scissorPad * 2;
      const vpX = lgX - scissorPad;
      const vpY = lgY - scissorPad;
      renderer.setViewport(vpX, vpY, vpW, vpH);
      renderer.setScissor(vpX, vpY, vpW, vpH);
      renderer.clearDepth();
      renderer.render(lightGizmoSceneRef.current, lightGizmoRenderCamRef.current);

      renderer.setScissorTest(false);
    };
    animate();

    // ── Resize handler ──
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const aspect = w / h;
      const orthoSize = 5;
      // Screen-space scene offset in world units (SCENE_OFFSET_PX converted).
      sceneOffsetXRef.current = SCENE_OFFSET_PX * (2 * orthoSize * aspect) / w;
      sceneOffsetYRef.current = 0;
      // Update perspective camera (shift content right by SCENE_OFFSET_PX)
      perspCameraRef.current.aspect = aspect;
      perspCameraRef.current.setViewOffset(w + 2 * SCENE_OFFSET_PX, h, 0, 0, w, h);
      perspCameraRef.current.updateProjectionMatrix();
      // Update ortho camera with zoom-aware frustum shift.
      // The offset is divided by zoom so NDC stays constant as zoom changes.
      const z = orthoCameraRef.current.zoom;
      const sx = sceneOffsetXRef.current / z;
      const sy = sceneOffsetYRef.current / z;
      orthoCameraRef.current.left = -orthoSize * aspect - sx;
      orthoCameraRef.current.right = orthoSize * aspect - sx;
      orthoCameraRef.current.top = orthoSize + sy;
      orthoCameraRef.current.bottom = -orthoSize + sy;
      orthoCameraRef.current.updateProjectionMatrix();
      lastOrthoZoomRef.current = z;
      renderer.setSize(w, h);
      // Refresh the cached rect/dims read by pointer handlers and animate()
      syncCanvasMetrics();
    };
    window.addEventListener('resize', handleResize);

    // ── Gizmo interaction ──
    // Pre-allocated reusable objects to avoid per-pointermove allocations
    const pickNDC = new THREE.Vector2();
    const lightPickArray = [null, null, null]; // filled with refs at pick time
    const freeSpherePickArray = [null];

    const getGizmoNDC = (e) => {
      const rect = getCanvasRect();
      const gs = gizmoSizeRef.current;
      const pad = 12;
      // Gizmo region: shifted down-left by pad from top-right corner
      const gx = rect.right - gs - pad;
      const gy = rect.top + pad;
      pickNDC.set(
        ((e.clientX - gx) / gs) * 2 - 1,
        -((e.clientY - gy) / gs) * 2 + 1
      );
      return pickNDC;
    };

    const isPointInGizmoRegion = (e) => {
      const rect = getCanvasRect();
      const gs = gizmoSizeRef.current;
      const pad = 12;
      return e.clientX >= rect.right - gs - pad && e.clientX <= rect.right - pad &&
             e.clientY >= rect.top + pad && e.clientY <= rect.top + gs + pad;
    };

    // Lighting gizmo region (left of the navigation gizmo, half size, centered)
    const getLightGizmoNDC = (e) => {
      const rect = getCanvasRect();
      const gs = gizmoSizeRef.current;
      const lgs = lightGizmoSizeRef.current;
      const pad = 12;
      const gap = 32; // 2em gap between the two gizmos
      const lgY = rect.top + pad + (gs - lgs) / 2;
      const gx = rect.right - gs - pad - lgs - gap;
      const gy = lgY;
      pickNDC.set(
        ((e.clientX - gx) / lgs) * 2 - 1,
        -((e.clientY - gy) / lgs) * 2 + 1
      );
      return pickNDC;
    };

    const isPointInLightGizmoRegion = (e) => {
      const rect = getCanvasRect();
      const gs = gizmoSizeRef.current;
      const lgs = lightGizmoSizeRef.current;
      const pad = 12;
      const gap = 32; // 2em gap between the two gizmos
      const lgY = rect.top + pad + (gs - lgs) / 2;
      const lx = rect.right - gs - pad - lgs - gap;
      return e.clientX >= lx && e.clientX <= lx + lgs &&
             e.clientY >= lgY && e.clientY <= lgY + lgs;
    };

    const pickGizmo = (e) => {
      // Check lighting gizmo first (it's to the left)
      if (isPointInLightGizmoRegion(e)) {
        const ndc = getLightGizmoNDC(e);
        raycasterRef.current.setFromCamera(ndc, lightGizmoCameraRef.current);
        lightPickArray[0] = lightGizmoRingRef.current;
        lightPickArray[1] = lightGizmoIconRef.current;
        lightPickArray[2] = lightGizmoFillRef.current;
        const lightIntersects = raycasterRef.current.intersectObjects(lightPickArray, false);
        if (lightIntersects.length > 0) return lightIntersects[0].object;
        // Fallback: if inside the gizmo region but ray missed, return the fill sphere
        return lightGizmoFillRef.current;
      }
      if (!isPointInGizmoRegion(e)) return null;
      const ndc = getGizmoNDC(e);
      // Pick axis sprites + lines with the synced gizmo camera
      raycasterRef.current.setFromCamera(ndc, gizmoCameraRef.current);
      const axisIntersects = raycasterRef.current.intersectObjects(gizmoPickArrayRef.current, false);
      if (axisIntersects.length > 0) return axisIntersects[0].object;
      // Pick orbit ring + free sphere with the fixed ring camera
      raycasterRef.current.setFromCamera(ndc, gizmoRingCameraRef.current);
      freeSpherePickArray[0] = gizmoFreeSphereRef.current;
      const ringIntersects = raycasterRef.current.intersectObjects(freeSpherePickArray, false);
      return ringIntersects.length > 0 ? ringIntersects[0].object : null;
    };

    const setRingThickness = (ring, tube) => {
      if (!ring || !ring.geometry || !ring.geometry.parameters || ring.geometry.parameters.radius == null) return;
      const currentRadius = ring.geometry.parameters.radius;
      ring.geometry.dispose();
      ring.geometry = new THREE.TorusGeometry(currentRadius, tube, 16, 64);
    };

    const applyHover = (obj) => {
      // Shades need recompute next frame — hover changes which sprite the
      // sync loop must skip, and un-hover restores baseOpacity (not the
      // camera-relative shade)
      gizmoSyncDirty = true;
      // Reset previous hover
      if (hoveredRingRef.current) {
        const prev = hoveredRingRef.current;
        if (prev.userData.type === 'light') {
          if (prev.userData.baseTube != null) setRingThickness(prev, prev.userData.baseTube);
          if (prev.userData.baseOpacity != null) prev.material.opacity = prev.userData.baseOpacity;
        } else if (prev.userData.type === 'axis') {
          prev.material.opacity = prev.userData.baseOpacity;
          // Reset the corresponding line
          const line = gizmoAxisLinesRef.current.find((l) => l.userData.label === prev.userData.label);
          if (line) line.material.opacity = line.userData.baseOpacity;
        }
      }
      hoveredRingRef.current = obj;
      if (obj) {
        if (obj.userData.type === 'light') {
          if (obj.userData.hoverTube != null) setRingThickness(obj, obj.userData.hoverTube);
          if (obj.userData.hoverOpacity != null) obj.material.opacity = obj.userData.hoverOpacity;
        } else if (obj.userData.type === 'axis') {
          obj.material.opacity = obj.userData.hoverOpacity;
          // Brighten the corresponding line
          const line = gizmoAxisLinesRef.current.find((l) => l.userData.label === obj.userData.label);
          if (line) line.material.opacity = line.userData.hoverOpacity;
        }
      }
    };

    // Snap the camera to look down an axis direction (Blender Z-up convention)
    const snapViewToAxis = (dir) => {
      const mainCam = cameraRef.current;
      const mainControls = controlsRef.current;
      if (!mainCam || !mainControls) return;
      const target = mainControls.target.clone();
      const distance = mainCam.position.distanceTo(target);
      mainCam.position.copy(target).add(dir.clone().multiplyScalar(distance));
      // Z is up: when looking along Z (up/down), use Y as up; otherwise use Z as up
      if (Math.abs(dir.y) > 0.9) {
        mainCam.up.set(0, 0, 1);
      } else {
        mainCam.up.set(0, 1, 0);
      }
      mainCam.lookAt(target);
      mainControls.update();
    };

    // ── Mask painting (GPU render-to-texture, ping-pong) ──
    const maskRayNdc = new THREE.Vector2();
    const maskFaceNormal = new THREE.Vector3();

    // Brush radius in world units — the Size slider is screen px, converted to
    // world units at the hit's depth so the painted circle matches the cursor
    // ring exactly, at any zoom.
    const brushWorldRadius = (hit) => {
      const cfg = maskPaintCfgRef.current?.current;
      const cam = cameraRef.current;
      const el = rendererRef.current?.domElement;
      if (!cfg || !cam || !el) return 0;
      const rPx = Math.max(0.5, (cfg.size || 50) / 2);
      const rectH = getCanvasRect().height || 1;
      if (cam.isOrthographicCamera) {
        const worldH = (cam.top - cam.bottom) / (cam.zoom || 1);
        return rPx * (worldH / rectH);
      }
      // Perspective — visible world height at the hit's depth along the view axis
      cam.getWorldDirection(stampTmpDir);
      stampTmpVec.subVectors(hit.point, cam.position);
      const depth = Math.max(1e-6, stampTmpVec.dot(stampTmpDir));
      const worldH = 2 * depth * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
      return rPx * (worldH / rectH);
    };

    // White 1px ring that tracks the cursor at a fixed screen-space size —
    // the Size slider value in px (the brush's world-space footprint varies
    // with UV density, so projecting it made the ring misleading).
    const hideBrushRing = () => {
      if (ringState.visible) {
        ringState.visible = false;
        ringState.dirty = true;
      }
    };
    const updateBrushRing = (e) => {
      const el = renderer.domElement;
      const cfg = maskPaintCfgRef.current?.current;
      if (!cfg) {
        hideBrushRing();
        return;
      }
      // pointermove is bound on window — when the pointer is over an overlay
      // (toolbar, panels, hints) e.target is that element, not the canvas.
      if (e.target !== el) {
        hideBrushRing();
        return;
      }
      const rect = getCanvasRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        hideBrushRing();
        return;
      }
      ringState.x = e.clientX - rect.left;
      ringState.y = e.clientY - rect.top;
      ringState.d = Math.max(2, cfg.size || 50);
      ringState.visible = true;
      ringState.dirty = true;
      el.style.cursor = 'none';
      // Stamp preview — show the captured region inside the ring in draw mode
      if (cfg.tool === 'stamp' && cfg.stampMode === 'draw' && stampViewRef.current) {
        updateStampPreview(e);
      } else {
        hideStampPreview();
      }
    };

    const hideStampPreview = () => {
      const pv = stampPreviewRef.current;
      if (pv && pv.style.display !== 'none') pv.style.display = 'none';
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
      const ctx = pv.getContext('2d');
      ctx.clearRect(0, 0, px, px);

      const rect = getCanvasRect();
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

      ctx.save();
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = Math.min(1, Math.max(0.01, (cfg.opacity ?? 100) / 100)) * 0.85;
      if (cfg.stampInvertX || cfg.stampInvertY) {
        ctx.translate(px / 2, px / 2);
        ctx.scale(cfg.stampInvertX ? -1 : 1, cfg.stampInvertY ? -1 : 1);
        ctx.drawImage(view.canvas, sx - rSrc, sy - rSrc, rSrc * 2, rSrc * 2, -px / 2, -px / 2, px, px);
      } else {
        ctx.drawImage(view.canvas, sx - rSrc, sy - rSrc, rSrc * 2, rSrc * 2, 0, 0, px, px);
      }
      ctx.restore();

      const h = cfg.hardness ?? 50;
      const innerFrac = Math.max(0, 1 - h / 100);
      if (innerFrac < 1) {
        const grad = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
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
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, px, px);
        ctx.globalCompositeOperation = 'source-over';
      }
    };

    const raycastHitAt = (clientX, clientY) => {
      const mesh = currentMeshRef.current;
      const cam = cameraRef.current;
      if (!mesh || !cam) return null;
      const rect = getCanvasRect();
      maskRayNdc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycasterRef.current.setFromCamera(maskRayNdc, cam);
      const intersects = raycasterRef.current.intersectObject(mesh, true);
      const hit = intersects.length > 0 ? intersects[0] : null;
      if (!hit || !hit.uv || !hit.face) return null;
      // Reject backfaces — materials are DoubleSide so the raycaster can
      // return triangles facing away from the camera; those can't be painted
      maskFaceNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (maskFaceNormal.dot(raycasterRef.current.ray.direction) > 0) return null;
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
      const rect = getCanvasRect();
      const STEPS = 12;
      for (let i = 0; i < STEPS; i++) {
        const a = (i / STEPS) * Math.PI * 2;
        const hit = raycastHitAt(clientX + Math.cos(a) * rPx, clientY + Math.sin(a) * rPx);
        if (!hit) continue;

        // Center ray at the cursor (for ortho cams each ray has its own
        // origin — must recompute rather than reuse the ring hit's ray)
        maskRayNdc.set(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1
        );
        raycasterRef.current.setFromCamera(maskRayNdc, cam);
        const ray = raycasterRef.current.ray;
        const t = stampTmpVec.subVectors(hit.point, ray.origin).dot(ray.direction);
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
      u.u_brushRadius.value = R;
      u.u_innerRadius.value = R * Math.max(0, 1 - h / 100);
      u.u_brushStrength.value = Math.min(1, Math.max(0.01, (cfg.opacity ?? 100) / 100));
      u.u_paintSign.value =
        signOverride ?? (cfg.tool === 'eraser' || (cfg.tool === 'inpaint' && cfg.sign === 'subtract') ? -1.0 : 1.0);
      u.u_isDrawing.value = 1.0;

      // Populate the paint group with every submesh's geometry so all UV
      // islands are rasterized each stamp — otherwise texels belonging to
      // submeshes we didn't hit keep the back buffer's stale values and
      // earlier strokes silently revert.
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
      pg.visible = true;
      rtt.blitQuad.visible = false;

      // Rebuild the island coverage map when the mesh changes — one rasterize
      // pass writing solid white wherever any submesh's triangles land.
      if (rtt.coverageMesh !== currentMeshRef.current) {
        pg.children.forEach((c) => { c.material = rtt.coverageMat; });
        const pc = stampTmpColor;
        renderer.getClearColor(pc);
        const pa = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 0);
        renderer.setRenderTarget(rtt.coverageRT);
        renderer.clear(true, false, false);
        renderer.render(rtt.scene, rtt.cam);
        renderer.setRenderTarget(null);
        renderer.setClearColor(pc, pa);
        pg.children.forEach((c) => { c.material = rtt.mat; });
        rtt.coverageMesh = currentMeshRef.current;
      }

      // Paint pass per selected layer: read front → write back. Auto-clear so
      // pixels outside islands keep the mask's base color (white = visible for
      // layer masks, black = unmarked for the inpaint mask) instead of the
      // scene clear color. The same stamp lands in every selected layer's mask.
      const bu = rtt.bleedMat.uniforms;
      const prevClear = stampTmpColor;
      renderer.getClearColor(prevClear);
      const prevClearAlpha = renderer.getClearAlpha();
      for (const layerId of layerIds) {
        const entry = isInpaint ? getInpaintEntry() : cfg.getOrCreateLayerMask?.(layerId);
        if (!entry) continue;
        if (!entry.initialized) clearMaskTarget(entry, isInpaint ? 0x000000 : 0xffffff);
        u.u_baseTexture.value = entry.front.texture;

        const back = entry.front === entry.a ? entry.b : entry.a;
        renderer.setClearColor(isInpaint ? 0x000000 : 0xffffff, 1);
        renderer.setRenderTarget(back);
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
      pg.visible = true;
      rtt.blitQuad.visible = false;

      // Capture per-dab values — the async init callback may run after later
      // dabs have overwritten the shared uniforms.
      const R = brushWorldRadius(hit);
      const h = cfg.hardness ?? 50;
      const dabWorld = hit.point.clone();
      const modelMat = hit.object.matrixWorld.clone();
      const startWorld = paintingRef.current?.stampStartWorld || hit.point;
      const opacity = Math.min(1, Math.max(0.01, (cfg.opacity ?? 100) / 100));
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

      for (const layerId of layerIds) {
        ensureStampEntry(layerId, cfg).then((entry) => {
          if (!entry) return;
          // Rebuild island coverage when the mesh changes (needed by bleed)
          if (rtt.coverageMesh !== currentMeshRef.current) {
            pg.children.forEach((c) => { c.material = rtt.coverageMat; });
            const cc = stampTmpColor;
            renderer.getClearColor(cc);
            const ca = renderer.getClearAlpha();
            renderer.setClearColor(0x000000, 0);
            renderer.setRenderTarget(rtt.coverageRT);
            renderer.clear(true, false, false);
            renderer.render(rtt.scene, rtt.cam);
            renderer.setRenderTarget(null);
            renderer.setClearColor(cc, ca);
            pg.children.forEach((c) => { c.material = rtt.mat; });
            rtt.coverageMesh = currentMeshRef.current;
          }
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
          pg.children.forEach((c) => { c.material = rtt.stampColorMat; });
          const back = entry.front === entry.a ? entry.b : entry.a;
          // Clear to transparent so off-island texels stay invisible before bleed
          const pc = stampTmpColor;
          renderer.getClearColor(pc);
          const pa = renderer.getClearAlpha();
          renderer.setClearColor(0x000000, 0);
          renderer.setRenderTarget(back);
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
          renderer.setRenderTarget(null);
          renderer.setClearColor(pc, pa);
          rtt.bleedQuad.visible = false;
          pg.visible = true;
          pg.children.forEach((c) => { c.material = rtt.mat; });
          stampTexRef.current.set(layerId, entry.front.texture);
          bindLayerTexture(layerId, entry.front.texture);
        });
      }
      // Reveal the stamped pixels through the layer mask
      stampMaskAtHit(layerIds, hit, 1);
    };

    const handlePointerDown = (e) => {
      // Gizmo press takes priority over paint tools — check it first
      const hit = pickGizmo(e);
      // Mask brush takes over left-click — but only off the gizmos
      const paintCfg = maskPaintCfgRef.current?.current;
      // Stamp tool — copy mode picks the source UV, draw mode stamps
      if (!hit && paintCfg?.tool === 'stamp' && e.button === 0 && currentMeshRef.current) {
        if (paintCfg.stampMode === 'copy') {
          const copyHit = raycastHitAt(e.clientX, e.clientY);
          if (copyHit?.uv) {
            stampCopyUVRef.current = copyHit.uv.clone();
            const view = captureStampView();
            if (view) {
              stampViewRef.current?.rt.dispose();
              view.copyWorld = copyHit.point.clone();
              const rect = getCanvasRect();
              const el = rendererRef.current.domElement;
              const sx = el.width / (rect.width || 1);
              const sy = el.height / (rect.height || 1);
              // Canvas-space px (y-down) — used by the ring preview
              view.copyPx = new THREE.Vector2(
                (e.clientX - rect.left) * sx,
                (e.clientY - rect.top) * sy
              );
              stampViewRef.current = view;
            }
            paintCfg.onStampCopy?.();
            e.stopPropagation();
            e.preventDefault();
          }
          return;
        }
        const layerIds = (paintCfg.getSelectedLayerIds?.() || [])
          .filter((lid) => paintCfg.isStampableLayer?.(lid) ?? true);
        const stampHit = raycastHitAt(e.clientX, e.clientY) || raycastRingHitAt(e.clientX, e.clientY);
        if (layerIds.length && stampHit?.uv && stampViewRef.current) {
          e.stopPropagation();
          e.preventDefault();
          paintCfg.onStrokeStart?.();
          const rect = getCanvasRect();
          const el = rendererRef.current.domElement;
          const sx = el.width / (rect.width || 1);
          const sy = el.height / (rect.height || 1);
          paintingRef.current = {
            layerIds,
            lastX: e.clientX,
            lastY: e.clientY,
            stamp: true,
            stampStartUV: stampHit.uv.clone(),
            stampStartWorld: stampHit.point.clone(),
            stampStartPx: new THREE.Vector2(
              (e.clientX - rect.left) * sx,
              (e.clientY - rect.top) * sy
            ),
          };
          stampUvmapAtHit(layerIds, stampHit);
        }
        return;
      }
      if (!hit && paintCfg && (paintCfg.tool === 'brush' || paintCfg.tool === 'eraser' || paintCfg.tool === 'inpaint') && e.button === 0 && currentMeshRef.current) {
        const layerIds = paintCfg.tool === 'inpaint'
          ? ['inpaint']
          : (paintCfg.getSelectedLayerIds?.() || []).slice();
        if (layerIds.length) {
          e.stopPropagation();
          e.preventDefault();
          const hit = raycastHitAt(e.clientX, e.clientY) || raycastRingHitAt(e.clientX, e.clientY);
          if (hit) {
            paintCfg.onStrokeStart?.();
            paintingRef.current = { layerIds, lastX: e.clientX, lastY: e.clientY };
            stampMaskAtHit(layerIds, hit);
          }
          return;
        }
      }
      if (!hit) return;
      e.stopPropagation();
      e.preventDefault();
      hideBrushRing();

      const type = hit.userData.type;

      // Start a drag for all types. For axis, a quick click (no significant move)
      // will snap the view on pointerup.
      const rect = getCanvasRect();
      const gs = gizmoSizeRef.current;
      const pad = 12;
      const cx = rect.right - gs / 2 - pad;
      const cy = rect.top + gs / 2 + pad;
      const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);

      gizmoInteractionRef.current = {
        type,
        dir: hit.userData.dir,   // for axis orbit/snap
        startAngle,
        lastAngle: startAngle,   // for incremental dial rotation
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        // For free rotation: capture initial offset & up, accumulate total rotation
        startOffset: type === 'free' && cameraRef.current && controlsRef.current
          ? cameraRef.current.position.clone().sub(controlsRef.current.target)
          : null,
        startUp: (() => {
          if (type !== 'free' || !cameraRef.current || !controlsRef.current) return null;
          const up = cameraRef.current.up.clone();
          // Orthogonalize up against the view direction so the cross product
          // for the camera right vector can never collapse (prevents gimbal lock).
          const fwd = cameraRef.current.position.clone().sub(controlsRef.current.target).negate().normalize();
          const d = up.dot(fwd);
          up.sub(fwd.multiplyScalar(d)).normalize();
          return up;
        })(),
        totalQuat: new THREE.Quaternion(),
      };

      // Disable orbit controls while dragging gizmo
      controlsRef.current.enabled = false;
    };

    // Reused temp objects for free rotation (avoid per-frame allocation)
    const freeWorldY = new THREE.Vector3(0, 1, 0);
    const freeTmpQuatY = new THREE.Quaternion();
    const freeTmpQuatX = new THREE.Quaternion();
    const freeTmpOffset = new THREE.Vector3();
    const freeTmpUp = new THREE.Vector3();
    const freeTmpForward = new THREE.Vector3();
    const freeTmpRight = new THREE.Vector3();

    // Reused temp objects for light gizmo (avoid per-frame allocation)
    const lightTmpPos = new THREE.Vector3();
    const lightTmpQuat = new THREE.Quaternion();

    // Reused temp objects for axis drag (avoid per-frame allocation)
    const axisTmpTarget = new THREE.Vector3();
    const axisTmpOffset = new THREE.Vector3();
    const axisTmpQuat = new THREE.Quaternion();

    const handlePointerMove = (e) => {
      // Active mask stroke — stamp along the drag path, spaced by `spread` px
      const painting = paintingRef.current;
      if (painting) {
        const cfg = maskPaintCfgRef.current?.current;
        const spread = cfg?.spread ?? 0;
        const dab = painting.stamp
          ? (h) => stampUvmapAtHit(painting.layerIds, h)
          : (h) => stampMaskAtHit(painting.layerIds, h);
        if (spread <= 0) {
          const hit = raycastHitAt(e.clientX, e.clientY) || raycastRingHitAt(e.clientX, e.clientY);
          if (hit) dab(hit);
          painting.lastX = e.clientX;
          painting.lastY = e.clientY;
        } else {
          let dist = Math.hypot(e.clientX - painting.lastX, e.clientY - painting.lastY);
          while (dist >= spread) {
            const t = spread / dist;
            painting.lastX += (e.clientX - painting.lastX) * t;
            painting.lastY += (e.clientY - painting.lastY) * t;
            const hit = raycastHitAt(painting.lastX, painting.lastY) || raycastRingHitAt(painting.lastX, painting.lastY);
            if (hit) dab(hit);
            dist = Math.hypot(e.clientX - painting.lastX, e.clientY - painting.lastY);
          }
        }
        updateBrushRing(e);
        return;
      }
      if (gizmoInteractionRef.current) {
        // Dragging
        const { type, dir, startAngle, startX, startY, lastX, lastY, startUp, startOffset, totalQuat } = gizmoInteractionRef.current;
        const mainCam = cameraRef.current;
        const mainControls = controlsRef.current;
        if (!mainCam || !mainControls) return;

        // Track if the pointer moved enough to count as a drag (not a click)
        const totalMove = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (totalMove > 4) {
          gizmoInteractionRef.current.moved = true;
        }

        const target = axisTmpTarget.copy(mainControls.target);
        const offset = axisTmpOffset.copy(mainCam.position).sub(target);

        if (type === 'axis') {
          // Linear: only vertical (Y) mouse movement rotates around the clicked axis.
          const dy = e.clientY - lastY;
          const sensitivity = 0.01;
          axisTmpQuat.setFromAxisAngle(dir, dy * sensitivity);
          offset.applyQuaternion(axisTmpQuat);
          mainCam.up.applyQuaternion(axisTmpQuat);
          mainCam.position.copy(target).add(offset);
          mainCam.lookAt(target);
          mainControls.update();
          gizmoInteractionRef.current.lastX = e.clientX;
          gizmoInteractionRef.current.lastY = e.clientY;
        } else if (type === 'light') {
          // Lighting gizmo: linear Y mouse movement orbits the directional light around the model.
          const dy = e.clientY - lastY;
          const sensitivity = 0.015;
          const light = dirLight1Ref.current;
          if (light) {
            lightTmpPos.copy(light.position);
            lightTmpQuat.setFromAxisAngle(freeWorldY, dy * sensitivity);
            lightTmpPos.applyQuaternion(lightTmpQuat);
            light.position.copy(lightTmpPos);
            // Update the shader uniform on the mesh material so lighting reacts in real time
            const mesh = currentMeshRef.current;
            if (mesh) {
              mesh.traverse((child) => {
                if (child.isMesh && child.material && child.material.uniforms && child.material.uniforms.dir1Pos) {
                  child.material.uniforms.dir1Pos.value.copy(light.position);
                }
              });
            }
          }
          gizmoInteractionRef.current.lastX = e.clientX;
          gizmoInteractionRef.current.lastY = e.clientY;
        } else if (type === 'free') {
          // Free tumble using an accumulated quaternion.
          // Each frame we derive camera state from the INITIAL offset/up + totalQuat,
          // so there is zero accumulation error (no drift, no violent spinning).
          // Yaw is applied around world Y; pitch around the camera's current right
          // (derived from the accumulated rotation, not from a stale matrix).
          const dx = e.clientX - lastX;
          const dy = e.clientY - lastY;
          const sens = 0.015;

          // 1. Apply yaw around world Y (premultiply = world-space rotation)
          if (dx !== 0) {
            freeTmpQuatY.setFromAxisAngle(freeWorldY, -dx * sens);
            totalQuat.premultiply(freeTmpQuatY);
          }

          // 2. Compute the camera's current right vector from the accumulated rotation
          //    (only needed if we have vertical movement for pitch)
          if (dy !== 0) {
            freeTmpOffset.copy(startOffset).applyQuaternion(totalQuat);
            freeTmpUp.copy(startUp).applyQuaternion(totalQuat);
            freeTmpForward.copy(freeTmpOffset).negate().normalize();
            freeTmpRight.crossVectors(freeTmpForward, freeTmpUp).normalize();

            // 3. Apply pitch around that right vector (premultiply = world-space rotation)
            freeTmpQuatX.setFromAxisAngle(freeTmpRight, -dy * sens);
            totalQuat.premultiply(freeTmpQuatX);
          }

          // 4. Derive final camera state from initial state + totalQuat
          //    Reuse freeTmpUp (already holds startUp*totalQuat if dy!=0)
          offset.copy(startOffset).applyQuaternion(totalQuat);
          mainCam.position.copy(target).add(offset);
          if (dy === 0) freeTmpUp.copy(startUp).applyQuaternion(totalQuat);
          mainCam.up.copy(freeTmpUp);
          mainCam.lookAt(target);
          // Note: controls.update() is called by the animation loop every frame,
          // which syncs OrbitControls' internal spherical state. No need to call
          // it here — that was causing redundant per-pointermove work.
          gizmoInteractionRef.current.lastX = e.clientX;
          gizmoInteractionRef.current.lastY = e.clientY;
        }
      } else {
        // Hover detection
        const hit = pickGizmo(e);
        const cfg = maskPaintCfgRef.current?.current;
        const paintTool = cfg && (cfg.tool === 'brush' || cfg.tool === 'eraser' || cfg.tool === 'inpaint' || cfg.tool === 'stamp');
        if (hit && (hit.userData.type === 'axis' || hit.userData.type === 'light')) {
          applyHover(hit);
          hideBrushRing();
          renderer.domElement.style.cursor = 'pointer';
        } else if (hit && hit.userData.type === 'free') {
          applyHover(null);
          hideBrushRing();
          // With a paint tool active, gizmo hover shows pointer — not grab
          renderer.domElement.style.cursor = paintTool ? 'pointer' : 'grab';
        } else {
          applyHover(null);
          if (paintTool) {
            updateBrushRing(e);
          } else {
            hideBrushRing();
            renderer.domElement.style.cursor = '';
          }
        }
      }
    };

    const handlePointerUp = (e) => {
      if (paintingRef.current) {
        const wasStamp = paintingRef.current.stamp;
        const stampLayerIds = paintingRef.current.layerIds;
        paintingRef.current = null;
        maskPaintCfgRef.current?.current?.onStrokeEnd?.();
        if (wasStamp) maskPaintCfgRef.current?.current?.onStampStrokeEnd?.(stampLayerIds);
        return;
      }
      if (gizmoInteractionRef.current) {
        const { type, dir, moved } = gizmoInteractionRef.current;
        // If it was an axis click (not a drag), snap the view
        if (type === 'axis' && !moved && dir) {
          snapViewToAxis(dir);
        }
        gizmoInteractionRef.current = null;
        controlsRef.current.enabled = true;
        renderer.domElement.style.cursor = '';
      }
    };

    // Ctrl + wheel over the canvas resizes the brush while a paint tool is
    // active. Capture phase so OrbitControls' zoom and the browser's page
    // zoom never see the event.
    const handleWheel = (e) => {
      const cfg = maskPaintCfgRef.current?.current;
      if (!cfg || !e.ctrlKey) return;
      const paintTool = cfg.tool === 'brush' || cfg.tool === 'eraser' || cfg.tool === 'inpaint';
      if (!paintTool || e.target !== renderer.domElement) return;
      e.preventDefault();
      e.stopPropagation();
      const size = cfg.size || 50;
      const step = Math.max(1, Math.round(size * 0.1));
      const next = Math.min(300, Math.max(1, size + (e.deltaY < 0 ? step : -step)));
      cfg.setSize?.(next);
      // React state lands async — resize the ring now so it tracks the wheel
      if (ringState.visible) {
        ringState.d = Math.max(2, next);
        ringState.dirty = true;
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });

    // ── Cleanup ──
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('wheel', handleWheel, true);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      controlsRef.current?.dispose();
      renderer.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      ringElRef.current?.remove();
      // Dispose main scene
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      // Dispose gizmo axis scene (including sprite textures)
      axisScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
      // Dispose gizmo ring scene
      ringScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      // Dispose lighting gizmo scene
      lightScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
      // Dispose layer textures + blob URLs from the last updateLayerTextures
      for (const t of layerGpuRef.current.textures) t.dispose();
      for (const u of layerGpuRef.current.blobUrls) URL.revokeObjectURL(u);
      layerGpuRef.current = { textures: [], blobUrls: [] };
      disposeInpaintEntry();
      inpaintTileTexRef.current?.dispose();
      inpaintTileTexRef.current = null;
      checkerTexRef.current?.dispose();
      checkerTexRef.current = null;
    };
  }, []);

  // Hidden-canvas orthographic render of the mesh from the current camera
  // view (or an explicit rotation). materialFor(child) may return a material
  // to swap in for the capture; null keeps the live (composite) material.
  // The clone shares geometry/materials with the live mesh — only materials
  // created by materialFor are disposed.
  // Renders on the MAIN renderer into a render target — the composite layer
  // shader samples mask render-target textures (inpaint RT, per-layer mask
  // RTs) that are bound to its WebGL context. A separate hidden renderer
  // would sample them as black, discarding every fragment.
  const captureMeshViewImage = (size, { rotation = null, clearColor = 0x000000, clearAlpha = 1, materialFor = null } = {}) => {
    const renderer = rendererRef.current;
    const mainCamera = cameraRef.current;
    const mesh = currentMeshRef.current;
    if (!renderer || !mainCamera || !mesh) return null;

    const rt = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    const captureScene = new THREE.Scene();

    const viewMesh = mesh.clone(true);
    const tempMaterials = [];
    if (materialFor) {
      viewMesh.traverse((child) => {
        if (child.isMesh) {
          const m = materialFor(child);
          if (m) {
            child.material = m;
            tempMaterials.push(m);
          }
        }
      });
    }
    captureScene.add(viewMesh);

    const box = new THREE.Box3().setFromObject(viewMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size3 = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;
    viewMesh.position.sub(center);

    const frustumHalf = maxDim / 2 * 1.1;
    const viewCamera = new THREE.OrthographicCamera(
      -frustumHalf, frustumHalf,
      frustumHalf, -frustumHalf,
      0.1, maxDim * 4
    );
    const camDistance = maxDim * 2;
    if (rotation) {
      viewCamera.rotation.set(
        THREE.MathUtils.degToRad(rotation.x || 0),
        THREE.MathUtils.degToRad(rotation.y || 0),
        THREE.MathUtils.degToRad(rotation.z || 0),
      );
      viewCamera.updateMatrixWorld();
      const viewDir = new THREE.Vector3(0, 0, -1).applyQuaternion(viewCamera.quaternion);
      viewCamera.position.copy(viewDir.clone().multiplyScalar(-camDistance));
      viewCamera.up.set(0, 1, 0);
      viewCamera.lookAt(0, 0, 0);
    } else {
      const viewDir = new THREE.Vector3();
      mainCamera.getWorldDirection(viewDir);
      viewCamera.position.copy(viewDir.clone().multiplyScalar(-camDistance));
      viewCamera.up.copy(mainCamera.up);
      viewCamera.lookAt(0, 0, 0);
    }

    // Save clear state, render into the RT, read back — always restore the
    // renderer's target/clear state and free the RT + temp materials
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    const buf = new Uint8Array(size * size * 4);
    try {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.clear();
      renderer.render(captureScene, viewCamera);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    } finally {
      renderer.setClearColor(prevClearColor, prevClearAlpha);
      renderer.setRenderTarget(null);
      rt.dispose();
      tempMaterials.forEach((m) => m.dispose());
    }

    // Flip rows (GL bottom-up → PNG top-down)
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4;
      img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    getCameraAngle() {
      const cam = cameraRef.current;
      if (!cam) return null;
      // 2 decimals — the CameraAngle column is VARCHAR(64), full-precision
      // radToDeg output overflows it
      return {
        x: Math.round(THREE.MathUtils.radToDeg(cam.rotation.x) * 100) / 100,
        y: Math.round(THREE.MathUtils.radToDeg(cam.rotation.y) * 100) / 100,
        z: Math.round(THREE.MathUtils.radToDeg(cam.rotation.z) * 100) / 100,
      };
    },
    captureThumbnail(size = 75, rotation = null) {
      const mainCamera = cameraRef.current;
      const mesh = currentMeshRef.current;
      if (!mainCamera || !mesh) return null;

      // When a rotation is provided, delegate to the shared camera-angle helper
      if (rotation) {
        return generateAngleThumbnail(mesh, rotation, size);
      }

      // No rotation — match the main camera's current view direction.
      // This case needs the main camera reference, so it stays in ModelViewer.
      const ctx = createThumbScene(mesh, size);
      const { thumbRenderer, thumbScene, thumbCamera, maxDim } = ctx;

      // Match the main camera's view direction and up vector
      const distance = maxDim * 2;
      const viewDir = new THREE.Vector3();
      mainCamera.getWorldDirection(viewDir);
      thumbCamera.position.copy(viewDir.clone().multiplyScalar(-distance));
      thumbCamera.up.copy(mainCamera.up);
      thumbCamera.lookAt(0, 0, 0);
      thumbCamera.updateProjectionMatrix();

      // Render
      thumbRenderer.clear();
      thumbRenderer.render(thumbScene, thumbCamera);
      const dataUrl = thumbRenderer.domElement.toDataURL('image/png');

      // Cleanup
      disposeThumbScene(ctx);

      return dataUrl;
    },

    getCameraRotation() {
      const camera = cameraRef.current;
      if (!camera) return { x: 0, y: 0, z: 0 };
      return {
        x: Math.round(THREE.MathUtils.radToDeg(camera.rotation.x)),
        y: Math.round(THREE.MathUtils.radToDeg(camera.rotation.y)),
        z: Math.round(THREE.MathUtils.radToDeg(camera.rotation.z)),
      };
    },

    getCamera() {
      return cameraRef.current;
    },

    getControls() {
      return controlsRef.current;
    },

    setCameraRotation(rotation) {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) return;
      camera.rotation.set(
        THREE.MathUtils.degToRad(rotation.x || 0),
        THREE.MathUtils.degToRad(rotation.y || 0),
        THREE.MathUtils.degToRad(rotation.z || 0),
      );
      camera.updateMatrixWorld();
      // Reposition so the camera still looks at world origin after rotation
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyQuaternion(camera.quaternion);
      const dist = camera.position.length() || 8;
      camera.position.copy(forward).multiplyScalar(-dist);
      controls.target.set(0, 0, 0);
      controls.update();
    },

    setProjectionMode(mode) {
      const perspCam = perspCameraRef.current;
      const orthoCam = orthoCameraRef.current;
      const renderer = rendererRef.current;
      const container = containerRef.current;
      if (!perspCam || !orthoCam || !renderer || !container) return;

      // Dispose old controls
      const oldControls = controlsRef.current;
      if (oldControls) oldControls.dispose();

      if (mode === 'orthographic') {
        // Copy current perspective camera orientation to ortho
        orthoCam.position.copy(perspCam.position);
        orthoCam.rotation.copy(perspCam.rotation);
        orthoCam.up.copy(perspCam.up);
        // Update ortho frustum to match container aspect, with zoom-aware
        // scene offset shift (offset is divided by zoom so NDC stays constant)
        const aspect = container.clientWidth / container.clientHeight;
        const orthoSize = 5;
        const z = orthoCam.zoom || 1;
        const sx = sceneOffsetXRef.current / z;
        const sy = sceneOffsetYRef.current / z;
        orthoCam.left = -orthoSize * aspect - sx;
        orthoCam.right = orthoSize * aspect - sx;
        orthoCam.top = orthoSize + sy;
        orthoCam.bottom = -orthoSize + sy;
        orthoCam.updateProjectionMatrix();
        lastOrthoZoomRef.current = z;
        // Switch camera ref
        cameraRef.current = orthoCam;
      } else {
        // Copy current ortho camera orientation to perspective
        perspCam.position.copy(orthoCam.position);
        perspCam.rotation.copy(orthoCam.rotation);
        perspCam.up.copy(orthoCam.up);
        // Ensure perspective view offset is applied (set at init/resize)
        const vw = container.clientWidth;
        const vh = container.clientHeight;
        perspCam.setViewOffset(vw + 2 * SCENE_OFFSET_PX, vh, 0, 0, vw, vh);
        perspCam.updateProjectionMatrix();
        // Switch camera ref
        cameraRef.current = perspCam;
      }

      // Create new controls bound to the active camera
      const newControls = new OrbitControls(cameraRef.current, renderer.domElement);
      newControls.enableDamping = false;
      newControls.rotateSpeed = 1.0;
      newControls.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: THREE.MOUSE.PAN,
      };
      newControls.target.set(0, 0, 0);
      newControls.update();
      controlsRef.current = newControls;
    },

    /**
     * Generate a 1024x1024 depth map from the current camera view.
     * Returns a PNG data URL with a black background.
     */
    /**
     * Render a depth map of the mesh, shaped to match the distribution the
     * RefControl depth LoRA was trained on (DepthAnythingV2 maps of scene
     * images): subject sits in the mid-gray range rather than spanning the
     * full 0–255, and the background is a subtle far-field gradient instead
     * of pure-black void. Geometry depth is still exact — we only remap
     * values after the render.
     */
    captureDepthMap(size = 1024, rotation = null) {
      const mainCamera = cameraRef.current;
      const mesh = currentMeshRef.current;
      if (!mainCamera || !mesh) return null;

      // Create a hidden canvas for offscreen depth rendering
      const hiddenCanvas = document.createElement('canvas');
      hiddenCanvas.width = size;
      hiddenCanvas.height = size;
      hiddenCanvas.style.display = 'none';
      document.body.appendChild(hiddenCanvas);

      const depthRenderer = new THREE.WebGLRenderer({
        canvas: hiddenCanvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      depthRenderer.setPixelRatio(1);
      depthRenderer.setSize(size, size);
      // Alpha 0 marks background pixels unambiguously — depth value 0 would
      // collide with the mesh's farthest surfaces
      depthRenderer.setClearColor(0x000000, 0);

      const depthScene = new THREE.Scene();

      try {
        // Clone the mesh with depth material
        const depthMesh = mesh.clone(true);
        depthMesh.traverse((child) => {
          if (child.isMesh) {
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
              else child.material.dispose();
            }
            child.material = new THREE.MeshDepthMaterial({
              depthPacking: THREE.BasicDepthPacking,
              side: THREE.FrontSide,
            });
          }
        });
        depthScene.add(depthMesh);

        // Compute bounding box
        const box = new THREE.Box3().setFromObject(depthMesh);
        const center = box.getCenter(new THREE.Vector3());
        const size3 = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;
        depthMesh.position.sub(center);

        // Use an orthographic camera for the depth map — no perspective distortion,
        // and depth values map linearly across the near/far range.
        const frustumHalf = maxDim / 2 * 1.1; // small padding so the mesh isn't clipped
        const depthCamera = new THREE.OrthographicCamera(
          -frustumHalf, frustumHalf,
          frustumHalf, -frustumHalf,
          0.1, maxDim * 4
        );

        // Position the camera along the view direction
        const camDistance = maxDim * 2; // well outside the mesh
        if (rotation) {
          depthCamera.rotation.set(
            THREE.MathUtils.degToRad(rotation.x || 0),
            THREE.MathUtils.degToRad(rotation.y || 0),
            THREE.MathUtils.degToRad(rotation.z || 0),
          );
          depthCamera.updateMatrixWorld();
          const viewDir = new THREE.Vector3(0, 0, -1);
          viewDir.applyQuaternion(depthCamera.quaternion);
          depthCamera.position.copy(viewDir.clone().multiplyScalar(-camDistance));
          depthCamera.up.set(0, 1, 0);
          depthCamera.lookAt(0, 0, 0);
        } else {
          const viewDir = new THREE.Vector3();
          mainCamera.getWorldDirection(viewDir);
          depthCamera.position.copy(viewDir.clone().multiplyScalar(-camDistance));
          depthCamera.up.copy(mainCamera.up);
          depthCamera.lookAt(0, 0, 0);
        }

        // Tighten near/far planes around the mesh so depth values span
        // most of the 0–1 range before the post-remap below.
        depthCamera.near = camDistance - maxDim / 2 * 1.05;
        depthCamera.far = camDistance + maxDim / 2 * 1.05;
        depthCamera.updateProjectionMatrix();

        depthRenderer.render(depthScene, depthCamera);

        // Post-process into DepthAnythingV2-style statistics: copy the WebGL
        // canvas into a 2D canvas (a canvas can't hold both contexts), then
        // remap subject depth into the mid-range and replace the alpha-0
        // background with a vertical far-field gradient (darker at top,
        // slightly nearer at bottom — like a floor receding into distance).
        const out = document.createElement('canvas');
        out.width = size;
        out.height = size;
        const ctx = out.getContext('2d');
        ctx.drawImage(hiddenCanvas, 0, 0);
        const img = ctx.getImageData(0, 0, size, size);
        const d = img.data;
        for (let y = 0; y < size; y++) {
          // 35 → 70 top-to-bottom; always darker than the remapped subject
          const bg = Math.round(35 + 35 * (y / size));
          for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const v = d[i + 3] === 0
              ? bg
              : Math.min(255, Math.round(100 + d[i] * 0.49)); // 0–255 → ~100–225
            d[i] = v;
            d[i + 1] = v;
            d[i + 2] = v;
            d[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        const dataUrl = out.toDataURL('image/png');
        out.remove();
        return dataUrl;
      } finally {
        // Always clean up: dispose renderer, lose WebGL context, remove hidden canvas
        depthScene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
            else obj.material.dispose();
          }
        });
        depthRenderer.dispose();
        depthRenderer.forceContextLoss();
        hiddenCanvas.remove();
      }
    },

    /**
     * Render the mesh with its composite layer materials — unlit, white
     * background, no inpaint overlay — from the current camera view, or from
     * an arbitrary camera angle when `rotation` ({x,y,z} degrees) is given.
     * Uniforms are shared with the live materials: toggle, render
     * synchronously, restore — no frame ever shows the change.
     */
    captureCompositeImage(size = 1024, rotation = null) {
      const mats = [];
      currentMeshRef.current?.traverse((c) => {
        if (c.isMesh && c.material) {
          (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => mats.push(m));
        }
      });
      mats.forEach((m) => {
        if (m.uniforms?.u_unlit) m.uniforms.u_unlit.value = 1;
        if (m.uniforms?.u_hasInpaint) m.uniforms.u_hasInpaint.value = 0;
        if (m.uniforms?.u_dimBackface) m.uniforms.u_dimBackface.value = 0;
        if (m.userData?.uDimBackface) m.userData.uDimBackface.value = 0;
        // Backface culling — the inpaint inputs should only include faces
        // pointing at the camera. side is rasterizer state, no recompile.
        m.userData._captureSide = m.side;
        m.side = THREE.FrontSide;
      });
      const dataUrl = captureMeshViewImage(size, { clearColor: 0xffffff, rotation });
      mats.forEach((m) => {
        if (m.uniforms?.u_unlit) m.uniforms.u_unlit.value = unlitRef.current ? 1 : 0;
        if (m.uniforms?.u_hasInpaint) m.uniforms.u_hasInpaint.value = inpaintActiveRef.current && inpaintVisibleRef.current ? 1 : 0;
        if (m.uniforms?.u_dimBackface) m.uniforms.u_dimBackface.value = 1;
        if (m.userData?.uDimBackface) m.userData.uDimBackface.value = 1;
        if (m.userData._captureSide !== undefined) {
          m.side = m.userData._captureSide;
          delete m.userData._captureSide;
        }
      });
      return dataUrl;
    },

    /**
     * Render the raw inpaint mask on the mesh — white where painted, black
     * elsewhere, black background — from the current camera view.
     */
    captureInpaintMaskImage(size = 1024) {
      const maskTex = inpaintMaskRef.current?.front?.texture;
      if (!maskTex) return null;
      return captureMeshViewImage(size, {
        clearColor: 0x000000,
        materialFor: () => new THREE.ShaderMaterial({
          uniforms: { u_mask: { value: maskTex } },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D u_mask;
            varying vec2 vUv;
            void main() {
              float m = texture2D(u_mask, vUv).r;
              gl_FragColor = vec4(vec3(m), 1.0);
            }
          `,
          side: THREE.FrontSide, // backface culling — mask only on camera-facing faces
        }),
      });
    },

    /**
     * Render an arbitrary mask image on the mesh — white where painted, black
     * elsewhere, black background — from the given camera angle. Used by the
     * mirror flow to get the source layer's mask in screen space before it's
     * flipped and re-projected. Returns a PNG data URL (null on failure).
     */
    captureMaskViewImage(maskDataUrl, rotation = null, size = 1024) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          // Default flipY=true matches the mask render-target convention —
          // the PNG's top row is the RT's top (v=1).
          const tex = new THREE.Texture(img);
          tex.needsUpdate = true;
          const dataUrl = captureMeshViewImage(size, {
            rotation,
            clearColor: 0x000000,
            materialFor: () => new THREE.ShaderMaterial({
              uniforms: { u_mask: { value: tex } },
              vertexShader: `
                varying vec2 vUv;
                void main() {
                  vUv = uv;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
              `,
              fragmentShader: `
                uniform sampler2D u_mask;
                varying vec2 vUv;
                void main() {
                  float m = texture2D(u_mask, vUv).r;
                  gl_FragColor = vec4(vec3(m), 1.0);
                }
              `,
              side: THREE.FrontSide, // backface culling — same as the inpaint mask capture
            }),
          });
          tex.dispose();
          resolve(dataUrl);
        };
        img.onerror = () => resolve(null);
        img.src = maskDataUrl;
      });
    },

    /**
     * Render the mesh silhouette — opaque white where the mesh is visible,
     * fully transparent background — from the given camera angle. Used by the
     * mirror flow to align a flipped layer image to the mesh's on-screen
     * shape before projection. Returns a PNG data URL (null on failure).
     */
    captureSilhouetteImage(rotation = null, size = 1024) {
      return captureMeshViewImage(size, {
        rotation,
        clearColor: 0x000000,
        clearAlpha: 0,
        materialFor: () => new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide }),
      });
    },

    /**
     * Project a generated image onto the mesh UV map based on the camera angle.
     * Uses projective texturing (GPU shader) — renders the mesh in UV space and
     * for each UV fragment, computes the projected texture coordinate using the
     * projector camera's matrices and samples the generated image.
     * No CPU-side pixel painting, no quantization gaps.
     * Returns a PNG data URL of the UV map with the projected texture.
     */
    projectImageToUvMap(imageDataUrl, rotation = null, uvMapSize = 1024) {
      console.log('[UVProject] Starting, rotation:', rotation, 'uvMapSize:', uvMapSize);
      const mesh = currentMeshRef.current;
      const mainCamera = cameraRef.current;
      if (!mesh || !mainCamera) {
        console.log('[UVProject] No mesh or camera, returning null');
        return null;
      }
      console.log('[UVProject] Mesh found, camera found');

      // Load the generated image as a texture first (needed for the shader)
      console.log('[UVProject] Loading generated image...');
      const genImg = new Image();
      genImg.src = imageDataUrl;

      return new Promise((resolve) => {
        genImg.onload = () => {
          // Hoisted so the catch path can dispose whatever was created before
          // the failure — a thrown error must not leak the hidden canvas or
          // its WebGL context.
          let hiddenCanvas = null, hiddenRenderer = null, renderTarget = null, genTexture = null, uvScene = null;
          const cleanup = () => {
            try {
              if (hiddenRenderer) hiddenRenderer.setRenderTarget(null);
              uvScene?.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                  if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
                  else obj.material.dispose();
                }
              });
              genTexture?.dispose();
              renderTarget?.dispose();
              hiddenRenderer?.dispose();
              hiddenRenderer?.forceContextLoss();
            } catch { /* best-effort dispose */ }
            hiddenCanvas?.remove();
          };
          try {
            console.log('[UVProject] Generated image loaded:', genImg.width, 'x', genImg.height);

            // Create the generated image texture — no color space conversion, pass RGB through directly
            genTexture = new THREE.Texture(genImg);
            genTexture.needsUpdate = true;

            // Create a hidden canvas + dedicated renderer so the main canvas is untouched
            hiddenCanvas = document.createElement('canvas');
            hiddenCanvas.width = uvMapSize;
            hiddenCanvas.height = uvMapSize;
            hiddenCanvas.style.display = 'none';
            document.body.appendChild(hiddenCanvas);

            hiddenRenderer = new THREE.WebGLRenderer({
              canvas: hiddenCanvas,
              antialias: false,
              alpha: true,
              preserveDrawingBuffer: true,
            });
            hiddenRenderer.setPixelRatio(1);
            hiddenRenderer.setSize(uvMapSize, uvMapSize);
            hiddenRenderer.setClearColor(0x000000, 0); // transparent background
            hiddenRenderer.autoClear = true;
            console.log('[UVProject] Hidden renderer created');

            renderTarget = new THREE.WebGLRenderTarget(uvMapSize, uvMapSize, {
              format: THREE.RGBAFormat,
              type: THREE.UnsignedByteType,
              minFilter: THREE.NearestFilter,
              magFilter: THREE.NearestFilter,
            });

            // Compute bounding box of the original mesh to set up the projector camera
            const box = new THREE.Box3().setFromObject(mesh);
            const center = box.getCenter(new THREE.Vector3());
            const size3 = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;
            console.log('[UVProject] Bounding box:', { center: { x: center.x, y: center.y, z: center.z }, size: { x: size3.x, y: size3.y, z: size3.z }, maxDim });

            // Create orthographic projector camera — no perspective distortion
            const frustumHalf = maxDim / 2 * 1.1;
            const projCamera = new THREE.OrthographicCamera(
              -frustumHalf, frustumHalf,
              frustumHalf, -frustumHalf,
              0.1, maxDim * 4
            );
            const camDistance = maxDim * 2;

            if (rotation) {
              projCamera.rotation.set(
                THREE.MathUtils.degToRad(rotation.x || 0),
                THREE.MathUtils.degToRad(rotation.y || 0),
                THREE.MathUtils.degToRad(rotation.z || 0),
              );
              projCamera.updateMatrixWorld();
              const viewDir = new THREE.Vector3(0, 0, -1);
              viewDir.applyQuaternion(projCamera.quaternion);
              projCamera.position.copy(viewDir.clone().multiplyScalar(-camDistance));
              projCamera.up.set(0, 1, 0);
              projCamera.lookAt(0, 0, 0);
              console.log('[UVProject] Projector camera from rotation:', { pos: { x: projCamera.position.x, y: projCamera.position.y, z: projCamera.position.z } });
            } else {
              const viewDir = new THREE.Vector3();
              mainCamera.getWorldDirection(viewDir);
              projCamera.position.copy(viewDir.clone().multiplyScalar(-camDistance));
              projCamera.up.copy(mainCamera.up);
              projCamera.lookAt(0, 0, 0);
              console.log('[UVProject] Projector camera from main camera:', { pos: { x: projCamera.position.x, y: projCamera.position.y, z: projCamera.position.z } });
            }
            projCamera.updateMatrixWorld();
            projCamera.updateProjectionMatrix();

            // Clone mesh with projective texturing shader that renders in UV space.
            // The vertex shader uses UV as the clip-space position (so the output is a UV map),
            // and passes the world position to the fragment shader for projective texturing.
            // The fragment shader transforms the world position by the projector camera
            // matrices to find where this fragment appears in the generated image, then
            // samples the generated image at that position.
            uvScene = new THREE.Scene();
            const uvMesh = mesh.clone(true);
            let meshChildCount = 0;
            uvMesh.traverse((child) => {
              if (child.isMesh) {
                meshChildCount++;
                if (child.material) {
                  if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
                  else child.material.dispose();
                }
                child.material = new THREE.ShaderMaterial({
                  uniforms: {
                    cameraMatrix: { value: projCamera.matrixWorldInverse },
                    projMatrix: { value: projCamera.projectionMatrix },
                    projTexture: { value: genTexture },
                    cameraPos: { value: projCamera.position },
                    uvMapSize: { value: uvMapSize },
                  },
                  vertexShader: `
                    varying vec4 vWorldPos;
                    varying vec3 vWorldNormal;
                    void main() {
                      vWorldPos = modelMatrix * vec4(position, 1.0);
                      vWorldNormal = normalize(mat3(modelMatrix) * normal);
                      // Render in UV space: map UV (0,0)-(1,1) to NDC (-1,-1)-(1,1)
                      gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
                    }
                  `,
                  fragmentShader: `
                    uniform mat4 cameraMatrix;
                    uniform mat4 projMatrix;
                    uniform sampler2D projTexture;
                    uniform vec3 cameraPos;
                    uniform float uvMapSize;
                    varying vec4 vWorldPos;
                    varying vec3 vWorldNormal;
                    void main() {
                      vec3 worldPos = vWorldPos.xyz;
                      vec3 normal = normalize(vWorldNormal);
                      vec3 viewDir = normalize(cameraPos - worldPos);
                      // Only project onto faces whose normals point toward the projector camera
                      if (dot(normal, viewDir) <= 0.0) discard;
                      // Project the world position into the projector camera's clip space
                      vec4 texc = projMatrix * cameraMatrix * vWorldPos;
                      vec2 uv = texc.xy / texc.w / 2.0 + 0.5;
                      // Only paint if the fragment is inside the projector's frustum
                      if (max(uv.x, uv.y) <= 1.0 && min(uv.x, uv.y) >= 0.0) {
                        // Edge fade: fade out 50 pixels from each edge
                        float fadePixels = 50.0;
                        float fadeUv = fadePixels / uvMapSize;
                        float edgeFade = min(
                          min(uv.x, 1.0 - uv.x),
                          min(uv.y, 1.0 - uv.y)
                        ) / fadeUv;
                        float alpha = clamp(edgeFade, 0.0, 1.0);
                        vec4 src = texture2D(projTexture, uv);
                        gl_FragColor = vec4(src.rgb, alpha * src.a);
                      } else {
                        discard; // transparent — outside projector frustum
                      }
                    }
                  `,
                  side: THREE.DoubleSide,
                });
              }
            });
            uvScene.add(uvMesh);
            console.log('[UVProject] Mesh cloned with projective shader, child mesh count:', meshChildCount);

            // Render the UV-space scene to the render target
            hiddenRenderer.setRenderTarget(renderTarget);
            hiddenRenderer.setClearColor(0x000000, 0);
            hiddenRenderer.clear();
            hiddenRenderer.render(uvScene, projCamera);
            console.log('[UVProject] Rendered UV-space projective scene to render target');

            // Read pixels from the render target
            const pixels = new Uint8Array(uvMapSize * uvMapSize * 4);
            hiddenRenderer.readRenderTargetPixels(renderTarget, 0, 0, uvMapSize, uvMapSize, pixels);

            // Count non-transparent pixels
            let nonTransparentCount = 0;
            for (let i = 3; i < pixels.length; i += 4) {
              if (pixels[i] !== 0) nonTransparentCount++;
            }
            console.log('[UVProject] Non-transparent pixels:', nonTransparentCount, '/', uvMapSize * uvMapSize);

            // Cleanup render target + UV scene + hidden renderer/canvas
            cleanup();

            // Write pixels to a 2D canvas, flipping Y (WebGL origin is bottom-left, canvas is top-left)
            const uvCanvas = document.createElement('canvas');
            uvCanvas.width = uvMapSize;
            uvCanvas.height = uvMapSize;
            const uvCtx = uvCanvas.getContext('2d');
            const uvImageData = uvCtx.createImageData(uvMapSize, uvMapSize);
            for (let y = 0; y < uvMapSize; y++) {
              const srcRow = (uvMapSize - 1 - y) * uvMapSize * 4;
              const dstRow = y * uvMapSize * 4;
              for (let x = 0; x < uvMapSize * 4; x++) {
                uvImageData.data[dstRow + x] = pixels[srcRow + x];
              }
            }

            // Coverage mask: white wherever the projection painted a pixel
            // (uvmap alpha > 0), black elsewhere. Captured before the color
            // bleed below so the 2px padding ring isn't included — the mask
            // represents exactly the mesh area the image projected onto.
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = uvMapSize;
            maskCanvas.height = uvMapSize;
            const maskCtx = maskCanvas.getContext('2d');
            const maskImageData = maskCtx.createImageData(uvMapSize, uvMapSize);
            for (let i = 0; i < uvImageData.data.length; i += 4) {
              const v = uvImageData.data[i + 3] > 0 ? 255 : 0;
              maskImageData.data[i] = v;
              maskImageData.data[i + 1] = v;
              maskImageData.data[i + 2] = v;
              maskImageData.data[i + 3] = 255;
            }
            maskCtx.putImageData(maskImageData, 0, 0);
            const maskDataUrl = maskCanvas.toDataURL('image/png');

            // Dilate colored pixels 2px into transparent areas to bleed colors
            // outside UV island edges and avoid creases on the mesh
            const bleedPixels = 2;
            for (let pass = 0; pass < bleedPixels; pass++) {
              const srcData = new Uint8ClampedArray(uvImageData.data);
              for (let y = 0; y < uvMapSize; y++) {
                for (let x = 0; x < uvMapSize; x++) {
                  const idx = (y * uvMapSize + x) * 4;
                  // Only dilate transparent pixels
                  if (srcData[idx + 3] > 0) continue;
                  // Find the nearest non-transparent neighbor (4-connected)
                  let found = false;
                  // Check 4 neighbors
                  const neighbors = [
                    x > 0 ? (y * uvMapSize + (x - 1)) * 4 : -1,
                    x < uvMapSize - 1 ? (y * uvMapSize + (x + 1)) * 4 : -1,
                    y > 0 ? ((y - 1) * uvMapSize + x) * 4 : -1,
                    y < uvMapSize - 1 ? ((y + 1) * uvMapSize + x) * 4 : -1,
                  ];
                  for (const nIdx of neighbors) {
                    if (nIdx >= 0 && srcData[nIdx + 3] > 0) {
                      uvImageData.data[idx] = srcData[nIdx];
                      uvImageData.data[idx + 1] = srcData[nIdx + 1];
                      uvImageData.data[idx + 2] = srcData[nIdx + 2];
                      uvImageData.data[idx + 3] = 255;
                      found = true;
                      break;
                    }
                  }
                  if (!found) {
                    // Check 8-connected (diagonals) as fallback
                    const diagonals = [
                      x > 0 && y > 0 ? ((y - 1) * uvMapSize + (x - 1)) * 4 : -1,
                      x < uvMapSize - 1 && y > 0 ? ((y - 1) * uvMapSize + (x + 1)) * 4 : -1,
                      x > 0 && y < uvMapSize - 1 ? ((y + 1) * uvMapSize + (x - 1)) * 4 : -1,
                      x < uvMapSize - 1 && y < uvMapSize - 1 ? ((y + 1) * uvMapSize + (x + 1)) * 4 : -1,
                    ];
                    for (const dIdx of diagonals) {
                      if (dIdx >= 0 && srcData[dIdx + 3] > 0) {
                        uvImageData.data[idx] = srcData[dIdx];
                        uvImageData.data[idx + 1] = srcData[dIdx + 1];
                        uvImageData.data[idx + 2] = srcData[dIdx + 2];
                        uvImageData.data[idx + 3] = 255;
                        break;
                      }
                    }
                  }
                }
              }
            }

            uvCtx.putImageData(uvImageData, 0, 0);

            const result = uvCanvas.toDataURL('image/png');
            console.log('[UVProject] UV map data URL length:', result?.length);
            resolve({ uvMap: result, mask: maskDataUrl });
          } catch (err) {
            console.error('[UVProject] Error:', err);
            cleanup();
            resolve(null);
          }
        };
        genImg.onerror = () => {
          console.error('[UVProject] Generated image failed to load');
          resolve(null);
        };
      });
    },

    /**
     * Get the current mesh's geometry for UV map operations.
     */
    getMeshGeometry() {
      const mesh = currentMeshRef.current;
      if (!mesh) return null;
      let geometry = null;
      mesh.traverse((child) => {
        if (child.isMesh && !geometry) geometry = child.geometry;
      });
      return geometry;
    },

    /**
     * Create/destroy the brush cursor ring — the project context calls this
     * when maskTool changes so the element only exists while a paint tool
     * (brush/eraser/inpaint) is active.
     */
    setBrushRingActive(active) {
      const container = containerRef.current;
      const ringState = ringStateRef.current;
      if (active && container && !ringElRef.current) {
        const el = document.createElement('div');
        el.className = 'absolute rounded-full border border-white pointer-events-none';
        el.style.cssText = 'display:none;left:0;top:0;transform:translate(-50%,-50%);z-index:10;overflow:hidden;';
        const pv = document.createElement('canvas');
        pv.style.cssText = 'display:none;position:absolute;inset:0;width:100%;height:100%;border-radius:50%;';
        el.appendChild(pv);
        container.appendChild(el);
        ringElRef.current = el;
        stampPreviewRef.current = pv;
        ringState.appliedD = -1;
        ringState.dirty = true;
      } else if (!active && ringElRef.current) {
        ringElRef.current.remove();
        ringElRef.current = null;
        stampPreviewRef.current = null;
        ringState.visible = false;
      }
    },

    /**
     * Composite layer images into a single canvas using the same math as the
     * on-mesh shader composite. items: [{ url, maskDataUrl }], ordered
     * top → bottom. Returns a canvas (or null when empty).
     */
    compositeLayersToCanvas(items) {
      return compositeLayerImages(items || []);
    },

    /**
     * Update the mesh material from the layer stack. Layers are baked into
     * combined images on the CPU (mask applied to each uvmap's alpha) so the
     * shader samples a constant number of textures regardless of layer count.
     * @param {Array} entries - [{ url, maskDataUrl, maskTexture, layerId }]
     *   ordered top→bottom (legacy callers may pass plain url strings)
     * @param {Object} opts - { paintLayerIds } — with the brush/eraser active,
     *   each selected layer keeps its own uvmap + live mask sampler (strokes
     *   draw in real-time on all of them) while contiguous runs of
     *   non-selected layers bake into single combined textures, preserving
     *   true stack order even for non-adjacent selections.
     */
    updateLayerTextures(entries, opts = {}) {
      const mesh = currentMeshRef.current;
      if (!mesh) return;
      const buildId = ++layerBuildIdRef.current;
      const paintLayerIds = opts.paintLayerIds ?? null;

      // Paint-target layers stay in the list even without a uvmap — the stamp
      // tool needs a live slot for empty layers so stamped pixels render.
      const paintTargetSet = new Set(opts.paintLayerIds || []);
      const items = (entries || [])
        .map((e) => (typeof e === 'string' ? { url: e } : e))
        .filter((e) => e.url || paintTargetSet.has(e.layerId));

      // Shared white dummy texture for unbound samplers
      if (!whiteMaskTexRef.current) {
        const data = new Uint8Array([255, 255, 255, 255]);
        whiteMaskTexRef.current = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        whiteMaskTexRef.current.needsUpdate = true;
      }
      const white = whiteMaskTexRef.current;
      // 1x1 transparent dummy — live slot for layers with no uvmap yet
      // (stamp targets); near-black rgb is treated as empty by the shader.
      if (!emptyTexRef.current) {
        const data = new Uint8Array([0, 0, 0, 0]);
        emptyTexRef.current = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        emptyTexRef.current.needsUpdate = true;
      }

      // Checkerboard underlay — tiled beneath every layer stack so
      // transparent regions (e.g. background-removed images) read as
      // checker instead of showing through the mesh.
      if (!checkerTexRef.current) {
        const t = new THREE.TextureLoader().load('/mesh-checkerboard.jpg');
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.flipY = true;
        checkerTexRef.current = t;
      }

      const freeGpu = () => {
        // Stamp canvases + the transparent dummy are shared/persistent —
        // disposing them would break the stamp tool's live bindings.
        const keep = new Set([emptyTexRef.current, ...stampTexRef.current.values()]);
        for (const t of layerGpuRef.current.textures) if (!keep.has(t)) t.dispose();
        for (const u of layerGpuRef.current.blobUrls) URL.revokeObjectURL(u);
        layerGpuRef.current = { textures: [], blobUrls: [] };
      };

      const setGreyMaterial = () => {
        freeGpu();
        shaderLayerIdsRef.current = [];
        mesh.traverse((child) => {
          if (child.isMesh) {
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
              else child.material.dispose();
            }
            child.material = makeGreyMeshMaterial();
          }
        });
      };

      // No layers — restore the original grey MeshStandardMaterial
      if (items.length === 0) {
        setGreyMaterial();
        return;
      }

      const dirLight1 = dirLight1Ref.current;
      const dir1Pos = dirLight1 ? dirLight1.position : new THREE.Vector3(10, 10, 10);

      const inpaintUniforms = () => ({
        u_inpaintMask: { value: inpaintActiveRef.current ? (inpaintMaskRef.current?.front.texture || white) : white },
        u_inpaintTile: { value: inpaintTileTexRef.current || white },
        u_checker: { value: checkerTexRef.current || white },
        u_inpaintOffset: { value: 0 },
        u_unlit: { value: unlitRef.current ? 1 : 0 },
        u_hasInpaint: { value: inpaintActiveRef.current && inpaintVisibleRef.current ? 1 : 0 },
        u_dimBackface: { value: 1 },
      });

      const vertexShader = `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;

      // Shadow-only lighting + inpaint overlay — identical for both variants
      const shaderTail = `
          // Bottom checkerboard layer — layer-stack alpha blends over it so
          // transparent regions read as checker instead of seeing through.
          vec4 checker = texture2D(u_checker, vUv * 64.0);
          color.rgb = mix(checker.rgb, color.rgb, color.a);
          color.a = 1.0;

          // Shadow-only lighting: don't brighten the texture, only darken areas facing away from the light
          vec3 normal = normalize(vNormal);
          vec3 lightDir = normalize(dir1Pos - vWorldPos);
          float NdotL = dot(normal, lightDir);
          // Shadow factor: 1.0 (no shadow) when facing the light, 0.35 (dark) when facing away
          float shadow = mix(0.35, 1.0, clamp(NdotL * 0.5 + 0.5, 0.0, 1.0));

          vec3 shaded = mix(color.rgb * shadow, color.rgb, u_unlit);
          // Backfaces render as checkerboard dimmed 70% — a viewing aid so
          // polys facing away are unmistakable. u_dimBackface goes to 0
          // during image captures so generated inputs keep the real texture.
          if (!gl_FrontFacing && u_dimBackface > 0.5) shaded = checker.rgb * 0.3;
          // Inpainting overlay: lerp to the repeating tile where the mask is
          // painted — tile alpha is respected so transparent parts of the
          // pattern let the layers underneath show through
          if (u_hasInpaint > 0.5) {
            float ip = texture2D(u_inpaintMask, vUv).r;
            vec4 tile = texture2D(u_inpaintTile, vUv * 32.0 + vec2(u_inpaintOffset, 0.0));
            shaded = mix(shaded, tile.rgb, ip * tile.a);
          }

          gl_FragColor = vec4(shaded, color.a);
        }
      `;

      const combinedFragment = `
        uniform sampler2D u_combined;
        uniform float u_hasCombined;
        uniform vec3 dir1Pos;
        uniform sampler2D u_checker;
        uniform sampler2D u_inpaintMask;
        uniform sampler2D u_inpaintTile;
        uniform float u_inpaintOffset;
        uniform float u_hasInpaint;
        uniform float u_unlit;
        uniform float u_dimBackface;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vec4 color = vec4(0.0);
          if (u_hasCombined > 0.5) color = texture2D(u_combined, vUv);
${shaderTail}`;

      (async () => {
        const gpu = { textures: [], blobUrls: [] };
        let uniforms = null;
        let fragmentShader = null;
        let layerIds = [];
        const bail = () => {
          for (const t of gpu.textures) t.dispose();
          for (const u of gpu.blobUrls) URL.revokeObjectURL(u);
        };

        const selSet = new Set(paintLayerIds || []);
        const selIdxSet = new Set();
        items.forEach((e, i) => { if (selSet.has(e.layerId)) selIdxSet.add(i); });

        try {
          if (selIdxSet.size > 0) {
            // Render ops bottom→top (items are top→bottom): contiguous runs
            // of non-selected layers bake into one texture per run; every
            // selected layer gets a live layerN/maskN slot so brush strokes
            // update its mask in real time.
            const ops = [];
            for (let i = items.length - 1; i >= 0;) {
              if (selIdxSet.has(i)) {
                ops.push({ type: 'live', item: items[i] });
                i--;
              } else {
                const seg = [];
                while (i >= 0 && !selIdxSet.has(i)) { seg.unshift(items[i]); i--; }
                ops.push({ type: 'bake', items: seg });
              }
            }

            await Promise.all(ops.map(async (op) => {
              if (op.type === 'bake') {
                const c = await compositeLayerImages(op.items);
                op.tex = c ? await canvasToLayerTexture(c) : null; // { tex, url }
              } else {
                if (op.item.url) {
                  const t = await new THREE.TextureLoader().loadAsync(op.item.url);
                  t.flipY = true;
                  op.tex = t;
                } else {
                  // Empty paint target — reuse the stamp canvas texture if it
                  // exists, otherwise a transparent dummy until the first dab.
                  op.tex = stampTexRef.current.get(op.item.layerId) || emptyTexRef.current;
                }
              }
            }));
            if (buildId !== layerBuildIdRef.current) { bail(); return; }

            for (const op of ops) {
              if (op.type === 'bake') {
                if (!op.tex) continue;
                gpu.textures.push(op.tex.tex);
                gpu.blobUrls.push(op.tex.url);
              } else {
                gpu.textures.push(op.tex);
                if (op.item.url.startsWith('blob:')) gpu.blobUrls.push(op.item.url);
              }
            }

            // Generate the fragment shader — one blend block per op so
            // interleaved selections keep their true z-order.
            let bakeN = 0;
            let liveN = 0;
            const decls = [];
            const body = [];
            uniforms = { dir1Pos: { value: dir1Pos }, ...inpaintUniforms() };
            for (const op of ops) {
              if (op.type === 'bake') {
                const s = bakeN++;
                decls.push(`uniform sampler2D u_bake${s}; uniform float u_hasBake${s};`);
                body.push(`if (u_hasBake${s} > 0.5) { vec4 c${s} = texture2D(u_bake${s}, vUv); color.rgb = mix(color.rgb, c${s}.rgb, c${s}.a); color.a = max(color.a, c${s}.a); }`);
                uniforms[`u_bake${s}`] = { value: op.tex ? op.tex.tex : white };
                uniforms[`u_hasBake${s}`] = { value: op.tex ? 1 : 0 };
              } else {
                const s = liveN++;
                decls.push(`uniform sampler2D layer${s}; uniform sampler2D mask${s}; uniform float hasMask${s};`);
                // With a mask bound, mask defines visibility — the near-black
                // "empty" heuristic would wrongly cull stamped dark content.
                body.push(`{ vec4 lc${s} = texture2D(layer${s}, vUv); float cm${s} = mix(step(0.01, length(lc${s}.rgb)), 1.0, hasMask${s}); float pm${s} = mix(1.0, texture2D(mask${s}, vUv).r, hasMask${s}); float a${s} = mix(0.0, lc${s}.a, pm${s}); color.rgb = mix(color.rgb, lc${s}.rgb, cm${s} * a${s}); color.a = max(color.a, a${s} * cm${s}); }`);
                uniforms[`layer${s}`] = { value: op.tex };
                uniforms[`mask${s}`] = { value: op.item.maskTexture || white };
                uniforms[`hasMask${s}`] = { value: op.item.maskTexture ? 1 : 0 };
                layerIds.push(op.item.layerId);
              }
            }
            fragmentShader = `
        uniform vec3 dir1Pos;
        uniform sampler2D u_checker;
        uniform sampler2D u_inpaintMask;
        uniform sampler2D u_inpaintTile;
        uniform float u_inpaintOffset;
        uniform float u_hasInpaint;
        uniform float u_unlit;
        uniform float u_dimBackface;
        ${decls.join('\n        ')}
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vec4 color = vec4(0.0);
          ${body.join('\n          ')}
${shaderTail}`;
          } else {
            const canvas = await compositeLayerImages(items);
            if (buildId !== layerBuildIdRef.current) { bail(); return; }
            const combined = canvas ? await canvasToLayerTexture(canvas) : null;
            if (!combined) { setGreyMaterial(); return; }
            gpu.textures.push(combined.tex);
            gpu.blobUrls.push(combined.url);

            uniforms = {
              u_combined: { value: combined.tex },
              u_hasCombined: { value: 1 },
              dir1Pos: { value: dir1Pos },
              ...inpaintUniforms(),
            };
            fragmentShader = combinedFragment;
          }
        } catch (err) {
          console.error('Layer texture build failed:', err);
          bail();
          return;
        }

        // A newer build superseded this one — free what we made and bail
        if (buildId !== layerBuildIdRef.current) {
          bail();
          return;
        }

        freeGpu();
        layerGpuRef.current = gpu;
        shaderLayerIdsRef.current = layerIds;
        mesh.traverse((child) => {
          if (child.isMesh) {
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
              else child.material.dispose();
            }
            child.material = new THREE.ShaderMaterial({
              uniforms,
              vertexShader,
              fragmentShader,
              side: THREE.DoubleSide,
            });
          }
        });
      })();
    },

    /**
     * Bind a mask CanvasTexture into the live layer shader for a given layer.
     * Called when a mask is created mid-session (first brush stroke) so the
     * shader picks it up without rebuilding the material.
     */
    /**
     * The stamp tool's per-layer uvmap content as a PNG data URL — reads the
     * layer's stamp render target back into a canvas (row-flipped to PNG
     * top-down) so it can persist via saveUvMap when a stroke ends.
     */
    getStampCanvasDataUrl(layerId) {
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
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(res, res);
      for (let y = 0; y < res; y++) {
        img.data.set(buf.subarray((res - 1 - y) * res * 4, (res - y) * res * 4), y * res * 4);
      }
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL('image/png');
    },

    /**
     * Drop a layer's stamp render targets/texture — call when its uvmap is
     * replaced externally (regenerate, inpaint, reproject) so the next stamp
     * re-seeds from the current uvmap.png instead of a stale buffer.
     */
    invalidateStampCanvas(layerId) {
      stampCanvasRef.current.delete(layerId);
      stampLoadRef.current.delete(layerId);
      stampTexRef.current.delete(layerId);
      const entry = stampRtRef.current.get(layerId);
      if (entry) {
        stampRtRef.current.delete(layerId);
        entry.a.dispose();
        entry.b.dispose();
      }
    },

    bindLayerMask(layerId, texture) {
      const slot = shaderLayerIdsRef.current.indexOf(layerId);
      if (slot < 0) return;
      const mesh = currentMeshRef.current;
      if (!mesh) return;
      mesh.traverse((child) => {
        const uniforms = child.isMesh && child.material && child.material.uniforms;
        if (uniforms && uniforms[`mask${slot}`]) {
          uniforms[`mask${slot}`].value = texture;
          uniforms[`hasMask${slot}`].value = 1;
        }
      });
    },

    /**
     * Inpainting overlay — create a mesh-wide mask cleared to black, load the
     * repeating tile texture, and bind both into the layer shader so painted
     * regions show the tile pattern across all layers.
     */
    beginInpaint() {
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
    },

    // Remove the inpaint mask + tile from the shader. The GPU buffers stay
    // alive so the mask is restored when the tool is re-selected — they are
    // only freed on mesh swap / unmount.
    endInpaint() {
      inpaintActiveRef.current = false;
      currentMeshRef.current?.traverse((child) => {
        const u = child.isMesh && child.material && child.material.uniforms;
        if (u && u.u_inpaintMask) {
          u.u_hasInpaint.value = 0;
          u.u_inpaintMask.value = null;
          u.u_inpaintTile.value = null;
        }
      });
    },

    // Show/hide the inpaint overlay without clearing the painted mask
    setInpaintMaskVisible(visible) {
      inpaintVisibleRef.current = visible;
      currentMeshRef.current?.traverse((child) => {
        const u = child.isMesh && child.material && child.material.uniforms;
        if (u && u.u_hasInpaint) u.u_hasInpaint.value = inpaintActiveRef.current && visible ? 1 : 0;
      });
    },

    /**
     * Upload a saved mask image into a layer mask's ping-pong buffers.
     * Blits the image through the paint material (isDrawing=0 → passthrough)
     * using the fullscreen quad so every texel is written.
     */
    uploadMaskImage(entry, bitmap) {
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
      // Mark initialized so the first paint stroke doesn't clear the
      // loaded mask back to white via clearMaskTarget.
      entry.initialized = true;
    },

    /**
     * Read back a layer mask's front buffer and return it as a PNG data URL
     * (rows flipped so png top = uv.y 1, matching the saved-mask convention).
     */
    maskToDataURL(entry) {
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
    },

    // Read back the inpaint tool's mask render target (UV space, white =
    // painted) as a PNG data URL — the same format as layer mask saves.
    inpaintMaskToDataURL() {
      const entry = inpaintMaskRef.current;
      if (!entry) return null;
      return this.maskToDataURL(entry);
    },

    // Clear the inpaint overlay mask back to empty (all black). No-op if the
    // inpaint tool was never activated on this mesh.
    clearInpaintMask() {
      if (!inpaintMaskRef.current) return;
      clearMaskTarget(inpaintMaskRef.current, 0x000000);
    },

    // Load a mask bitmap (white = painted) into the inpaint overlay mask —
    // e.g. seeding the inpaint tool from a layer's saved mask.png. Decode
    // with imageOrientation:'flipY', same as uploadMaskImage's callers.
    loadInpaintMask(bitmap) {
      if (!bitmap) return;
      this.uploadMaskImage(getInpaintEntry(), bitmap);
    },
  }), []);

  // Load / swap mesh when selection changes
  const loadMesh = useCallback((meshMeta) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    // Remove and dispose previous mesh
    if (currentMeshRef.current) {
      scene.remove(currentMeshRef.current);
      currentMeshRef.current.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      currentMeshRef.current = null;
    }

    // The inpaint mask is UV data tied to the previous mesh — drop it, then
    // recreate a cleared entry if the tool is still active on the new mesh
    disposeInpaintEntry();
    if (inpaintActiveRef.current) {
      clearMaskTarget(getInpaintEntry(), 0x000000);
    }

    if (!meshMeta || !meshMeta.object) {
      if (gridRef.current) gridRef.current.visible = true;
      return;
    }

    // Hide grid once a mesh is loaded
    if (gridRef.current) gridRef.current.visible = false;

    // Clone the mesh so we don't mutate the original parsed object
    const mesh = meshMeta.object.clone(true);
    currentMeshRef.current = mesh;

    // Apply a grey MeshStandardMaterial to all meshes and ensure geometry has normals
    mesh.traverse((child) => {
      if (child.isMesh) {
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
        child.material = makeGreyMeshMaterial();
        if (child.geometry && !child.geometry.attributes.normal) {
          child.geometry.computeVertexNormals();
        }
        child.visible = true;
      }
    });

    // Bake the mesh's world transform into the geometry
    mesh.updateMatrixWorld(true);

    const tempBox = new THREE.Box3();
    const tempVec = new THREE.Vector3();
    const tempMatrix = new THREE.Matrix4();

    mesh.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.geometry.applyMatrix4(child.matrixWorld);
        child.position.set(0, 0, 0);
        child.rotation.set(0, 0, 0);
        child.scale.set(1, 1, 1);
        child.updateMatrixWorld(true);
        child.geometry.computeBoundingBox();
        if (child.geometry.boundingBox) {
          tempBox.union(child.geometry.boundingBox);
        }
      }
    });

    const center = tempBox.getCenter(tempVec);
    const size = new THREE.Vector3();
    tempBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);

    tempMatrix.makeTranslation(-center.x, -center.y, -center.z);
    mesh.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.geometry.applyMatrix4(tempMatrix);
        child.geometry.computeBoundingBox();
        child.geometry.computeBoundingSphere();
      }
    });

    const scale = 4 / maxDim;
    mesh.scale.setScalar(scale);

    // Mesh stays at world origin — the screen-space shift is handled by the
    // camera frustum/projection offset, not by translating the mesh.
    mesh.position.set(0, 0, 0);
    scene.add(mesh);

    // Position camera straight in front of the mesh (forward = +Z in Three.js,
    // which maps to Y-forward in Blender convention), Z-up, at eye level.
    const dist = 8;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.up.set(0, 1, 0);
    controls.target.set(0, 0, 0);
    controls.update();

    // Notify parent that the mesh has been loaded into the viewer
    if (onMeshLoadedRef.current) onMeshLoadedRef.current(meshMeta);
  }, []);

  useEffect(() => {
    if (ready && selectedMesh) {
      loadMesh(selectedMesh);
    } else if (ready && !selectedMesh) {
      if (currentMeshRef.current) {
        sceneRef.current.remove(currentMeshRef.current);
        currentMeshRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
            else obj.material.dispose();
          }
        });
        currentMeshRef.current = null;
        for (const t of layerGpuRef.current.textures) t.dispose();
        for (const u of layerGpuRef.current.blobUrls) URL.revokeObjectURL(u);
        layerGpuRef.current = { textures: [], blobUrls: [] };
        disposeInpaintEntry();
        for (const entry of stampRtRef.current.values()) {
          entry.a.dispose();
          entry.b.dispose();
        }
        stampRtRef.current.clear();
        stampTexRef.current.clear();
        stampCanvasRef.current.clear();
        stampLoadRef.current.clear();
        stampViewRef.current?.rt.dispose();
        stampViewRef.current = null;
      }
      const grid = sceneRef.current.getObjectByName('__grid');
      if (grid) grid.visible = true;
    }
  }, [ready, selectedMesh, loadMesh]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full"
      style={{ background: 'radial-gradient(circle at center, #2a2a5e, #1a1a2e)' }}
    >

      {/* Light toggle — centered on the sunlight gizmo (left of the nav gizmo).
          Off = unlit shading on the main canvas */}
      <button
        type="button"
        onClick={toggleUnlit}
        className={`absolute z-20 transition ${
          unlit
            ? 'text-gray-300 dark:text-gray-600 hover:text-gray-500'
            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
        }`}
        style={{ top: 82, right: 219, transform: 'translate(50%, -50%)' }}
        aria-label={unlit ? 'Enable lighting' : 'Disable lighting'}
        title={unlit ? 'Lighting off — click for lit' : 'Lighting on — click for unlit'}
      >
        <Icon name={unlit ? 'visibility_off' : 'visibility'} className="text-2xl" />
      </button>
    </div>
  );
});

export default memo(ModelViewer);
