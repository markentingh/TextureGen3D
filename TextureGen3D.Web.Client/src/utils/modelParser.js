/**
 * 3D Model Parser Utilities
 *
 * Extracts mesh objects and UV maps from various 3D file formats
 * using Three.js loaders. Each format has its own parser method,
 * and a unified `parseModel` dispatcher selects the right one
 * based on the file extension.
 *
 * Supported formats:
 *   .fbx  - FBXLoader
 *   .obj  - OBJLoader
 *   .stl  - STLLoader
 *   .ply  - PLYLoader
 *   .usd  - USDZLoader (best-effort for USD/USDZ)
 *   .abc  - Not supported in-browser (Alembic requires native libs)
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';

/**
 * Represents a single extracted mesh with its metadata.
 * @typedef {Object} ExtractedMesh
 * @property {string} name - Mesh name (falls back to "Unnamed Mesh N")
 * @property {number} triangles - Triangle count
 * @property {number} vertices - Vertex count
 * @property {string[]} uvMaps - Names of UV attribute layers present (e.g. ["uv", "uv2"])
 * @property {Object} boundingBox - Min/max bounds { min: [x,y,z], max: [x,y,z] }
 * @property {string[]} materials - Material names applied to this mesh
 */

/**
 * Result of parsing a 3D model file.
 * @typedef {Object} ParseResult
 * @property {ExtractedMesh[]} meshes - All extracted meshes
 * @property {number} totalTriangles - Sum of all mesh triangles
 * @property {number} totalVertices - Sum of all mesh vertices
 * @property {string} format - The detected format
 * @property {string[]} warnings - Non-fatal warnings encountered during parsing
 */

// ─── Per-format parsers ───────────────────────────────────────────

/**
 * Parse an FBX file buffer and extract meshes.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ParseResult>}
 */
export async function parseFBX(buffer) {
  const loader = new FBXLoader();
  const object = loader.parse(buffer, '');
  return extractMeshesFromObject(object, 'fbx');
}

/**
 * Parse an OBJ file buffer and extract meshes.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ParseResult>}
 */
export async function parseOBJ(buffer) {
  const loader = new OBJLoader();
  const text = bufferToText(buffer);
  const object = loader.parse(text);
  return extractMeshesFromObject(object, 'obj');
}

/**
 * Parse an STL file buffer and extract meshes.
 * STL produces a single non-indexed mesh.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ParseResult>}
 */
export async function parseSTL(buffer) {
  const loader = new STLLoader();
  const geometry = loader.parse(buffer);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'STL Mesh';
  return extractMeshesFromObject(mesh, 'stl');
}

/**
 * Parse a PLY file buffer and extract meshes.
 * PLY can produce a mesh or a points object.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ParseResult>}
 */
export async function parsePLY(buffer) {
  const loader = new PLYLoader();
  const geometry = loader.parse(buffer);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }));
  mesh.name = 'PLY Mesh';
  return extractMeshesFromObject(mesh, 'ply');
}

/**
 * Parse a USD/USDZ file buffer and extract meshes.
 * Uses USDZLoader which internally treats the buffer as a zip.
 * Raw USD (non-zipped) is not supported by the browser loader.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ParseResult>}
 */
export async function parseUSD(buffer) {
  const loader = new USDZLoader();
  const result = loader.parse(buffer);
  return extractMeshesFromObject(result, 'usd');
}

/**
 * Parse an Alembic (.abc) file buffer.
 * Alembic requires native C++ libraries (Alembic SDK) and cannot
 * be parsed in a browser environment. This method throws a clear
 * error so the UI can display a helpful message.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ParseResult>}
 */
export async function parseABC(buffer) {
  throw new Error(
    'Alembic (.abc) files cannot be parsed in the browser. ' +
    'Alembic requires the native Alembic C++ SDK. ' +
    'Please convert to FBX, OBJ, or USD before uploading.'
  );
}

// ─── Dispatcher ───────────────────────────────────────────────────

/**
 * Parse a 3D model file by dispatching to the correct format parser
 * based on the file extension.
 * @param {string} filename - The original filename (used to detect format)
 * @param {ArrayBuffer} buffer - The raw file data
 * @returns {Promise<ParseResult>}
 */
export async function parseModel(filename, buffer) {
  const ext = filename.split('.').pop().toLowerCase();

  switch (ext) {
    case 'fbx':
      return parseFBX(buffer);
    case 'obj':
      return parseOBJ(buffer);
    case 'stl':
      return parseSTL(buffer);
    case 'ply':
      return parsePLY(buffer);
    case 'usd':
    case 'usda':
    case 'usdc':
    case 'usdz':
      return parseUSD(buffer);
    case 'abc':
      return parseABC(buffer);
    default:
      throw new Error(`Unsupported file format: .${ext}`);
  }
}

// ─── Mesh extraction core ─────────────────────────────────────────

/**
 * Traverse a Three.js object/scene graph and extract mesh metadata.
 *
 * @param {THREE.Object3D} root - The root object from a loader
 * @param {string} format - The source format name
 * @returns {ParseResult}
 */
function extractMeshesFromObject(root, format) {
  const meshes = [];
  const warnings = [];
  let unnamedCounter = 0;

  root.traverse((child) => {
    if (!child.isMesh) return;

    const geometry = child.geometry;
    if (!geometry) return;

    // Triangle count: indexed geometry uses index count / 3,
    // non-indexed geometry uses position attribute count / 3.
    let triangles = 0;
    let vertices = 0;

    if (geometry.index) {
      triangles = Math.floor(geometry.index.count / 3);
    } else if (geometry.attributes.position) {
      triangles = Math.floor(geometry.attributes.position.count / 3);
    }

    if (geometry.attributes.position) {
      vertices = geometry.attributes.position.count;
    }

    // UV maps: check for uv, uv1, uv2, uv3, etc.
    const uvMaps = [];
    const uvAttributes = ['uv', 'uv1', 'uv2', 'uv3', 'uv4'];
    for (const uvName of uvAttributes) {
      if (geometry.attributes[uvName]) {
        uvMaps.push(uvName === 'uv1' ? 'uv' : uvName);
      }
    }
    // Also check for any custom attributes that look like UVs
    for (const attrName of Object.keys(geometry.attributes)) {
      if (attrName.startsWith('uv') && !uvAttributes.includes(attrName)) {
        uvMaps.push(attrName);
      }
    }

    if (uvMaps.length === 0) {
      warnings.push(`Mesh "${child.name || 'Unnamed'}" has no UV maps.`);
    }

    // Bounding box
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const boundingBox = box
      ? {
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z],
        }
      : null;

    // Materials
    const materials = [];
    if (child.material) {
      if (Array.isArray(child.material)) {
        for (const mat of child.material) {
          materials.push(mat.name || 'Unnamed Material');
        }
      } else {
        materials.push(child.material.name || 'Unnamed Material');
      }
    }

    // Mesh name
    const name = child.name || `Unnamed Mesh ${++unnamedCounter}`;

    meshes.push({
      name,
      triangles,
      vertices,
      uvMaps,
      boundingBox,
      materials,
      // Reference to the live Three.js mesh object for rendering
      object: child,
    });
  });

  const totalTriangles = meshes.reduce((sum, m) => sum + m.triangles, 0);
  const totalVertices = meshes.reduce((sum, m) => sum + m.vertices, 0);

  return {
    meshes,
    totalTriangles,
    totalVertices,
    format,
    warnings,
    // The root Three.js object — use for scene disposal / full-model rendering
    root,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Serialize a Three.js mesh's geometry into a JSON-compatible string
 * containing vertices (position array), faces (index array), and normals.
 * This is the MeshData stored in the database.
 * @param {THREE.Mesh} mesh
 * @returns {string} JSON string
 */
export function serializeMeshData(mesh) {
  const geometry = mesh.geometry;
  if (!geometry) return JSON.stringify({});

  const data = {};

  // Positions (vertices)
  if (geometry.attributes.position) {
    data.positions = Array.from(geometry.attributes.position.array);
  }

  // Indices (faces)
  if (geometry.index) {
    data.indices = Array.from(geometry.index.array);
  }

  // Normals
  if (geometry.attributes.normal) {
    data.normals = Array.from(geometry.attributes.normal.array);
  }

  return JSON.stringify(data);
}

/**
 * Serialize UV map data from a Three.js mesh's geometry.
 * Returns a JSON string array of UV map objects.
 * @param {THREE.Mesh} mesh
 * @returns {string} JSON string
 */
export function serializeUVMapData(mesh) {
  const geometry = mesh.geometry;
  if (!geometry) return JSON.stringify([]);

  const uvMaps = [];
  const uvAttributes = ['uv', 'uv1', 'uv2', 'uv3', 'uv4'];
  for (const uvName of uvAttributes) {
    if (geometry.attributes[uvName]) {
      uvMaps.push({
        name: uvName === 'uv1' ? 'uv' : uvName,
        data: Array.from(geometry.attributes[uvName].array),
      });
    }
  }
  // Also check for any custom UV attributes
  for (const attrName of Object.keys(geometry.attributes)) {
    if (attrName.startsWith('uv') && !uvAttributes.includes(attrName)) {
      uvMaps.push({
        name: attrName,
        data: Array.from(geometry.attributes[attrName].array),
      });
    }
  }

  return JSON.stringify(uvMaps);
}

/**
 * Deserialize mesh data JSON back into a Three.js BufferGeometry.
 * @param {string} meshDataJson
 * @returns {THREE.BufferGeometry}
 */
export function deserializeMeshData(meshDataJson) {
  const data = JSON.parse(meshDataJson);
  const geometry = new THREE.BufferGeometry();

  if (data.positions) {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  }
  if (data.indices) {
    geometry.setIndex(data.indices);
  }
  if (data.normals) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

/**
 * Deserialize UV map data JSON back into an array of {name, data} objects.
 * @param {string} uvMapDataJson
 * @returns {Array<{name: string, data: number[]}>}
 */
export function deserializeUVMapData(uvMapDataJson) {
  try {
    return JSON.parse(uvMapDataJson);
  } catch {
    return [];
  }
}

/**
 * Convert an ArrayBuffer to a UTF-8 string (for text-based formats like OBJ).
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function bufferToText(buffer) {
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(buffer);
}

/**
 * Format a triangle count for display (e.g. 12,345 → "12.3K").
 * @param {number} count
 * @returns {string}
 */
export function formatTriangleCount(count) {
  if (count < 1000) return count.toString();
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}
