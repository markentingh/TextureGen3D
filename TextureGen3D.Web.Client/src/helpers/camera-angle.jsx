import * as THREE from 'three';

/**
 * Create an offscreen thumbnail rendering setup: renderer, scene, orthographic
 * camera, lights, and a cloned mesh centered at the origin with MeshNormalMaterial.
 * The caller is responsible for positioning the camera and calling renderThumbScene
 * + disposeThumbScene when done.
 *
 * @param {THREE.Object3D} meshObject - the mesh to clone for rendering
 * @param {number} [size=75] - thumbnail dimensions in pixels
 * @returns {object} { thumbRenderer, thumbScene, thumbCamera, thumbMesh, maxDim }
 */
export function createThumbScene(meshObject, size = 75) {
  const thumbRenderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  thumbRenderer.setPixelRatio(window.devicePixelRatio);
  thumbRenderer.setSize(size, size);
  thumbRenderer.setClearColor(0x000000, 0);

  const thumbScene = new THREE.Scene();
  thumbScene.background = null;
  const thumbCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);

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

  const thumbMesh = meshObject.clone(true);
  thumbMesh.traverse((child) => {
    if (child.isMesh) {
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
      child.material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    }
  });
  thumbScene.add(thumbMesh);

  const box = new THREE.Box3().setFromObject(thumbMesh);
  const center = box.getCenter(new THREE.Vector3());
  const size3 = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;
  thumbMesh.position.sub(center);

  // Set the orthographic frustum to fit the mesh bounding box (with padding).
  // For ortho, the frustum size — not distance — determines what's visible.
  const frustumHalf = (maxDim / 2) * 1.4;
  thumbCamera.left = -frustumHalf;
  thumbCamera.right = frustumHalf;
  thumbCamera.top = frustumHalf;
  thumbCamera.bottom = -frustumHalf;
  thumbCamera.updateProjectionMatrix();

  return { thumbRenderer, thumbScene, thumbCamera, thumbMesh, maxDim };
}

/**
 * Position the thumb camera for a given rotation and render one frame.
 *
 * @param {object} ctx - { thumbRenderer, thumbScene, thumbCamera, maxDim }
 * @param {object} rotation - { x, y, z } in degrees
 */
export function renderAngleThumbnail(ctx, rotation) {
  const { thumbRenderer, thumbScene, thumbCamera, maxDim } = ctx;
  thumbCamera.rotation.set(
    THREE.MathUtils.degToRad(rotation.x || 0),
    THREE.MathUtils.degToRad(rotation.y || 0),
    THREE.MathUtils.degToRad(rotation.z || 0),
  );
  thumbCamera.updateMatrixWorld();
  // Distance just needs to be far enough that near/far planes contain the mesh.
  const distance = maxDim * 2;
  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyQuaternion(thumbCamera.quaternion);
  thumbCamera.position.copy(forward).multiplyScalar(-distance);
  thumbCamera.updateProjectionMatrix();
  thumbRenderer.clear();
  thumbRenderer.render(thumbScene, thumbCamera);
  return thumbRenderer.domElement.toDataURL('image/png');
}

/**
 * Dispose all Three.js resources in a thumbnail scene.
 *
 * @param {object} ctx - { thumbRenderer, thumbScene }
 */
export function disposeThumbScene(ctx) {
  const { thumbRenderer, thumbScene } = ctx;
  thumbScene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
  thumbRenderer.dispose();
  thumbRenderer.forceContextLoss();
}

/**
 * Generate thumbnail data URLs for a set of camera angles by rendering the
 * mesh from each angle's rotation using an orthographic camera (matching the
 * main viewport projection).
 *
 * @param {object} mesh  - mesh object with an `object` property (THREE.Object3D)
 * @param {Array}  angles - array of angle records, each with a `rotation` JSON string
 * @param {number} [size=75] - thumbnail dimensions in pixels
 * @returns {Promise<string[]>} array of data URLs (PNG), one per angle
 */
export async function generateAngleThumbnails(mesh, angles, size = 75) {
  if (!mesh?.object || angles.length === 0) return [];

  const ctx = createThumbScene(mesh.object, size);
  const thumbnails = [];
  for (const angle of angles) {
    const rotation = JSON.parse(angle.rotation || '{}');
    thumbnails.push(renderAngleThumbnail(ctx, rotation));
  }
  disposeThumbScene(ctx);

  return thumbnails;
}

/**
 * Generate a single thumbnail for a mesh from a given rotation, using an
 * orthographic camera (matching the main viewport projection).
 *
 * @param {THREE.Object3D} meshObject - the mesh to render
 * @param {object} rotation - { x, y, z } in degrees
 * @param {number} [size=75] - thumbnail dimensions in pixels
 * @returns {string|null} PNG data URL, or null if meshObject is falsy
 */
export function generateAngleThumbnail(meshObject, rotation, size = 75) {
  if (!meshObject) return null;

  const ctx = createThumbScene(meshObject, size);
  const dataUrl = renderAngleThumbnail(ctx, rotation);
  disposeThumbScene(ctx);

  return dataUrl;
}
