import * as THREE from 'three';

/**
 * materials — every THREE material / shader factory the viewer uses:
 *   - grey fallback mesh material (checkerboard backfaces)
 *   - the offscreen paint-RTT scene (mask paint, clone stamp, coverage,
 *     bleed, copy, alpha-fill)
 *   - mask display material (inpaint mask / arbitrary mask captures)
 *   - UV projective-texturing material (generated image → uvmap)
 *   - layer compositor shader strings + assembly
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
export function makeGreyMeshMaterial() {
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

/**
 * createPaintRtt — the lazily-built offscreen paint scene. The mesh is
 * rasterized flattened by its own UVs, so every fragment knows the exact 3D
 * world position of that texel — brush hits are evaluated by world-space
 * distance, which paints seamlessly across UV islands.
 *
 * Returns { scene, cam, mat, paintGroup, blitQuad, coverageMat, coverageRT,
 *           coverageMesh, bleedMat, bleedQuad, copyMat, copyQuad,
 *           stampColorMat, alphaFillMat, alphaFillQuad }.
 */
export function createPaintRtt() {
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

  // Alpha-keyed rgb spread: alpha-0 texels adopt the nearest colored
  // neighbor's rgb (alpha stays 0). "Colored" = a>0 content OR a texel
  // already filled by a previous pass — each pass expands ~1px, so
  // ping-ponging N times fills an Npx ring. Keeps filtered samples from
  // blending toward transparent-black at stroke/island edges on the
  // live-bound stamp texture.
  const alphaFillMat = new THREE.ShaderMaterial({
    uniforms: {
      u_base: { value: null },
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
      uniform float u_texelSize;
      varying vec2 vUv;
      void main() {
        vec4 self = texture2D(u_base, vUv);
        if (self.a > 0.0 || dot(self.rgb, self.rgb) > 1e-4) {
          gl_FragColor = self;
          return;
        }
        vec2 t = vec2(u_texelSize);
        for (int dy = -1; dy <= 1; dy++)
        for (int dx = -1; dx <= 1; dx++) {
          if (dx == 0 && dy == 0) continue;
          vec4 n = texture2D(u_base, vUv + vec2(float(dx), float(dy)) * t);
          if (n.a > 0.0 || dot(n.rgb, n.rgb) > 1e-4) {
            gl_FragColor = vec4(n.rgb, 0.0);
            return;
          }
        }
        gl_FragColor = self;
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const alphaFillQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), alphaFillMat);
  alphaFillQuad.frustumCulled = false;
  alphaFillQuad.visible = false;

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
      u_marginWorld: { value: 0.0 },         // color-park ring past brush edge (world units)
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
      uniform float u_marginWorld;
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
        // Just past the brush edge, park the captured color in hidden
        // (alpha-0) rgb. Texture filtering interpolates rgb regardless of
        // alpha — without this, a feathered stamp on a transparent region
        // blends toward transparent black and reads as a dark halo. The
        // margin is texel-sized (not screen-space) so it can't shrink
        // below the filter footprint at any zoom.
        if (outA <= 0.0 && src.a > 0.0 && d < u_brushRadius + u_marginWorld) {
          gl_FragColor = vec4(src.rgb, 0.0);
          return;
        }
        gl_FragColor = vec4(outRgb, outA);
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  // Blur tool — fullscreen multi-tap disc blur of a layer texture. 24-tap
  // spiral sampling inside u_radiusPx texels, weighted toward the center so
  // the kernel approximates a gaussian. Alpha is blurred too — softening
  // transparent edges is part of what a blur brush does.
  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      u_tex: { value: null },
      u_texelSize: { value: 1 / 1024 },
      u_radiusPx: { value: 8 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D u_tex;
      uniform float u_texelSize;
      uniform float u_radiusPx;
      varying vec2 vUv;
      void main() {
        vec4 acc = vec4(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 24; i++) {
          float t = float(i) / 24.0;
          float ang = t * 39.0;           // spiral offset per tap
          float r = sqrt(t);              // uniform disc distribution
          vec2 off = vec2(cos(ang), sin(ang)) * r * u_radiusPx * u_texelSize;
          float w = 1.0 - t * 0.5;        // center-weighted ≈ gaussian
          acc += texture2D(u_tex, vUv + off) * w;
          wsum += w;
        }
        gl_FragColor = acc / wsum;
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat);
  blurQuad.frustumCulled = false;
  blurQuad.visible = false;

  // Blur composite — writes through the flattened-UV rasterization so the
  // dab lands on the correct uvmap texels: out = mix(base, blurred, brush).
  const blurMixMat = new THREE.ShaderMaterial({
    uniforms: {
      u_baseTexture: { value: null },        // layer's current uvmap (front RT)
      u_blurTexture: { value: null },        // blurred copy of it (scratch RT)
      u_modelMatrix: { value: new THREE.Matrix4() },
      u_mouseWorldPos: { value: new THREE.Vector3() },
      u_brushRadius: { value: 0.1 },         // world units
      u_innerRadius: { value: 0.0 },         // hardness core
      u_brushStrength: { value: 1.0 },       // blur strength 0..1
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
      uniform sampler2D u_blurTexture;
      uniform vec3 u_mouseWorldPos;
      uniform float u_brushRadius;
      uniform float u_innerRadius;
      uniform float u_brushStrength;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vec4 prev = texture2D(u_baseTexture, vUv);
        vec4 blur = texture2D(u_blurTexture, vUv);
        float d = distance(vWorldPosition, u_mouseWorldPos);
        float paint;
        if (u_innerRadius >= u_brushRadius - 1e-6) {
          paint = d < u_brushRadius ? 1.0 : 0.0;
        } else {
          paint = 1.0 - smoothstep(u_innerRadius, u_brushRadius, d);
        }
        paint *= u_brushStrength;
        gl_FragColor = mix(prev, blur, paint);
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  // Brush/eraser color paint — writes through the flattened-UV
  // rasterization into a layer's stamp RT (its uvmap content). Paint mode
  // source-overs u_paintColor under the brush falloff (same alpha math as
  // stampColorMat so feathered edges over transparent texels don't darken);
  // erase mode multiplies alpha down while keeping rgb so soft edges keep
  // their color (the alphaFill post pass spreads rgb outward anyway).
  const colorPaintMat = new THREE.ShaderMaterial({
    uniforms: {
      u_baseTexture: { value: null },        // layer's current uvmap (front RT)
      u_paintColor: { value: new THREE.Color(1, 0, 0) },
      u_erase: { value: 0.0 },               // 0 = paint, 1 = erase alpha
      u_modelMatrix: { value: new THREE.Matrix4() },
      u_mouseWorldPos: { value: new THREE.Vector3() },
      u_brushRadius: { value: 0.1 },         // world units
      u_innerRadius: { value: 0.0 },         // hardness core
      u_brushStrength: { value: 1.0 },       // opacity 0..1
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
      uniform vec3 u_paintColor;
      uniform float u_erase;
      uniform vec3 u_mouseWorldPos;
      uniform float u_brushRadius;
      uniform float u_innerRadius;
      uniform float u_brushStrength;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vec4 prev = texture2D(u_baseTexture, vUv);
        float d = distance(vWorldPosition, u_mouseWorldPos);
        float paint;
        if (u_innerRadius >= u_brushRadius - 1e-6) {
          paint = d < u_brushRadius ? 1.0 : 0.0;
        } else {
          paint = 1.0 - smoothstep(u_innerRadius, u_brushRadius, d);
        }
        paint *= u_brushStrength;
        if (u_erase > 0.5) {
          gl_FragColor = vec4(prev.rgb, prev.a * (1.0 - paint));
          return;
        }
        // Source-over: brush falloff lives in alpha only (same as stamp).
        float srcA = paint;
        float outA = srcA + prev.a * (1.0 - srcA);
        vec3 outRgb = (u_paintColor * srcA + prev.rgb * prev.a * (1.0 - srcA)) / max(outA, 1e-5);
        gl_FragColor = vec4(outRgb, outA);
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  // Stroke-buffer dab — accumulates one brush stroke into a shared
  // coverage/color buffer instead of writing straight into the layer.
  // .a holds max coverage (falloff x pen-pressure alpha; the opacity
  // slider is deliberately excluded — it's applied once at composite).
  // .rgb holds the dab color: the brush color, or the captured view
  // sample for the stamp tool, so overlapping stamp dabs can't
  // double-apply their color.
  const strokeDabMat = new THREE.ShaderMaterial({
    uniforms: {
      u_baseTexture: { value: null },        // stroke buffer's previous state
      u_srcTexture: { value: null },         // stamp: captured composite view
      u_modelMatrix: { value: new THREE.Matrix4() },
      u_viewProj: { value: new THREE.Matrix4() },   // stamp: current camera VP
      u_viewport: { value: new THREE.Vector2(1, 1) },
      u_mouseWorldPos: { value: new THREE.Vector3() },
      u_copyPx: { value: new THREE.Vector2() },     // stamp: copy pt, capture px (y-up)
      u_startPx: { value: new THREE.Vector2() },    // stamp: stroke start, current px (y-up)
      u_flip: { value: new THREE.Vector2(1, 1) },
      u_zoomRatio: { value: 1.0 },
      u_brushRadius: { value: 0.1 },         // world units
      u_innerRadius: { value: 0.0 },         // hardness core
      u_alphaScale: { value: 1.0 },          // pen-pressure alpha only
      u_stampMode: { value: 0.0 },
      u_paintColor: { value: new THREE.Color(1, 1, 1) },
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
      uniform vec2 u_flip;
      uniform float u_zoomRatio;
      uniform float u_brushRadius;
      uniform float u_innerRadius;
      uniform float u_alphaScale;
      uniform float u_stampMode;
      uniform vec3 u_paintColor;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      vec2 scrPx(vec3 w) {
        vec4 c = u_viewProj * vec4(w, 1.0);
        return (c.xy / c.w * 0.5 + 0.5) * u_viewport;
      }
      void main() {
        vec4 base = texture2D(u_baseTexture, vUv);
        float d = distance(vWorldPosition, u_mouseWorldPos);
        float paint;
        if (u_innerRadius >= u_brushRadius - 1e-6) {
          paint = d < u_brushRadius ? 1.0 : 0.0;
        } else {
          paint = 1.0 - smoothstep(u_innerRadius, u_brushRadius, d);
        }
        paint *= u_alphaScale;
        vec3 dabColor = u_paintColor;
        float gate = 1.0;
        if (u_stampMode > 0.5) {
          vec2 srcPx = u_copyPx + u_flip * (scrPx(vWorldPosition) - u_startPx) * u_zoomRatio;
          vec4 src = texture2D(u_srcTexture, srcPx / u_viewport);
          dabColor = src.rgb;
          gate = src.a; // don't claim coverage where the view shows no mesh
        }
        float cov = paint * gate;
        // Max-composite coverage; the strongest dab at each texel owns the
        // color, so overlapped dabs can't sum past the dab's own value.
        float a = max(base.a, cov);
        vec3 rgb = cov > base.a ? dabColor : base.rgb;
        gl_FragColor = vec4(rgb, a);
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  // Stroke composite — fullscreen pass that applies the accumulated stroke
  // buffer to a layer's stroke-start snapshot exactly once:
  //   0 paint  : source-over u_paintColor at stroke.a * opacity
  //   1 erase  : base alpha reduced by stroke.a * opacity
  //   2/3 mask : mask.r +/- stroke.a * opacity
  //   4 stamp  : source-over stroke.rgb at stroke.a * opacity
  //   5 blur   : mix(base, blurred base, stroke.a * strength)
  //   6 reveal : mask.r = max(mask.r, stroke.a * 4) — unmask painted area
  const strokeCompMat = new THREE.ShaderMaterial({
    uniforms: {
      u_baseTexture: { value: null },        // layer snapshot (front buffer)
      u_stroke: { value: null },             // accumulated stroke buffer
      u_blurTexture: { value: null },        // blurred base (mode 5)
      u_paintColor: { value: new THREE.Color(1, 0, 0) },
      u_opacity: { value: 1.0 },             // slider value 0..1 (no pressure)
      u_mode: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D u_baseTexture;
      uniform sampler2D u_stroke;
      uniform sampler2D u_blurTexture;
      uniform vec3 u_paintColor;
      uniform float u_opacity;
      uniform float u_mode;
      varying vec2 vUv;
      void main() {
        vec4 b = texture2D(u_baseTexture, vUv);
        vec4 s = texture2D(u_stroke, vUv);
        int m = int(u_mode + 0.5);
        if (m == 1) {
          gl_FragColor = vec4(b.rgb, b.a * (1.0 - s.a * u_opacity));
          return;
        }
        if (m == 2 || m == 3) {
          float sign = m == 2 ? 1.0 : -1.0;
          float v = clamp(b.r + sign * s.a * u_opacity, 0.0, 1.0);
          gl_FragColor = vec4(v, v, v, 1.0);
          return;
        }
        if (m == 5) {
          vec4 blur = texture2D(u_blurTexture, vUv);
          gl_FragColor = mix(b, blur, s.a * u_opacity);
          return;
        }
        if (m == 6) {
          float v = max(b.r, min(1.0, s.a * 4.0));
          gl_FragColor = vec4(v, v, v, 1.0);
          return;
        }
        vec3 srcC = m == 4 ? s.rgb : u_paintColor;
        float srcA = s.a * u_opacity;
        float outA = srcA + b.a * (1.0 - srcA);
        vec3 outRgb = (srcC * srcA + b.rgb * b.a * (1.0 - srcA)) / max(outA, 1e-5);
        gl_FragColor = vec4(outRgb, outA);
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const strokeCompQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), strokeCompMat);
  strokeCompQuad.frustumCulled = false;
  strokeCompQuad.visible = false;

  scene.add(paintGroup, blitQuad, bleedQuad, copyQuad, alphaFillQuad, blurQuad, strokeCompQuad);
  return {
    scene, cam, mat, paintGroup, blitQuad,
    coverageMat, coverageRT, coverageMesh: null,
    bleedMat, bleedQuad,
    copyMat, copyQuad, stampColorMat,
    alphaFillMat, alphaFillQuad,
    blurMat, blurQuad, blurMixMat,
    colorPaintMat,
    strokeDabMat, strokeCompMat, strokeCompQuad,
  };
}

/**
 * Mask display material — renders a mask texture through the mesh's UVs:
 * white where painted, black elsewhere. Used by inpaint-mask captures and
 * the mirror flow's arbitrary-mask view.
 */
export function createMaskDisplayMaterial(maskTexture) {
  return new THREE.ShaderMaterial({
    uniforms: { u_mask: { value: maskTexture } },
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
  });
}

/**
 * UV projective-texturing material — renders the mesh flattened in UV space;
 * for each UV fragment, transforms its world position through the projector
 * camera's matrices to find where it appears in the generated image, then
 * samples it. Fades out 50px from the projector frustum edge.
 */
export function createUvProjectorMaterial(projCamera, genTexture, uvMapSize) {
  return new THREE.ShaderMaterial({
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

// ── Layer compositor shaders ────────────────────────────────────────────

export const LAYER_VERTEX_SHADER = `
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
const LAYER_SHADER_TAIL = `
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

    // Real shadow map — the directional light's depth map sampled at this
    // fragment's world position. A 5x5 tap grid, randomly rotated per
    // fragment, spreads over u_shadowRadius texels for soft edges; the
    // smoothstep depth window softens the binary occluded/lit transition.
    // u_hasShadow stays 0 until the first shadow pass produces a map.
    if (u_hasShadow > 0.5) {
      vec4 sc4 = u_shadowMatrix * vec4(vWorldPos, 1.0);
      vec3 sc = sc4.xyz / sc4.w;
      if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z > 0.0 && sc.z < 1.0) {
        float rnd = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float ang = rnd * 6.2831853;
        float ca = cos(ang);
        float sa = sin(ang);
        mat2 rot = mat2(ca, -sa, sa, ca);
        float ts = 1.0 / 2048.0;
        float vis = 0.0;
        for (int x = -2; x <= 2; x++) {
          for (int y = -2; y <= 2; y++) {
            vec2 off = rot * vec2(float(x), float(y)) * u_shadowRadius * ts;
            vec4 packedDepth = texture2D(u_shadowMap, sc.xy + off);
            float d = dot(packedDepth, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
            // diff > 0 → lit (stored depth at/behind this fragment). The
            // ramp must *end* at 0: diff = +bias on a correctly-lit surface
            // would sit inside a ramp starting at 0 and darken everything.
            vis += smoothstep(-0.0025, 0.0, d - sc.z + u_shadowBias);
          }
        }
        vis /= 25.0;
        shadow *= mix(0.45, 1.0, vis);
      }
    }

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

// Single-baked-image variant — no selected layers, the whole stack is in
// u_combined.
export const LAYER_COMBINED_FRAGMENT = `
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
  uniform sampler2D u_shadowMap;
  uniform mat4 u_shadowMatrix;
  uniform float u_shadowBias;
  uniform float u_shadowRadius;
  uniform float u_hasShadow;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vec4 color = vec4(0.0);
    if (u_hasCombined > 0.5) color = texture2D(u_combined, vUv);
${LAYER_SHADER_TAIL}`;

/**
 * buildLiveLayerFragment — assembles the mixed bake/live fragment shader.
 * One blend block per render op so interleaved selections keep their true
 * z-order. `ops` is bottom→top: { type:'bake' } → u_bakeN, { type:'live' } →
 * layerN/maskN/hasMaskN.
 */
export function buildLiveLayerFragment(ops) {
  let bakeN = 0;
  let liveN = 0;
  const decls = [];
  const body = [];
  const slotFor = []; // slot index per op, parallel to ops
  for (const op of ops) {
    if (op.type === 'bake') {
      const s = bakeN++;
      slotFor.push({ kind: 'bake', s });
      decls.push(`uniform sampler2D u_bake${s}; uniform float u_hasBake${s};`);
      body.push(`if (u_hasBake${s} > 0.5) { vec4 c${s} = texture2D(u_bake${s}, vUv); color.rgb = mix(color.rgb, c${s}.rgb, c${s}.a); color.a = max(color.a, c${s}.a); }`);
    } else {
      const s = liveN++;
      slotFor.push({ kind: 'live', s });
      decls.push(`uniform sampler2D layer${s}; uniform sampler2D mask${s}; uniform float hasMask${s};`);
      // With a mask bound, mask defines visibility — the near-black
      // "empty" heuristic would wrongly cull stamped dark content.
      body.push(`{ vec4 lc${s} = texture2D(layer${s}, vUv); float cm${s} = mix(step(0.01, length(lc${s}.rgb)), 1.0, hasMask${s}); float pm${s} = mix(1.0, texture2D(mask${s}, vUv).r, hasMask${s}); float a${s} = mix(0.0, lc${s}.a, pm${s}); color.rgb = mix(color.rgb, lc${s}.rgb, cm${s} * a${s}); color.a = max(color.a, a${s} * cm${s}); }`);
    }
  }
  const fragmentShader = `
  uniform vec3 dir1Pos;
  uniform sampler2D u_checker;
  uniform sampler2D u_inpaintMask;
  uniform sampler2D u_inpaintTile;
  uniform float u_inpaintOffset;
  uniform float u_hasInpaint;
  uniform float u_unlit;
  uniform float u_dimBackface;
  uniform sampler2D u_shadowMap;
  uniform mat4 u_shadowMatrix;
  uniform float u_shadowBias;
  uniform float u_shadowRadius;
  uniform float u_hasShadow;
  ${decls.join('\n        ')}
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vec4 color = vec4(0.0);
    ${body.join('\n          ')}
${LAYER_SHADER_TAIL}`;
  return { fragmentShader, slotFor };
}
