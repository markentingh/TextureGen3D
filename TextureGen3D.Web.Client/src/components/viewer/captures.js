import * as THREE from 'three';
import { createThumbScene, disposeThumbScene, generateAngleThumbnail } from '@/helpers/camera-angle';
import { createMaskDisplayMaterial, createUvProjectorMaterial } from './materials';

/**
 * captures — every "render the mesh/view to an image" method: thumbnails,
 * depth maps, composite/mask/silhouette captures, the stamp source capture,
 * and projective UV-map projection of a generated image.
 *
 * createCaptureTools(ctx) — ctx supplies the viewer's refs; everything is
 * read at call time so captures always see the live mesh/camera/materials.
 */
export function createCaptureTools(ctx) {
  const {
    rendererRef, cameraRef, currentMeshRef, sceneRef,
    unlitRef, inpaintActiveRef, inpaintVisibleRef, inpaintMaskRef,
  } = ctx;

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
    const c2 = canvas.getContext('2d');
    const img = c2.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4;
      img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
    }
    c2.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };

  const captureThumbnail = (size = 75, rotation = null) => {
    const mainCamera = cameraRef.current;
    const mesh = currentMeshRef.current;
    if (!mainCamera || !mesh) return null;

    // When a rotation is provided, delegate to the shared camera-angle helper
    if (rotation) {
      return generateAngleThumbnail(mesh, rotation, size);
    }

    // No rotation — match the main camera's current view direction.
    const tctx = createThumbScene(mesh, size);
    const { thumbRenderer, thumbScene, thumbCamera, maxDim } = tctx;

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
    disposeThumbScene(tctx);

    return dataUrl;
  };

  /**
   * Render a depth map of the mesh, shaped to match the distribution the
   * RefControl depth LoRA was trained on (DepthAnythingV2 maps of scene
   * images): subject sits in the mid-gray range rather than spanning the
   * full 0–255, and the background is a subtle far-field gradient instead
   * of pure-black void. Geometry depth is still exact — we only remap
   * values after the render.
   */
  const captureDepthMap = (size = 1024, rotation = null) => {
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
      const c2 = out.getContext('2d');
      c2.drawImage(hiddenCanvas, 0, 0);
      const img = c2.getImageData(0, 0, size, size);
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
      c2.putImageData(img, 0, 0);
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
  };

  /**
   * Render the mesh with its composite layer materials — unlit, white
   * background, no inpaint overlay — from the current camera view, or from
   * an arbitrary camera angle when `rotation` ({x,y,z} degrees) is given.
   * Uniforms are shared with the live materials: toggle, render
   * synchronously, restore — no frame ever shows the change.
   */
  const captureCompositeImage = (size = 1024, rotation = null) => {
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
  };

  /**
   * Render the raw inpaint mask on the mesh — white where painted, black
   * elsewhere, black background — from the current camera view.
   */
  const captureInpaintMaskImage = (size = 1024) => {
    const maskTex = inpaintMaskRef.current?.front?.texture;
    if (!maskTex) return null;
    return captureMeshViewImage(size, {
      clearColor: 0x000000,
      materialFor: () => createMaskDisplayMaterial(maskTex),
    });
  };

  /**
   * Render an arbitrary mask image on the mesh — white where painted, black
   * elsewhere, black background — from the given camera angle. Used by the
   * mirror flow to get the source layer's mask in screen space before it's
   * flipped and re-projected. Returns a PNG data URL (null on failure).
   */
  const captureMaskViewImage = (maskDataUrl, rotation = null, size = 1024) => {
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
          materialFor: () => createMaskDisplayMaterial(tex),
        });
        tex.dispose();
        resolve(dataUrl);
      };
      img.onerror = () => resolve(null);
      img.src = maskDataUrl;
    });
  };

  /**
   * Render the mesh silhouette — opaque white where the mesh is visible,
   * fully transparent background — from the given camera angle. Used by the
   * mirror flow to align a flipped layer image to the mesh's on-screen
   * shape before projection. Returns a PNG data URL (null on failure).
   */
  const captureSilhouetteImage = (rotation = null, size = 1024) => {
    return captureMeshViewImage(size, {
      rotation,
      clearColor: 0x000000,
      clearAlpha: 0,
      materialFor: () => new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide }),
    });
  };

  /**
   * Project a generated image onto the mesh UV map based on the camera angle.
   * Uses projective texturing (GPU shader) — renders the mesh in UV space and
   * for each UV fragment, computes the projected texture coordinate using the
   * projector camera's matrices and samples the generated image.
   * No CPU-side pixel painting, no quantization gaps.
   * Returns { uvMap, mask } PNG data URLs.
   */
  const projectImageToUvMap = (imageDataUrl, rotation = null, uvMapSize = 1024) => {
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
              child.material = createUvProjectorMaterial(projCamera, genTexture, uvMapSize);
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
                    x < uvMapSize - 1 && y < uvMapSize - 1 ? ((y + 1) * uvMapSize + (x - 1)) * 4 : -1,
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
      const c2 = canvas.getContext('2d');
      const img = c2.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      }
      c2.putImageData(img, 0, 0);
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

  return {
    captureMeshViewImage,
    captureThumbnail,
    captureDepthMap,
    captureCompositeImage,
    captureInpaintMaskImage,
    captureMaskViewImage,
    captureSilhouetteImage,
    projectImageToUvMap,
    captureStampView,
  };
}
