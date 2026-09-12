import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
const ModelViewer = forwardRef(function ModelViewer({ selectedMesh, onMeshLoaded }, ref) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const currentMeshRef = useRef(null);
  const animationFrameRef = useRef(null);
  const gridRef = useRef(null);
  const orthoCameraRef = useRef(null);
  const onMeshLoadedRef = useRef(onMeshLoaded);
  useEffect(() => { onMeshLoadedRef.current = onMeshLoaded; });
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
  const lightGizmoSizeRef = useRef(70);

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

    // ── Animation loop ──
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      // Apply zoom-aware ortho frustum offset before controls.update() so
      // the projection matrix is correct when OrbitControls uses it.
      const orthoCam = orthoCameraRef.current;
      if (orthoCam && orthoCam.zoom !== lastOrthoZoomRef.current) {
        applyOrthoOffset(orthoCam);
      }

      controlsRef.current?.update();

      // Sync gizmo axis orientation with main camera so the axis arrows reflect
      // the current view direction (like Blender's navigation gizmo).
      const mainCam = cameraRef.current;
      if (mainCam && gizmoCameraRef.current) {
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
      const light = dirLight1Ref.current;
      const bulbIcon = lightGizmoIconRef.current;
      if (light && bulbIcon) {
        const lx = light.position.x;
        const lz = light.position.z;
        const len = Math.sqrt(lx * lx + lz * lz) || 1;
        const ringR = 1.9;
        bulbIcon.position.set((lx / len) * ringR, -(lz / len) * ringR, 0);
      }

      const w = container.clientWidth;
      const h = container.clientHeight;
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
    };
    window.addEventListener('resize', handleResize);

    // ── Gizmo interaction ──
    // Pre-allocated reusable objects to avoid per-pointermove allocations
    const pickNDC = new THREE.Vector2();
    const lightPickArray = [null, null, null]; // filled with refs at pick time
    const freeSpherePickArray = [null];

    const getGizmoNDC = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
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
      const rect = renderer.domElement.getBoundingClientRect();
      const gs = gizmoSizeRef.current;
      const pad = 12;
      return e.clientX >= rect.right - gs - pad && e.clientX <= rect.right - pad &&
             e.clientY >= rect.top + pad && e.clientY <= rect.top + gs + pad;
    };

    // Lighting gizmo region (left of the navigation gizmo, half size, centered)
    const getLightGizmoNDC = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
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
      const rect = renderer.domElement.getBoundingClientRect();
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

    const handlePointerDown = (e) => {
      const hit = pickGizmo(e);
      if (!hit) return;
      e.stopPropagation();
      e.preventDefault();

      const type = hit.userData.type;

      // Start a drag for all types. For axis, a quick click (no significant move)
      // will snap the view on pointerup.
      const rect = renderer.domElement.getBoundingClientRect();
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
        if (hit && (hit.userData.type === 'axis' || hit.userData.type === 'light')) {
          applyHover(hit);
          renderer.domElement.style.cursor = 'pointer';
        } else if (hit && hit.userData.type === 'free') {
          applyHover(null);
          renderer.domElement.style.cursor = 'grab';
        } else {
          applyHover(null);
          renderer.domElement.style.cursor = '';
        }
      }
    };

    const handlePointerUp = (e) => {
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

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    // ── Cleanup ──
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      controlsRef.current?.dispose();
      renderer.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
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
    };
  }, []);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    getCameraAngle() {
      const cam = cameraRef.current;
      if (!cam) return null;
      return {
        x: THREE.MathUtils.radToDeg(cam.rotation.x),
        y: THREE.MathUtils.radToDeg(cam.rotation.y),
        z: THREE.MathUtils.radToDeg(cam.rotation.z),
      };
    },
    captureThumbnail(size = 75, rotation = null) {
      const mainCamera = cameraRef.current;
      const mesh = currentMeshRef.current;
      if (!mainCamera || !mesh) return null;

      // Create a hidden offscreen renderer for the thumbnail
      const thumbRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      thumbRenderer.setPixelRatio(window.devicePixelRatio);
      thumbRenderer.setSize(size, size);
      thumbRenderer.setClearColor(0x000000, 0);

      // Hidden canvas (not attached to DOM)
      const thumbCanvas = thumbRenderer.domElement;
      thumbCanvas.style.display = 'none';

      // Thumbnail scene + camera
      const thumbScene = new THREE.Scene();
      const thumbCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

      // Lights so the grey material is visible — brighter, multi-directional
      const ambient = new THREE.AmbientLight(0xffffff, 1.0);
      thumbScene.add(ambient);
      const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
      dirLight1.position.set(5, 10, 7);
      thumbScene.add(dirLight1);
      const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight2.position.set(-5, -3, -7);
      thumbScene.add(dirLight2);
      const dirLight3 = new THREE.DirectionalLight(0xffffff, 0.5);
      dirLight3.position.set(0, -8, 5);
      thumbScene.add(dirLight3);

      // Clone the mesh with normal-map material
      const thumbMesh = mesh.clone(true);
      thumbMesh.traverse((child) => {
        if (child.isMesh) {
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
          child.material = new THREE.MeshNormalMaterial({
            side: THREE.DoubleSide,
          });
        }
      });
      thumbScene.add(thumbMesh);

      // Compute bounding box of the cloned mesh
      const box = new THREE.Box3().setFromObject(thumbMesh);
      const center = box.getCenter(new THREE.Vector3());
      const size3 = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;

      // Reposition the thumb mesh so its bounding box is centered at origin
      thumbMesh.position.sub(center);

      // Determine view direction: use explicit rotation if provided,
      // otherwise match the main camera's current view direction.
      const distance = (maxDim / 2) / Math.tan((thumbCamera.fov * Math.PI / 180) / 2) * 1.4;
      if (rotation) {
        // Apply the requested rotation to the thumb camera directly
        thumbCamera.rotation.set(
          THREE.MathUtils.degToRad(rotation.x || 0),
          THREE.MathUtils.degToRad(rotation.y || 0),
          THREE.MathUtils.degToRad(rotation.z || 0),
        );
        thumbCamera.updateMatrixWorld();
        const viewDir = new THREE.Vector3(0, 0, -1);
        viewDir.applyQuaternion(thumbCamera.quaternion);
        thumbCamera.position.copy(viewDir.clone().multiplyScalar(-distance));
        thumbCamera.up.set(0, 1, 0);
        thumbCamera.lookAt(0, 0, 0);
      } else {
        // Match the main camera's view direction and up vector
        const viewDir = new THREE.Vector3();
        mainCamera.getWorldDirection(viewDir);
        thumbCamera.position.copy(viewDir.clone().multiplyScalar(-distance));
        thumbCamera.up.copy(mainCamera.up);
        thumbCamera.lookAt(0, 0, 0);
      }
      thumbCamera.updateProjectionMatrix();

      // Render
      thumbRenderer.render(thumbScene, thumbCamera);
      const dataUrl = thumbCanvas.toDataURL('image/png');

      // Cleanup
      thumbScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      thumbRenderer.dispose();
      thumbRenderer.forceContextLoss();
      // Destroy the hidden canvas
      thumbCanvas.remove();
      thumbRenderer.domElement = null;

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
        antialias: false,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      depthRenderer.setPixelRatio(1);
      depthRenderer.setSize(size, size);
      depthRenderer.setClearColor(0x000000, 1);

      const depthScene = new THREE.Scene();
      depthScene.background = new THREE.Color(0x000000);

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
            side: THREE.DoubleSide,
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

      // Tighten near/far planes tightly around the mesh so depth values
      // span the full 0–1 range — brighter whites for near surfaces,
      // darker greys for far surfaces.
      depthCamera.near = camDistance - maxDim / 2 * 1.05;
      depthCamera.far = camDistance + maxDim / 2 * 1.05;
      depthCamera.updateProjectionMatrix();

      depthRenderer.render(depthScene, depthCamera);
      const dataUrl = hiddenCanvas.toDataURL('image/png');

      // Cleanup: dispose renderer, lose WebGL context, remove hidden canvas
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

      return dataUrl;
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
          try {
            console.log('[UVProject] Generated image loaded:', genImg.width, 'x', genImg.height);

            // Create the generated image texture — no color space conversion, pass RGB through directly
            const genTexture = new THREE.Texture(genImg);
            genTexture.needsUpdate = true;

            // Create a hidden canvas + dedicated renderer so the main canvas is untouched
            const hiddenCanvas = document.createElement('canvas');
            hiddenCanvas.width = uvMapSize;
            hiddenCanvas.height = uvMapSize;
            hiddenCanvas.style.display = 'none';
            document.body.appendChild(hiddenCanvas);

            const hiddenRenderer = new THREE.WebGLRenderer({
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

            const renderTarget = new THREE.WebGLRenderTarget(uvMapSize, uvMapSize, {
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
            const uvScene = new THREE.Scene();
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
                        gl_FragColor = vec4(texture2D(projTexture, uv).rgb, alpha);
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

            // Cleanup render target + UV scene + hidden renderer
            hiddenRenderer.setRenderTarget(null);
            uvScene.traverse((obj) => {
              if (obj.geometry) obj.geometry.dispose();
              if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
                else obj.material.dispose();
              }
            });
            genTexture.dispose();
            renderTarget.dispose();
            hiddenRenderer.dispose();
            hiddenRenderer.forceContextLoss();
            hiddenCanvas.remove();

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
            resolve(result);
          } catch (err) {
            console.error('[UVProject] Error:', err);
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
     * Update the mesh material to use combined UV map textures from layers.
     * @param {Array} uvMapUrls - Array of UV map data URLs ordered by layer index
     */
    updateLayerTextures(uvMapUrls) {
      const mesh = currentMeshRef.current;
      if (!mesh) return;

      // Load all UV map textures
      const loader = new THREE.TextureLoader();
      const textures = uvMapUrls.map((url) => {
        if (!url) return null;
        const tex = loader.load(url);
        tex.flipY = true; // canvas paints v=0 at bottom; flipY=true maps UV v=0 to canvas bottom
        return tex;
      });

      const validTextures = textures.filter((t) => t !== null);

      // No layers — restore the original grey MeshStandardMaterial
      if (validTextures.length === 0) {
        mesh.traverse((child) => {
          if (child.isMesh) {
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
              else child.material.dispose();
            }
            child.material = new THREE.MeshStandardMaterial({
              color: 0x9ca3af,
              metalness: 0.1,
              roughness: 0.8,
              side: THREE.DoubleSide,
            });
          }
        });
        return;
      }

      const layerCount = Math.min(validTextures.length, 16);

      // Collect the directional light position for the shader
      const dirLight1 = dirLight1Ref.current;
      const dir1Pos = dirLight1 ? dirLight1.position : new THREE.Vector3(10, 10, 10);

      // Build uniforms with one sampler2D per layer (up to 16) + light position
      const uniforms = {
        layerCount: { value: layerCount },
        dir1Pos: { value: dir1Pos },
      };
      for (let i = 0; i < layerCount; i++) {
        uniforms[`layer${i}`] = { value: validTextures[i] };
      }

      // Dynamically generate the fragment shader with exactly layerCount samplers + shadow lighting
      // Layers are applied in reverse order (highest index first, lowest index last)
      // so that lower-index layers appear on top of higher-index layers
      const layerIndices = Array.from({ length: layerCount }, (_, i) => layerCount - 1 - i);
      const fragmentShader = `
        uniform int layerCount;
        ${Array.from({ length: layerCount }, (_, i) => `uniform sampler2D layer${i};`).join('\n        ')}
        uniform vec3 dir1Pos;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vec4 color = vec4(0.0);
          ${layerIndices.map((i) => `
          {
            vec4 layerColor${i} = texture2D(layer${i}, vUv);
            float mask${i} = step(0.01, length(layerColor${i}.rgb));
            color.rgb = mix(color.rgb, layerColor${i}.rgb, mask${i} * layerColor${i}.a);
            color.a = max(color.a, layerColor${i}.a * mask${i});
          }`).join('')}
          if (color.a < 0.01) discard;

          // Shadow-only lighting: don't brighten the texture, only darken areas facing away from the light
          vec3 normal = normalize(vNormal);
          vec3 lightDir = normalize(dir1Pos - vWorldPos);
          float NdotL = dot(normal, lightDir);
          // Shadow factor: 1.0 (no shadow) when facing the light, 0.35 (dark) when facing away
          float shadow = mix(0.35, 1.0, clamp(NdotL * 0.5 + 0.5, 0.0, 1.0));

          gl_FragColor = vec4(color.rgb * shadow, color.a);
        }
      `;

      mesh.traverse((child) => {
        if (child.isMesh) {
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
          child.material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: `
              varying vec2 vUv;
              varying vec3 vNormal;
              varying vec3 vWorldPos;
              void main() {
                vUv = uv;
                vNormal = normalize(mat3(modelMatrix) * normal);
                vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `,
            fragmentShader,
            side: THREE.DoubleSide,
          });
        }
      });
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
        child.material = new THREE.MeshStandardMaterial({
          color: 0x9ca3af,
          metalness: 0.1,
          roughness: 0.8,
          side: THREE.DoubleSide,
        });
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
    />
  );
});

export default memo(ModelViewer);
