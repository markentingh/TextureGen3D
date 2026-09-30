import * as THREE from 'three';

/**
 * gizmos — the overlay navigation gizmo (Blender-style axis arrows +
 * free-tumble area) and the lighting gizmo (ring + lightbulb that orbits
 * the scene's directional light).
 *
 * Two separate overlay scenes: the axis scene renders with a camera synced
 * to the main camera's orientation; the ring scene renders with a fixed
 * camera so it never rotates. The light gizmo renders in a third scene to
 * the left of the nav gizmo via scissored viewports.
 *
 * createGizmoSystem(ctx) — ctx supplies the viewer's refs; all state is
 * read/written through them so the component and the engine share it.
 * Internal-only temps live in the factory closure.
 */
export function createGizmoSystem(ctx) {
  const {
    rendererRef, cameraRef, controlsRef, currentMeshRef,
    raycasterRef, hoveredRingRef, gizmoInteractionRef,
    gizmoSceneRef, gizmoRingSceneRef, gizmoCameraRef, gizmoRingCameraRef,
    gizmoRingsRef, gizmoAxisLinesRef, gizmoPickArrayRef,
    gizmoOrbitRingRef, gizmoFreeSphereRef, gizmoSizeRef,
    lightGizmoSceneRef, lightGizmoCameraRef, lightGizmoRenderCamRef,
    lightGizmoRingRef, lightGizmoIconRef, lightGizmoFillRef, lightGizmoSizeRef,
    dirLight1Ref,
  } = ctx;

  // Internal state — was effect-local; lives here now
  const pickNDC = new THREE.Vector2();
  const lightPickArray = [null, null, null];
  const freeSpherePickArray = [null];
  const animTmpDir = new THREE.Vector3();
  const animTmpCamDir = new THREE.Vector3();
  const lastGizmoQuat = new THREE.Quaternion();
  const lastGizmoUp = new THREE.Vector3();
  const lastBulbPos = new THREE.Vector3();
  // Forces a shade recompute (e.g. when a hover ends — baseOpacity isn't the
  // computed shade for back-facing sprites)
  let gizmoSyncDirty = true;

  // Temps for the drag math
  const freeWorldY = new THREE.Vector3(0, 1, 0);
  const freeTmpQuatY = new THREE.Quaternion();
  const freeTmpQuatX = new THREE.Quaternion();
  const freeTmpOffset = new THREE.Vector3();
  const freeTmpUp = new THREE.Vector3();
  const freeTmpForward = new THREE.Vector3();
  const freeTmpRight = new THREE.Vector3();
  const lightTmpPos = new THREE.Vector3();
  const lightTmpQuat = new THREE.Quaternion();
  const axisTmpTarget = new THREE.Vector3();
  const axisTmpOffset = new THREE.Vector3();
  const axisTmpQuat = new THREE.Quaternion();

  // ── Scene construction ────────────────────────────────────────────────

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
    const c2 = canvas.getContext('2d');
    // Solid filled circle (no outline)
    c2.fillStyle = color;
    c2.beginPath();
    c2.arc(64, 64, 44, 0, Math.PI * 2);
    c2.fill();
    // Label text
    c2.fillStyle = '#ffffff';
    c2.font = 'bold 44px sans-serif';
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.fillText(label, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  };

  const build = () => {
    // Blender convention: Z is up (blue), Y is forward (green), X is right (red).
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

    const axisDefs = [
      { dir: new THREE.Vector3(1, 0, 0), color: '#ff0000', label: 'X' },    // red — right
      { dir: new THREE.Vector3(-1, 0, 0), color: '#ff0000', label: '-X' },  // red — left
      { dir: new THREE.Vector3(0, 0, 1), color: '#008000', label: 'Y' },    // green — forward
      { dir: new THREE.Vector3(0, 0, -1), color: '#008000', label: '-Y' },  // green — back
      { dir: new THREE.Vector3(0, 1, 0), color: '#0000ff', label: 'Z' },    // blue — up
      { dir: new THREE.Vector3(0, -1, 0), color: '#0000ff', label: '-Z' },  // blue — down
    ];

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
    gizmoSyncDirty = true;
  };

  const makeLightbulbTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const c2 = canvas.getContext('2d');
    c2.fillStyle = '#ffcc00';
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.font = '80px "Material Symbols Rounded"';
    // light_mode — sun with rays icon
    c2.fillText('light_mode', 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  };

  const buildLight = () => {
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

    // Ensure the Material Symbols font is loaded before creating the texture,
    // then update the texture once the font is ready.
    const bulbTex = makeLightbulbTexture();
    if (document.fonts && document.fonts.load) {
      document.fonts.load('80px "Material Symbols Rounded"').then(() => {
        // Re-render the texture with the loaded font
        const canvas = bulbTex.image;
        const c2 = canvas.getContext('2d');
        c2.clearRect(0, 0, 128, 128);
        c2.fillStyle = '#ffcc00';
        c2.textAlign = 'center';
        c2.textBaseline = 'middle';
        c2.font = '80px "Material Symbols Rounded"';
        c2.fillText('light_mode', 64, 64);
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
  };

  // ── Per-frame sync (called from the animation loop) ───────────────────

  const syncFrame = () => {
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
  };

  // Scissored overlay renders — nav gizmo top-right, light gizmo to its
  // left (half size, centered). autoClear is off globally so overlay renders
  // don't wipe the main scene's color buffer.
  const renderOverlays = (w, h) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const gs = gizmoSizeRef.current;

    // Shifted down-left by 12px padding so the larger ring doesn't bleed off the edge
    const pad = 12;
    renderer.setScissorTest(true);
    renderer.setViewport(w - gs - pad, h - gs - pad, gs, gs);
    renderer.setScissor(w - gs - pad, h - gs - pad, gs, gs);
    renderer.clearDepth();

    // Axis arrows with the camera-synced gizmo camera.
    renderer.render(gizmoSceneRef.current, gizmoCameraRef.current);

    // Orbit ring + free sphere with the fixed ring camera (so the white
    // circle never rotates — always faces the viewer)
    renderer.clearDepth();
    renderer.render(gizmoRingSceneRef.current, gizmoRingCameraRef.current);

    // Lighting gizmo to the left of the navigation gizmo (half size, centered)
    const lgs = lightGizmoSizeRef.current;
    const lgGap = 32; // 2em gap between the two gizmos
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

  // ── Picking ───────────────────────────────────────────────────────────

  const getGizmoNDC = (e) => {
    const rect = ctx.getCanvasRect();
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
    const rect = ctx.getCanvasRect();
    const gs = gizmoSizeRef.current;
    const pad = 12;
    return e.clientX >= rect.right - gs - pad && e.clientX <= rect.right - pad &&
           e.clientY >= rect.top + pad && e.clientY <= rect.top + gs + pad;
  };

  // Lighting gizmo region (left of the navigation gizmo, half size, centered)
  const getLightGizmoNDC = (e) => {
    const rect = ctx.getCanvasRect();
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
    const rect = ctx.getCanvasRect();
    const gs = gizmoSizeRef.current;
    const lgs = lightGizmoSizeRef.current;
    const pad = 12;
    const gap = 32; // 2em gap between the two gizmos
    const lgY = rect.top + pad + (gs - lgs) / 2;
    const lx = rect.right - gs - pad - lgs - gap;
    return e.clientX >= lx && e.clientX <= lx + lgs &&
           e.clientY >= lgY && e.clientY <= lgY + lgs;
  };

  const pick = (e) => {
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

  // ── Hover ─────────────────────────────────────────────────────────────

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

  // ── Drag ──────────────────────────────────────────────────────────────

  // Start a drag for all types. For axis, a quick click (no significant
  // move) snaps the view on pointerup.
  const beginDrag = (hit, e) => {
    const type = hit.userData.type;
    const rect = ctx.getCanvasRect();
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

  const drag = (e) => {
    const { type, dir, startX, startY, lastX, lastY, startUp, startOffset, totalQuat } = gizmoInteractionRef.current;
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
  };

  const endDrag = () => {
    const { type, dir, moved } = gizmoInteractionRef.current;
    // If it was an axis click (not a drag), snap the view
    if (type === 'axis' && !moved && dir) {
      snapViewToAxis(dir);
    }
    gizmoInteractionRef.current = null;
    controlsRef.current.enabled = true;
    rendererRef.current.domElement.style.cursor = '';
  };

  // ── Cleanup ───────────────────────────────────────────────────────────

  const dispose = () => {
    // Gizmo axis scene (including sprite textures)
    gizmoSceneRef.current?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    gizmoRingSceneRef.current?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    lightGizmoSceneRef.current?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
  };

  return { build, buildLight, syncFrame, renderOverlays, pick, applyHover, snapViewToAxis, beginDrag, drag, endDrag, dispose };
}
