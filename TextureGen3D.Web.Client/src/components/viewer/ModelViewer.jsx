import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Icon from '@/components/ui/icon';
import { SCENE_OFFSET_PX } from './viewerUtils';
import { makeGreyMeshMaterial } from './materials';
import { createPaintEngine } from './paintEngine';
import { createBrushRing } from './brushRing';
import { createGizmoSystem } from './gizmos';
import { createCaptureTools } from './captures';
import { createLayerComposer } from './layerComposer';

/**
 * ModelViewer — full-screen Three.js canvas that renders the selected mesh.
 * Orchestrates the subsystems living in this folder:
 *   - paintEngine    — UV-space mask painting + clone stamping (ping-pong RTs)
 *   - brushRing      — DOM cursor ring + stamp preview
 *   - gizmos         — nav + lighting overlay gizmos (scenes, picking, drag)
 *   - captures       — render-to-image methods (thumb/depth/composite/mask/UV-project)
 *   - layerComposer  — CPU layer bake + live-slot shader assembly
 *   - viewerUtils    — pixel floods, image loading, RT readback, constants
 *   - materials      — every material/shader factory
 *   - layerImages    — CPU compositing + mip-safe texture upload
 *
 * All subsystems share `ctx` — a stable object holding the component's refs
 * plus late-bound helpers (getCanvasRect is assigned inside the init effect).
 *
 * Props:
 *   selectedMesh — the mesh object from parseModel result (contains `.object`,
 *                  a live THREE.Mesh). When null, shows nothing.
 */
const ModelViewer = forwardRef(function ModelViewer({ selectedMesh, onMeshLoaded, maskPaintConfig, onUnlitChange }, ref) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const currentMeshRef = useRef(null);
  const animationFrameRef = useRef(null);
  const ringElRef = useRef(null);
  const stampPreviewRef = useRef(null);  // canvas inside the ring — stamp source preview
  const stampCopyIconRef = useRef(null); // icon inside the ring — copy mode indicator
  const pickerSwatchRef = useRef(null);  // swatch at ring's bottom-right — brush eyedropper
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

  const [ready, setReady] = useState(false);

  const sceneOffsetXRef = useRef(0);
  const sceneOffsetYRef = useRef(0);
  // Track ortho zoom to recompute frustum shift when it changes
  const lastOrthoZoomRef = useRef(1);

  // ── Shared subsystem context — one stable object holding every ref ──
  const ctxRef = useRef(null);
  if (!ctxRef.current) {
    ctxRef.current = {
      containerRef, sceneRef, rendererRef, cameraRef, controlsRef, currentMeshRef,
      ringStateRef, ringElRef, stampPreviewRef, stampCopyIconRef, pickerSwatchRef, gridRef,
      orthoCameraRef, perspCameraRef, maskPaintCfgRef, paintingRef,
      stampViewRef, stampCopyUVRef, stampCanvasRef, stampRtRef, stampTexRef,
      stampLoadRef, emptyTexRef, paintRttRef, shaderLayerIdsRef, whiteMaskTexRef,
      layerBuildIdRef, raycasterRef, hoveredRingRef,
      gizmoSceneRef, gizmoRingSceneRef, gizmoCameraRef, gizmoRingCameraRef,
      gizmoRingsRef, gizmoAxisLinesRef, gizmoPickArrayRef, gizmoOrbitRingRef,
      gizmoFreeSphereRef, gizmoSizeRef, gizmoInteractionRef,
      lightGizmoSceneRef, lightGizmoCameraRef, lightGizmoRenderCamRef,
      lightGizmoRingRef, lightGizmoIconRef, lightGizmoFillRef,
      lightGizmoInteractionRef, dirLight1Ref, dirLight2Ref, lightGizmoSizeRef,
      unlitRef, inpaintMaskRef, inpaintTileTexRef, checkerTexRef,
      inpaintActiveRef, inpaintVisibleRef, layerGpuRef,
      sceneOffsetXRef, sceneOffsetYRef, lastOrthoZoomRef,
      // Late-bound by the init effect to a rect-cached version; the fallback
      // reads fresh so helpers work before the first frame.
      getCanvasRect: () => rendererRef.current?.domElement.getBoundingClientRect(),
    };
  }
  const ctx = ctxRef.current;

  // Subsystems — created once per component instance
  const paintHolderRef = useRef(null);
  if (!paintHolderRef.current) paintHolderRef.current = createPaintEngine(ctx);
  const paint = paintHolderRef.current;

  const brushRingHolderRef = useRef(null);
  if (!brushRingHolderRef.current) brushRingHolderRef.current = createBrushRing(ctx);
  const brushRing = brushRingHolderRef.current;

  const gizmosHolderRef = useRef(null);
  if (!gizmosHolderRef.current) gizmosHolderRef.current = createGizmoSystem(ctx);
  const gizmos = gizmosHolderRef.current;

  const captureHolderRef = useRef(null);
  if (!captureHolderRef.current) captureHolderRef.current = createCaptureTools(ctx);
  const capture = captureHolderRef.current;

  const composerHolderRef = useRef(null);
  if (!composerHolderRef.current) composerHolderRef.current = createLayerComposer(ctx);
  const composer = composerHolderRef.current;

  // Eye toggle on the light gizmo — u_unlit bypasses the layer shader's
  // shadow term; the scene's directional lights are also zeroed so the grey
  // MeshStandardMaterial fallback renders flat too.
  const applyUnlit = (next) => {
    unlitRef.current = next;
    setUnlit(next);
    currentMeshRef.current?.traverse((child) => {
      const u = child.isMesh && child.material && child.material.uniforms;
      if (u && u.u_unlit) u.u_unlit.value = next ? 1 : 0;
    });
    if (dirLight1Ref.current) dirLight1Ref.current.intensity = next ? 0 : 1.0;
    if (dirLight2Ref.current) dirLight2Ref.current.intensity = next ? 0 : 0.5;
  };
  const toggleUnlit = () => {
    const next = !unlitRef.current;
    applyUnlit(next);
    onUnlitChange?.(next); // context persists it under ui:{projectId}
  };

  // Initialize scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Main scene ──
    const scene = new THREE.Scene();

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

    // ── Overlay gizmos (nav + lighting) ──
    gizmos.build();
    gizmos.buildLight();

    setReady(true);

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
    // Share the rect cache with every subsystem
    ctx.getCanvasRect = getCanvasRect;

    // ── Animation loop ──
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      // Apply pending brush-ring DOM writes — one write per frame max.
      brushRing.applyFrame();

      // Apply zoom-aware ortho frustum offset before controls.update() so
      // the projection matrix is correct when OrbitControls uses it.
      const orthoCam = orthoCameraRef.current;
      if (orthoCam && orthoCam.zoom !== lastOrthoZoomRef.current) {
        applyOrthoOffset(orthoCam);
      }

      controlsRef.current?.update();

      // Gizmo axis sync + lightbulb position (skipped when nothing moved)
      gizmos.syncFrame();

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

      // Clear and render main scene full screen
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.setScissor(0, 0, w, h);
      renderer.clear();
      renderer.render(scene, cameraRef.current);

      // Overlay gizmos (nav top-right, lighting to its left)
      gizmos.renderOverlays(w, h);
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

    // ── Pointer handlers ──
    let pendingPick = null; // {x,y} — pointer-tool click awaiting pointerup
    const handlePointerDown = (e) => {
      // Gizmo press takes priority over paint tools — check it first
      const hit = gizmos.pick(e);
      // Mask brush takes over left-click — but only off the gizmos
      const paintCfg = maskPaintCfgRef.current?.current;
      // Pointer tool — record the click position; the pick fires on
      // pointerup if the pointer didn't drag (dragging orbits the mesh).
      if (!hit && paintCfg?.tool === 'pointer' && e.button === 0 && currentMeshRef.current) {
        pendingPick = { x: e.clientX, y: e.clientY };
        return;
      }
      // Stamp tool — copy mode picks the source UV, draw mode stamps
      if (!hit && paintCfg?.tool === 'stamp' && e.button === 0 && currentMeshRef.current) {
        if (paintCfg.stampMode === 'copy') {
          const copyHit = paint.raycastHitAt(e.clientX, e.clientY);
          if (copyHit?.uv) {
            stampCopyUVRef.current = copyHit.uv.clone();
            const view = capture.captureStampView();
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
        const stampHit = paint.raycastHitAt(e.clientX, e.clientY) || paint.raycastRingHitAt(e.clientX, e.clientY);
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
          paint.stampUvmapAtHit(layerIds, stampHit);
        }
        return;
      }
      // Blur tool — softens the selected layers' uvmap under the brush disc
      if (!hit && paintCfg?.tool === 'blur' && e.button === 0 && currentMeshRef.current) {
        const layerIds = (paintCfg.getSelectedLayerIds?.() || []).slice();
        const blurHit = paint.raycastHitAt(e.clientX, e.clientY) || paint.raycastRingHitAt(e.clientX, e.clientY);
        if (layerIds.length && blurHit) {
          e.stopPropagation();
          e.preventDefault();
          paintCfg.onStrokeStart?.();
          // stamp: true → pointerup fires onStampStrokeEnd (persists the
          // layer's stamp RT back to uvmap.png like a stamp stroke does)
          paintingRef.current = { layerIds, lastX: e.clientX, lastY: e.clientY, stamp: true, blur: true };
          paint.blurUvmapAtHit(layerIds, blurHit);
        }
        return;
      }
      // Brush/eraser — paint cfg.color into (or erase alpha from) the
      // selected layers' uvmap stamp targets
      if (!hit && paintCfg && (paintCfg.tool === 'brush' || paintCfg.tool === 'eraser') && e.button === 0 && currentMeshRef.current) {
        // Eyedropper mode — sample the uvmap color under the cursor into
        // the brush color instead of painting
        if (paintCfg.brushPick) {
          e.stopPropagation();
          e.preventDefault();
          paintCfg.onPickColor?.(e.clientX, e.clientY);
          return;
        }
        const layerIds = (paintCfg.getSelectedLayerIds?.() || []).slice();
        if (layerIds.length) {
          e.stopPropagation();
          e.preventDefault();
          const hit = paint.raycastHitAt(e.clientX, e.clientY) || paint.raycastRingHitAt(e.clientX, e.clientY);
          if (hit) {
            paintCfg.onStrokeStart?.();
            // stamp: true → pointerup fires onStampStrokeEnd so the painted
            // stamp RTs persist back to uvmap.png; paint: true → dab dispatch
            paintingRef.current = { layerIds, lastX: e.clientX, lastY: e.clientY, stamp: true, paint: true };
            paint.paintColorAtHit(layerIds, hit);
          }
          return;
        }
      }
      // Mask tool — paints the layer mask (the old brush/eraser behavior);
      // inpaint paints the mesh-wide inpaint overlay mask
      if (!hit && paintCfg && (paintCfg.tool === 'mask' || paintCfg.tool === 'inpaint') && e.button === 0 && currentMeshRef.current) {
        const layerIds = paintCfg.tool === 'inpaint'
          ? ['inpaint']
          : (paintCfg.getSelectedLayerIds?.() || []).slice();
        if (layerIds.length) {
          e.stopPropagation();
          e.preventDefault();
          const hit = paint.raycastHitAt(e.clientX, e.clientY) || paint.raycastRingHitAt(e.clientX, e.clientY);
          if (hit) {
            paintCfg.onStrokeStart?.();
            paintingRef.current = { layerIds, lastX: e.clientX, lastY: e.clientY };
            paint.stampMaskAtHit(layerIds, hit);
          }
          return;
        }
      }
      if (!hit) return;
      e.stopPropagation();
      e.preventDefault();
      brushRing.hide();
      gizmos.beginDrag(hit, e);
    };

    const handlePointerMove = (e) => {
      // Active mask stroke — stamp along the drag path, spaced by `spread` px
      const painting = paintingRef.current;
      if (painting) {
        const cfg = maskPaintCfgRef.current?.current;
        const spread = cfg?.spread ?? 0;
        const dab = painting.blur
          ? (h) => paint.blurUvmapAtHit(painting.layerIds, h)
          : painting.paint
          ? (h) => paint.paintColorAtHit(painting.layerIds, h)
          : painting.stamp
          ? (h) => paint.stampUvmapAtHit(painting.layerIds, h)
          : (h) => paint.stampMaskAtHit(painting.layerIds, h);
        if (spread <= 0) {
          const hit = paint.raycastHitAt(e.clientX, e.clientY) || paint.raycastRingHitAt(e.clientX, e.clientY);
          if (hit) dab(hit);
          painting.lastX = e.clientX;
          painting.lastY = e.clientY;
        } else {
          let dist = Math.hypot(e.clientX - painting.lastX, e.clientY - painting.lastY);
          while (dist >= spread) {
            const t = spread / dist;
            painting.lastX += (e.clientX - painting.lastX) * t;
            painting.lastY += (e.clientY - painting.lastY) * t;
            const hit = paint.raycastHitAt(painting.lastX, painting.lastY) || paint.raycastRingHitAt(painting.lastX, painting.lastY);
            if (hit) dab(hit);
            dist = Math.hypot(e.clientX - painting.lastX, e.clientY - painting.lastY);
          }
        }
        brushRing.update(e);
        return;
      }
      if (gizmoInteractionRef.current) {
        gizmos.drag(e);
        return;
      }
      // Hover detection
      const hit = gizmos.pick(e);
      const cfg = maskPaintCfgRef.current?.current;
      const paintTool = cfg && (cfg.tool === 'brush' || cfg.tool === 'eraser' || cfg.tool === 'inpaint' || cfg.tool === 'stamp' || cfg.tool === 'blur' || cfg.tool === 'mask');
      if (hit && (hit.userData.type === 'axis' || hit.userData.type === 'light')) {
        gizmos.applyHover(hit);
        brushRing.hide();
        renderer.domElement.style.cursor = 'pointer';
      } else if (hit && hit.userData.type === 'free') {
        gizmos.applyHover(null);
        brushRing.hide();
        // With a paint tool active, gizmo hover shows pointer — not grab
        renderer.domElement.style.cursor = paintTool ? 'pointer' : 'grab';
      } else {
        gizmos.applyHover(null);
        if (paintTool) {
          brushRing.update(e);
        } else {
          brushRing.hide();
          renderer.domElement.style.cursor = '';
        }
      }
    };

    const handlePointerUp = (e) => {
      // Pointer-tool pick — a click that didn't become a drag selects the
      // top-most layer with visible pixels under the cursor.
      if (pendingPick) {
        const p = pendingPick;
        pendingPick = null;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) {
          maskPaintCfgRef.current?.current?.onPointerPick?.(e.clientX, e.clientY);
        }
        return;
      }
      if (paintingRef.current) {
        const wasStamp = paintingRef.current.stamp;
        const stampLayerIds = paintingRef.current.layerIds;
        paintingRef.current = null;
        maskPaintCfgRef.current?.current?.onStrokeEnd?.();
        if (wasStamp) maskPaintCfgRef.current?.current?.onStampStrokeEnd?.(stampLayerIds);
        return;
      }
      if (gizmoInteractionRef.current) {
        gizmos.endDrag();
      }
    };

    // Ctrl + wheel over the canvas resizes the brush while a paint tool is
    // active. Capture phase so OrbitControls' zoom and the browser's page
    // zoom never see the event.
    const handleWheel = (e) => {
      const cfg = maskPaintCfgRef.current?.current;
      if (!cfg || !e.ctrlKey) return;
      const paintTool = cfg.tool === 'brush' || cfg.tool === 'eraser' || cfg.tool === 'inpaint' || cfg.tool === 'stamp' || cfg.tool === 'blur' || cfg.tool === 'mask';
      if (!paintTool || e.target !== renderer.domElement) return;
      e.preventDefault();
      e.stopPropagation();
      const size = cfg.size || 50;
      const step = Math.max(1, Math.round(size * 0.1));
      const next = Math.min(300, Math.max(1, size + (e.deltaY < 0 ? step : -step)));
      cfg.setSize?.(next);
      // React state lands async — resize the ring now so it tracks the wheel
      const ringState = ringStateRef.current;
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
      // Dispose gizmo overlay scenes
      gizmos.dispose();
      // Dispose layer textures + blob URLs from the last updateLayerTextures
      for (const t of layerGpuRef.current.textures) t.dispose();
      for (const u of layerGpuRef.current.blobUrls) URL.revokeObjectURL(u);
      layerGpuRef.current = { textures: [], blobUrls: [] };
      paint.disposeInpaintEntry();
      inpaintTileTexRef.current?.dispose();
      inpaintTileTexRef.current = null;
      checkerTexRef.current?.dispose();
      checkerTexRef.current = null;
    };
  }, []);

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
      return capture.captureThumbnail(size, rotation);
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

    captureDepthMap(size = 1024, rotation = null) {
      return capture.captureDepthMap(size, rotation);
    },

    captureCompositeImage(size = 1024, rotation = null) {
      return capture.captureCompositeImage(size, rotation);
    },

    captureInpaintMaskImage(size = 1024) {
      return capture.captureInpaintMaskImage(size);
    },

    captureMaskViewImage(maskDataUrl, rotation = null, size = 1024) {
      return capture.captureMaskViewImage(maskDataUrl, rotation, size);
    },

    captureSilhouetteImage(rotation = null, size = 1024) {
      return capture.captureSilhouetteImage(rotation, size);
    },

    projectImageToUvMap(imageDataUrl, rotation = null, uvMapSize = 1024) {
      return capture.projectImageToUvMap(imageDataUrl, rotation, uvMapSize);
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
      brushRing.setActive(active);
    },

    // Set lit/unlit without a user click — restores the persisted ui:{id}
    // value before the first mesh renders.
    setUnlit(v) {
      applyUnlit(!!v);
    },

    compositeLayersToCanvas(items) {
      return composer.compositeLayersToCanvas(items);
    },

    updateLayerTextures(entries, opts = {}) {
      composer.updateLayerTextures(entries, opts);
    },

    getStampCanvasDataUrl(layerId) {
      return paint.getStampCanvasDataUrl(layerId);
    },

    raycastHitAt(clientX, clientY) {
      return paint.raycastHitAt(clientX, clientY);
    },

    sampleMaskAtUv(entry, u, v) {
      return paint.sampleMaskAtUv(entry, u, v);
    },

    sampleStampAtUv(layerId, u, v) {
      return paint.sampleStampAtUv(layerId, u, v);
    },
    sampleStampColorAtUv(layerId, u, v) {
      return paint.sampleStampColorAtUv(layerId, u, v);
    },

    invalidateStampCanvas(layerId) {
      paint.invalidateStampCanvas(layerId);
    },

    bindLayerMask(layerId, texture) {
      paint.bindLayerMask(layerId, texture);
    },

    beginInpaint() {
      paint.beginInpaint();
    },

    endInpaint() {
      paint.endInpaint();
    },

    setInpaintMaskVisible(visible) {
      paint.setInpaintMaskVisible(visible);
    },

    uploadMaskImage(entry, bitmap) {
      paint.uploadMaskImage(entry, bitmap);
    },

    maskToDataURL(entry) {
      return paint.maskToDataURL(entry);
    },

    inpaintMaskToDataURL() {
      return paint.inpaintMaskToDataURL();
    },

    clearLayerMask(entry) {
      paint.clearLayerMask(entry);
    },

    clearInpaintMask() {
      paint.clearInpaintMask();
    },

    loadInpaintMask(bitmap) {
      paint.loadInpaintMask(bitmap);
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
    paint.disposeInpaintEntry();
    if (inpaintActiveRef.current) {
      paint.clearMaskTarget(paint.getInpaintEntry(), 0x000000);
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
        paint.disposeInpaintEntry();
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
