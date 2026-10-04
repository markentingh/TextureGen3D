import * as THREE from 'three';
import {
  makeGreyMeshMaterial,
  LAYER_VERTEX_SHADER,
  LAYER_COMBINED_FRAGMENT,
  buildLiveLayerFragment,
} from './materials';
import {
  compositeLayerImages,
  imageDataToLayerTexture,
  loadLiveLayerTexture,
} from './layerImages';

/**
 * layerComposer — builds the mesh's composite material from the layer
 * stack. Non-selected layers bake into combined CPU textures (one per
 * contiguous run); selected/paint-target layers get live layerN/maskN
 * sampler slots so strokes render in real time.
 *
 * createLayerComposer(ctx) — ctx supplies the viewer's refs.
 */
export function createLayerComposer(ctx) {
  const {
    currentMeshRef, layerBuildIdRef, whiteMaskTexRef, emptyTexRef,
    checkerTexRef, layerGpuRef, stampTexRef, shaderLayerIdsRef,
    dirLight1Ref, unlitRef, inpaintActiveRef, inpaintMaskRef,
    inpaintTileTexRef, inpaintVisibleRef, shadowUniformsRef,
  } = ctx;

  const getWhiteTex = () => {
    if (!whiteMaskTexRef.current) {
      const data = new Uint8Array([255, 255, 255, 255]);
      whiteMaskTexRef.current = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      whiteMaskTexRef.current.needsUpdate = true;
    }
    return whiteMaskTexRef.current;
  };

  const getEmptyTex = () => {
    if (!emptyTexRef.current) {
      const data = new Uint8Array([0, 0, 0, 0]);
      emptyTexRef.current = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      emptyTexRef.current.needsUpdate = true;
    }
    return emptyTexRef.current;
  };

  /**
   * Composite layer images into a single canvas using the same math as the
   * on-mesh shader composite. items: [{ url, maskDataUrl }], ordered
   * top → bottom. Returns a canvas (or null when empty).
   */
  const compositeLayersToCanvas = (items) =>
    compositeLayerImages(items || []).then((r) => (r ? r.canvas : null));

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
  const updateLayerTextures = (entries, opts = {}) => {
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

    const white = getWhiteTex();
    // 1x1 transparent dummy — live slot for layers with no uvmap yet
    // (stamp targets); near-black rgb is treated as empty by the shader.
    getEmptyTex();

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
      // Shared entries — the viewer updates map/has once per frame and every
      // material referencing them sees the live shadow map + matrix.
      u_shadowMap: shadowUniformsRef.current.map,
      u_shadowMatrix: shadowUniformsRef.current.matrix,
      u_shadowBias: shadowUniformsRef.current.bias,
      u_shadowRadius: shadowUniformsRef.current.radius,
      u_hasShadow: shadowUniformsRef.current.has,
    });

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
              const comp = await compositeLayerImages(op.items);
              // DataTexture — canvas/PNG would zero the flooded a==0 rgb
              op.tex = comp ? { tex: imageDataToLayerTexture(comp.imgData), url: null } : null;
            } else {
              // Prefer the live stamp canvas over the file: it may hold
              // unsaved dabs, and keeping it bound across rebuilds avoids
              // flipping between the RT and a freshly loaded file texture.
              const stampTex = stampTexRef.current.get(op.item.layerId);
              if (stampTex) {
                op.tex = stampTex;
              } else if (op.item.url) {
                // Dilate hidden-texel rgb like the CPU bake so mipmapped
                // sampling can't pull dark rgb out of transparent texels.
                const t = await loadLiveLayerTexture(op.item);
                op.tex = t ? t.tex : emptyTexRef.current;
                op.texBlobUrl = t ? t.url : null;
              } else {
                // Empty paint target — transparent dummy until the first dab.
                op.tex = emptyTexRef.current;
              }
            }
          }));
          if (buildId !== layerBuildIdRef.current) { bail(); return; }

          for (const op of ops) {
            if (op.type === 'bake') {
              if (!op.tex) continue;
              gpu.textures.push(op.tex.tex);
              if (op.tex.url) gpu.blobUrls.push(op.tex.url);
            } else {
              gpu.textures.push(op.tex);
              if (op.texBlobUrl) gpu.blobUrls.push(op.texBlobUrl);
              // op.item.url is owned by the context's per-layer asset
              // cache — never revoke it here or the cache dangles.
            }
          }

          // Generate the fragment shader — one blend block per op so
          // interleaved selections keep their true z-order.
          const { fragmentShader: frag, slotFor } = buildLiveLayerFragment(ops);
          fragmentShader = frag;
          uniforms = { dir1Pos: { value: dir1Pos }, ...inpaintUniforms() };
          ops.forEach((op, i) => {
            const slot = slotFor[i];
            if (slot.kind === 'bake') {
              uniforms[`u_bake${slot.s}`] = { value: op.tex ? op.tex.tex : white };
              uniforms[`u_hasBake${slot.s}`] = { value: op.tex ? 1 : 0 };
            } else {
              uniforms[`layer${slot.s}`] = { value: op.tex };
              uniforms[`mask${slot.s}`] = { value: op.item.maskTexture || white };
              uniforms[`hasMask${slot.s}`] = { value: op.item.maskTexture ? 1 : 0 };
              layerIds.push(op.item.layerId);
            }
          });
        } else {
          const comp = await compositeLayerImages(items);
          if (buildId !== layerBuildIdRef.current) { bail(); return; }
          const combinedTex = comp ? imageDataToLayerTexture(comp.imgData) : null;
          if (!combinedTex) { setGreyMaterial(); return; }
          gpu.textures.push(combinedTex);

          uniforms = {
            u_combined: { value: combinedTex },
            u_hasCombined: { value: 1 },
            dir1Pos: { value: dir1Pos },
            ...inpaintUniforms(),
          };
          fragmentShader = LAYER_COMBINED_FRAGMENT;
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
            vertexShader: LAYER_VERTEX_SHADER,
            fragmentShader,
            side: THREE.DoubleSide,
          });
        }
      });
    })();
  };

  return { updateLayerTextures, compositeLayersToCanvas };
}
