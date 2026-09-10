import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
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
const ModelViewer = forwardRef(function ModelViewer({ selectedMesh }, ref) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const currentMeshRef = useRef(null);
  const animationFrameRef = useRef(null);
  const gridRef = useRef(null);

  // Gizmo refs
  const gizmoSceneRef = useRef(null);       // axis scene (synced camera)
  const gizmoRingSceneRef = useRef(null);  // ring scene (fixed camera)
  const gizmoCameraRef = useRef(null);
  const gizmoRingCameraRef = useRef(null);
  const gizmoRingsRef = useRef([]); // axis cones
  const gizmoAxisLinesRef = useRef([]); // axis lines
  const gizmoOrbitRingRef = useRef(null);
  const gizmoFreeSphereRef = useRef(null);
  const gizmoSizeRef = useRef(110);
  const gizmoInteractionRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const hoveredRingRef = useRef(null);

  const [ready, setReady] = useState(false);

  // Initialize scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Main scene ──
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Grid helper — shown only when no mesh is loaded
    const grid = new THREE.GridHelper(20, 40, 0x444466, 0x333344);
    grid.material.opacity = 0.3;
    grid.material.transparent = true;
    grid.name = '__grid';
    scene.add(grid);
    gridRef.current = grid;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.001,
      10000
    );
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);
    camera.up.set(0, 1, 0);

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

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight2.position.set(-10, 5, -10);
    scene.add(dirLight2);

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.8;

    // Store main refs
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;

    // ── Gizmo (overlay) — Blender-style navigation gizmo ──
    // Z is up (blue), Y is forward (green), X is right (red) — Blender convention.
    // Two separate scenes: axisScene (synced with main camera) and ringScene (fixed).

    // Axis scene — arrows rotate to reflect the current view direction
    const axisScene = new THREE.Scene();
    const gizmoCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    gizmoCamera.position.set(0, 0, 10);
    gizmoCamera.lookAt(0, 0, 0);

    // Ring scene — rendered with a fixed camera so the white ring never rotates
    const ringScene = new THREE.Scene();
    const ringCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    ringCamera.position.set(0, 0, 10);
    ringCamera.lookAt(0, 0, 0);

    const axisLength = 1.1;
    const coneRadius = 0.16;
    const coneHeight = 0.45;
    const baseOpacity = 0.7;
    const hoverOpacity = 1.0;

    // Blender convention: Z up (blue), Y forward (green), X right (red)
    const axisDefs = [
      { dir: new THREE.Vector3(1, 0, 0), color: 0xef4444, label: 'X' },    // red — right
      { dir: new THREE.Vector3(-1, 0, 0), color: 0x991b1b, label: 'X-' },  // dark red — left
      { dir: new THREE.Vector3(0, 0, 1), color: 0x22c55e, label: 'Y' },    // green — forward
      { dir: new THREE.Vector3(0, 0, -1), color: 0x166534, label: 'Y-' },  // dark green — back
      { dir: new THREE.Vector3(0, 1, 0), color: 0x3b82f6, label: 'Z' },    // blue — up
      { dir: new THREE.Vector3(0, -1, 0), color: 0x1e3a8a, label: 'Z-' },  // dark blue — down
    ];

    // Helper: orient a cylinder/cone (default points +Y) along a given direction
    const orientAlong = (obj, dir) => {
      if (dir.x > 0) obj.rotation.z = -Math.PI / 2;       // +X
      else if (dir.x < 0) obj.rotation.z = Math.PI / 2;    // -X
      else if (dir.z > 0) obj.rotation.x = Math.PI / 2;    // +Z (forward)
      else if (dir.z < 0) obj.rotation.x = -Math.PI / 2;   // -Z (back)
      else if (dir.y > 0) { /* +Y up — no rotation needed */ }
      else if (dir.y < 0) obj.rotation.x = Math.PI;        // -Y down — flip
    };

    const axisCones = [];
    const axisLines = [];
    axisDefs.forEach((def) => {
      // Line (cylinder) from origin toward the axis
      const lineGeom = new THREE.CylinderGeometry(0.025, 0.025, axisLength, 8);
      const lineMat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: baseOpacity, depthTest: false });
      const line = new THREE.Mesh(lineGeom, lineMat);
      line.position.copy(def.dir).multiplyScalar(axisLength / 2);
      orientAlong(line, def.dir);
      line.renderOrder = 999;
      line.userData = { ...def, type: 'axis', baseOpacity, hoverOpacity };
      axisScene.add(line);
      axisLines.push(line);

      // Arrow cone at the end
      const coneGeom = new THREE.ConeGeometry(coneRadius, coneHeight, 20);
      const coneMat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: baseOpacity, depthTest: false });
      const cone = new THREE.Mesh(coneGeom, coneMat);
      cone.position.copy(def.dir).multiplyScalar(axisLength + coneHeight / 2);
      orientAlong(cone, def.dir);
      cone.renderOrder = 1000;
      cone.userData = { ...def, type: 'axis', baseOpacity, hoverOpacity };
      axisScene.add(cone);
      axisCones.push(cone);
    });

    // Center sphere
    const centerSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false })
    );
    centerSphere.renderOrder = 1001;
    centerSphere.userData = { type: 'center' };
    axisScene.add(centerSphere);

    // Outer white ring — always faces the viewer (in ringScene, rendered with fixed ringCamera)
    const orbitRingRadius = 1.55;
    const orbitRing = new THREE.Mesh(
      new THREE.TorusGeometry(orbitRingRadius, 0.04, 16, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthTest: false })
    );
    orbitRing.renderOrder = 998;
    orbitRing.userData = { type: 'orbit', baseOpacity: 0.5, hoverOpacity: 1.0, baseTube: 0.04, hoverTube: 0.07 };
    ringScene.add(orbitRing);

    // Inner free-tumble sphere (invisible, fills the area inside the ring)
    const freeSphere = new THREE.Mesh(
      new THREE.SphereGeometry(orbitRingRadius * 0.95, 32, 32),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    );
    freeSphere.renderOrder = 997;
    freeSphere.userData = { type: 'free' };
    ringScene.add(freeSphere);

    gizmoSceneRef.current = axisScene;
    gizmoRingSceneRef.current = ringScene;
    gizmoCameraRef.current = gizmoCamera;
    gizmoRingCameraRef.current = ringCamera;
    gizmoRingsRef.current = axisCones;
    gizmoAxisLinesRef.current = axisLines;
    gizmoOrbitRingRef.current = orbitRing;
    gizmoFreeSphereRef.current = freeSphere;

    setReady(true);

    // ── Animation loop ──
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      controls.update();

      // Sync gizmo axis orientation with main camera so the axis arrows reflect
      // the current view direction (like Blender's navigation gizmo).
      const mainCam = cameraRef.current;
      if (mainCam && gizmoCameraRef.current) {
        const dir = new THREE.Vector3();
        mainCam.getWorldDirection(dir);
        gizmoCameraRef.current.position.copy(dir).multiplyScalar(-10);
        gizmoCameraRef.current.up.copy(mainCam.up);
        gizmoCameraRef.current.lookAt(0, 0, 0);
      }

      const w = container.clientWidth;
      const h = container.clientHeight;
      const gs = gizmoSizeRef.current;

      // Clear and render main scene full screen
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.setScissor(0, 0, w, h);
      renderer.clear();
      renderer.render(scene, camera);

      // Render gizmo in top-right corner region (scissor + viewport)
      renderer.setScissorTest(true);
      renderer.setViewport(w - gs, h - gs, gs, gs);
      renderer.setScissor(w - gs, h - gs, gs, gs);
      renderer.clearDepth();

      // Render axis arrows with the camera-synced gizmo camera
      renderer.render(gizmoSceneRef.current, gizmoCameraRef.current);

      // Render the orbit ring + free sphere with the fixed ring camera
      // (so the white circle never rotates — always faces the viewer)
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(gizmoRingSceneRef.current, gizmoRingCameraRef.current);
      renderer.autoClear = true;

      renderer.setScissorTest(false);
    };
    animate();

    // ── Resize handler ──
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // ── Gizmo interaction ──
    const getGizmoNDC = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const gs = gizmoSizeRef.current;
      // Gizmo region: top-right, from (w-gs, 0) to (w, gs) in screen coords
      const gx = rect.right - gs;
      const gy = rect.top; // top of canvas
      const ndc = new THREE.Vector2(
        ((e.clientX - gx) / gs) * 2 - 1,
        -((e.clientY - gy) / gs) * 2 + 1
      );
      return ndc;
    };

    const isPointInGizmoRegion = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const gs = gizmoSizeRef.current;
      return e.clientX >= rect.right - gs && e.clientX <= rect.right &&
             e.clientY >= rect.top && e.clientY <= rect.top + gs;
    };

    const pickGizmo = (e) => {
      if (!isPointInGizmoRegion(e)) return null;
      const ndc = getGizmoNDC(e);
      // Pick axis cones with the synced gizmo camera
      raycasterRef.current.setFromCamera(ndc, gizmoCameraRef.current);
      const axisIntersects = raycasterRef.current.intersectObjects([...gizmoRingsRef.current, ...gizmoAxisLinesRef.current], false);
      if (axisIntersects.length > 0) return axisIntersects[0].object;
      // Pick orbit ring + free sphere with the fixed ring camera
      raycasterRef.current.setFromCamera(ndc, gizmoRingCameraRef.current);
      const ringIntersects = raycasterRef.current.intersectObjects([gizmoOrbitRingRef.current, gizmoFreeSphereRef.current], false);
      return ringIntersects.length > 0 ? ringIntersects[0].object : null;
    };

    const setRingThickness = (ring, tube) => {
      if (!ring || !ring.geometry) return;
      const currentRadius = ring.geometry.parameters.radius;
      ring.geometry.dispose();
      ring.geometry = new THREE.TorusGeometry(currentRadius, tube, 16, 64);
    };

    const applyHover = (obj) => {
      // Reset previous hover
      if (hoveredRingRef.current) {
        const prev = hoveredRingRef.current;
        if (prev.userData.type === 'orbit') {
          setRingThickness(prev, prev.userData.baseTube);
          prev.material.opacity = prev.userData.baseOpacity;
        } else if (prev.userData.type === 'axis') {
          prev.material.opacity = prev.userData.baseOpacity;
          // Also reset the corresponding line
          const line = gizmoAxisLinesRef.current.find((l) => l.userData.label === prev.userData.label);
          if (line) line.material.opacity = line.userData.baseOpacity;
        }
      }
      hoveredRingRef.current = obj;
      if (obj) {
        if (obj.userData.type === 'orbit') {
          setRingThickness(obj, obj.userData.hoverTube);
          obj.material.opacity = obj.userData.hoverOpacity;
        } else if (obj.userData.type === 'axis') {
          obj.material.opacity = obj.userData.hoverOpacity;
          // Also brighten the corresponding line
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
      const cx = rect.right - gs / 2;
      const cy = rect.top + gs / 2;
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
      };

      // Disable orbit controls while dragging gizmo
      controlsRef.current.enabled = false;
    };

    const handlePointerMove = (e) => {
      if (gizmoInteractionRef.current) {
        // Dragging
        const { type, dir, startAngle, startX, startY, lastX, lastY } = gizmoInteractionRef.current;
        const mainCam = cameraRef.current;
        const mainControls = controlsRef.current;
        if (!mainCam || !mainControls) return;

        // Track if the pointer moved enough to count as a drag (not a click)
        const totalMove = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (totalMove > 4) {
          gizmoInteractionRef.current.moved = true;
        }

        const target = mainControls.target.clone();
        const offset = mainCam.position.clone().sub(target);

        if (type === 'axis') {
          // Dial approach: measure the absolute angle of the mouse around the
          // gizmo center using atan2, then take the delta from the previous frame.
          const rect = renderer.domElement.getBoundingClientRect();
          const gs = gizmoSizeRef.current;
          const cx = rect.right - gs / 2;
          const cy = rect.top + gs / 2;
          const currentAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
          const prevAngle = gizmoInteractionRef.current.lastAngle;
          let deltaAngle = currentAngle - prevAngle;
          // Wrap to [-PI, PI] for smooth crossing of the ±PI boundary
          while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
          while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;

          const quat = new THREE.Quaternion().setFromAxisAngle(dir.clone(), deltaAngle);
          // Rotate both the camera position offset AND the up vector together
          // so the view doesn't flip when rotating around X or Y axes.
          offset.applyQuaternion(quat);
          mainCam.up.applyQuaternion(quat);
          mainCam.position.copy(target).add(offset);
          mainCam.lookAt(target);
          mainControls.update();
          gizmoInteractionRef.current.lastAngle = currentAngle;
        } else if (type === 'orbit') {
          // Outer ring: orbit camera around world Z (up axis — yaw)
          const rect = renderer.domElement.getBoundingClientRect();
          const gs = gizmoSizeRef.current;
          const cx = rect.right - gs / 2;
          const cy = rect.top + gs / 2;
          const currentAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
          const deltaAngle = currentAngle - startAngle;
          const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deltaAngle);
          offset.applyQuaternion(quat);
          mainCam.position.copy(target).add(offset);
          mainCam.lookAt(target);
          mainControls.update();
          gizmoInteractionRef.current.startAngle = currentAngle;
        } else if (type === 'free') {
          // Inner area: free tumble (horizontal → Z yaw, vertical → X pitch)
          const dx = e.clientX - lastX;
          const dy = e.clientY - lastY;
          const quatY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.01);
          const quatX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.01);
          offset.applyQuaternion(quatY).applyQuaternion(quatX);
          mainCam.position.copy(target).add(offset);
          mainCam.lookAt(target);
          mainControls.update();
          gizmoInteractionRef.current.lastX = e.clientX;
          gizmoInteractionRef.current.lastY = e.clientY;
        }
      } else {
        // Hover detection
        const hit = pickGizmo(e);
        if (hit && (hit.userData.type === 'axis' || hit.userData.type === 'orbit')) {
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
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      controls.dispose();
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
      // Dispose gizmo axis scene
      axisScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      // Dispose gizmo ring scene
      ringScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    };
  }, []);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    captureThumbnail(size = 75) {
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

      // Lights so the grey material is visible
      const ambient = new THREE.AmbientLight(0xffffff, 0.6);
      thumbScene.add(ambient);
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(5, 10, 7);
      thumbScene.add(dirLight);

      // Clone the mesh with grey material (no textures)
      const thumbMesh = mesh.clone(true);
      thumbMesh.traverse((child) => {
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
      thumbScene.add(thumbMesh);

      // Compute bounding box of the cloned mesh
      const box = new THREE.Box3().setFromObject(thumbMesh);
      const center = box.getCenter(new THREE.Vector3());
      const size3 = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;

      // Reposition the thumb mesh so its bounding box is centered at origin
      thumbMesh.position.sub(center);

      // Match the main camera's view direction and up vector
      const viewDir = new THREE.Vector3();
      mainCamera.getWorldDirection(viewDir);
      const distance = (maxDim / 2) / Math.tan((thumbCamera.fov * Math.PI / 180) / 2) * 1.4;
      thumbCamera.position.copy(viewDir.clone().multiplyScalar(-distance));
      thumbCamera.up.copy(mainCamera.up);
      thumbCamera.lookAt(0, 0, 0);
      thumbCamera.updateProjectionMatrix();

      // Render
      thumbRenderer.render(thumbScene, thumbCamera);
      const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);

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

    scene.add(mesh);

    // Position camera facing the front of the mesh (Y forward, Z up — Blender convention)
    const dist = 8;
    camera.position.set(0, -dist, dist * 0.5);
    camera.lookAt(0, 0, 0);
    camera.up.set(0, 1, 0);
    controls.target.set(0, 0, 0);
    controls.update();
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
      style={{ background: '#1a1a2e' }}
    />
  );
});

export default ModelViewer;
