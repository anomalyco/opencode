import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  Points,
  type Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three"

/**
 * The moonlight: a volumetric shaft from the window to the floor, the pool of light it leaves there
 * and the dust drifting through it. The shaft's direction and width can be changed live; the dust
 * follows the shaft, because each mote is placed along the shaft's axis rather than in the room.
 */

export const maxDust = 20000
// Out of every 160 motes, one is a fibre: a longer, curled thread.
const fibreEvery = 160

export type MoonlightInput = {
  window: Vector3[]
  patch: Vector3[]
  quality: "high" | "lite"
}

export type MoonlightFrame = {
  time: number
  /** 0–1: clouds over the moon (1 is clear). */
  cloud: number
  pixelScale: number
  focus: number
  drift: Vector3
  disturb: { position: Vector3; velocity: Vector3 }
}

export type MoonlightLook = {
  color: Color
  shaft: number
  density: number
  softness: number
  pool: number
  dust: { count: number; size: number; speed: number; glint: number; outside: number; dof: number; pointer: number }
}

export function createMoonlight(scene: Scene, input: MoonlightInput) {
  const windowCentre = input.window.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(4)
  const basePatchCentre = input.patch.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(4)
  const baseDirection = basePatchCentre.clone().sub(windowCentre).normalize()
  /** The default direction as azimuth (around y, degrees) and elevation (below horizontal, degrees). */
  const base = {
    azimuth: (Math.atan2(baseDirection.x, -baseDirection.z) * 180) / Math.PI,
    elevation: (Math.asin(-baseDirection.y) * 180) / Math.PI,
  }
  const patch = input.patch.map((point) => point.clone())
  const patchCentre = basePatchCentre.clone()

  // ——— Shaft: an outer volume and a denser core, each a frustum of four soft sides ———

  const shaftMaterial = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      strength: { value: 0.42 },
      softness: { value: 0.5 },
      cloud: { value: 1 },
      color: { value: new Color(0.55, 0.7, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        vUv = uv;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        // Faces seen edge-on would draw hard outlines: fade them with the viewing angle.
        vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-view.xyz)));
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform float strength;
      uniform float softness;
      uniform float cloud;
      uniform vec3 color;
      varying vec2 vUv;
      varying float vFacing;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float edge = pow(sin(vUv.x * 3.14159), mix(0.6, 3.2, softness)) * smoothstep(0.05, 0.7, vFacing);
        float along = mix(1.0, 0.5, vUv.y) * smoothstep(1.0, 0.8, vUv.y) * smoothstep(0.0, 0.06, vUv.y);
        // Slow, drifting density: streaks along the light and blotches crossing it.
        float n = noise(vec2(vUv.x * 7.0 + time * 0.04, vUv.y * 2.5 - time * 0.07)) * 0.6
          + noise(vec2(vUv.x * 19.0 - time * 0.02, vUv.y * 6.0)) * 0.4;
        float streaks = 0.65 + 0.35 * sin(vUv.x * 31.0 + n * 4.0 + time * 0.08);
        float a = edge * along * (0.45 + 0.75 * n) * streaks * strength * cloud;
        gl_FragColor = vec4(color * a, 1.0);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
  const outer = new Mesh(new BufferGeometry(), shaftMaterial)
  const core = new Mesh(new BufferGeometry(), shaftMaterial)
  scene.add(outer, core)

  // ——— The pool on the floor ———

  const poolMaterial = new ShaderMaterial({
    uniforms: { color: { value: new Color(0.32, 0.45, 0.8) }, strength: { value: 0.7 }, cloud: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float strength;
      uniform float cloud;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        float soft = smoothstep(0.92, 0.1, length(c * vec2(1.08, 1.18)));
        gl_FragColor = vec4(color * soft * strength * cloud, 1.0);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
  const pool = new Mesh(new BufferGeometry(), poolMaterial)
  pool.renderOrder = 1
  scene.add(pool)

  // ——— Dust ———

  const dustGeometry = new BufferGeometry()
  const along = new Float32Array(maxDust)
  const offset = new Float32Array(maxDust * 2)
  const seed = new Float32Array(maxDust)
  const kind = new Float32Array(maxDust)
  for (let index = 0; index < maxDust; index++) {
    along[index] = Math.random()
    // Most motes inside the shaft's radius, a quarter scattered around it.
    const inside = Math.random() < 0.78
    const radius = inside ? Math.sqrt(Math.random()) * 1.05 : 1.1 + Math.random() * 1.6
    const angle = Math.random() * Math.PI * 2
    offset[index * 2] = Math.cos(angle) * radius
    offset[index * 2 + 1] = Math.sin(angle) * radius
    seed[index] = Math.random()
    kind[index] = index % fibreEvery === 0 ? 1 : 0
  }
  // Points need a position attribute; the shader computes the real one.
  dustGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(maxDust * 3), 3))
  dustGeometry.setAttribute("along", new Float32BufferAttribute(along, 1))
  dustGeometry.setAttribute("offset", new Float32BufferAttribute(offset, 2))
  dustGeometry.setAttribute("seed", new Float32BufferAttribute(seed, 1))
  dustGeometry.setAttribute("kind", new Float32BufferAttribute(kind, 1))
  const dustMaterial = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      top: { value: windowCentre.clone() },
      axis: { value: basePatchCentre.clone().sub(windowCentre) },
      basisU: { value: new Vector3(1, 0, 0) },
      basisV: { value: new Vector3(0, 0, 1) },
      radii: { value: new Vector2(0.3, 0.8) },
      scale: { value: 1 },
      size: { value: 1 },
      speed: { value: 1 },
      glint: { value: 1 },
      outside: { value: 0.02 },
      focus: { value: 5 },
      dof: { value: 1 },
      cloud: { value: 1 },
      drift: { value: new Vector3() },
      disturbAt: { value: new Vector3(0, -10, 0) },
      disturbVelocity: { value: new Vector3() },
      pointer: { value: 1 },
      color: { value: new Color(0.78, 0.87, 1) },
    },
    vertexShader: /* glsl */ `
      attribute float along;
      attribute vec2 offset;
      attribute float seed;
      attribute float kind;
      uniform float time;
      uniform vec3 top;
      uniform vec3 axis;
      uniform vec3 basisU;
      uniform vec3 basisV;
      uniform vec2 radii;
      uniform float scale;
      uniform float size;
      uniform float speed;
      uniform float glint;
      uniform float outside;
      uniform float focus;
      uniform float dof;
      uniform float cloud;
      uniform vec3 drift;
      uniform vec3 disturbAt;
      uniform vec3 disturbVelocity;
      uniform float pointer;
      varying float vAlpha;
      varying float vBokeh;
      varying float vKind;
      varying float vAngle;
      void main() {
        float t = time * speed;
        // Convection: the warm air carries the dust slowly up the shaft toward the window.
        float k = fract(along - t * (0.0035 + seed * 0.004));
        float radius = mix(radii.x, radii.y, k);
        vec3 p = top + axis * k + (basisU * offset.x + basisV * offset.y) * radius;
        // Brownian drift: a few slow, incommensurate swirls per mote.
        float a = seed * 61.0;
        p += vec3(
          sin(t * (0.19 + seed * 0.21) + a) + 0.5 * sin(t * (0.53 + seed * 0.3) + a * 1.7),
          0.7 * sin(t * (0.15 + seed * 0.17) + a * 2.3) + 0.4 * sin(t * 0.41 + a),
          cos(t * (0.17 + seed * 0.23) + a * 0.7) + 0.5 * sin(t * (0.47 + seed * 0.2) + a * 2.9)) * 0.03;
        // The air reacts: it lags behind camera moves and is pushed by the coin.
        p -= drift * (0.015 + seed * 0.03);
        vec3 d = p - disturbAt;
        float near = exp(-dot(d, d) / 0.06) * pointer;
        p += disturbVelocity * near * 0.08 + normalize(d + 1e-4) * near * length(disturbVelocity) * 0.04;

        // In the light, or not: distance from the shaft's axis against its radius there.
        float kk = clamp(dot(p - top, axis) / dot(axis, axis), 0.0, 1.0);
        float rr = mix(radii.x, radii.y, kk);
        float inside = smoothstep(rr * 1.02, rr * 0.5, length(p - (top + axis * kk)))
          * smoothstep(0.0, 0.08, kk) * smoothstep(1.0, 0.88, kk);
        vec3 toCamera = normalize(cameraPosition - p);
        // Forward scattering: dust glows most when the camera looks toward the light.
        float phase = 0.3 + 0.7 * pow(max(dot(normalize(axis), toCamera), 0.0), 2.0);
        // Turning flakes catch the light now and then.
        float flash = pow(max(sin(time * (0.5 + seed * 1.6) + seed * 40.0), 0.0), 18.0);
        float bright = inside * cloud * phase * (0.5 + 1.4 * flash) * glint;
        vAlpha = max(bright, outside * (0.4 + 0.6 * phase)) * (kind > 0.5 ? 0.45 : 1.0);

        vec4 view = modelViewMatrix * vec4(p, 1.0);
        float depth = -view.z;
        // World sizes: motes of 2–8 mm (they read larger than they are, lit), fibres of 2–4 cm.
        float px = scale * size * (kind > 0.5 ? 0.022 + seed * 0.02 : 0.0022 + seed * seed * 0.006) / depth;
        // Depth of field: out-of-focus motes grow into faint discs (most of all the near ones).
        float blur = clamp(abs(depth - focus) / depth, 0.0, 1.0) * dof;
        float grown = px + blur * scale * 0.012 * (depth < focus ? 1.0 : 0.12);
        vBokeh = clamp((grown - px) / max(grown, 0.001), 0.0, 1.0);
        vAlpha *= clamp((px * px + 1.0) / (grown * grown + 1.0), 0.04, 1.0);
        vKind = kind;
        vAngle = seed * 6.2831 + time * 0.05 * speed;
        gl_PointSize = clamp(max(grown, 1.0), 1.0, 96.0);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      varying float vAlpha;
      varying float vBokeh;
      varying float vKind;
      varying float vAngle;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a;
        if (vKind > 0.5) {
          vec2 r = vec2(cos(vAngle) * q.x - sin(vAngle) * q.y, sin(vAngle) * q.x + cos(vAngle) * q.y);
          r.y += r.x * r.x * 1.2 - 0.05;
          a = smoothstep(0.035, 0.0, abs(r.y)) * smoothstep(0.48, 0.25, abs(r.x));
        } else {
          float d = length(q);
          float point = pow(smoothstep(0.5, 0.0, d), 2.0);
          float disc = smoothstep(0.5, 0.4, d) * (0.75 + 0.25 * smoothstep(0.3, 0.47, d));
          a = mix(point, disc, vBokeh);
        }
        float alpha = a * vAlpha;
        gl_FragColor = vec4(color * alpha, alpha);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  const dust = new Points(dustGeometry, dustMaterial)
  dust.frustumCulled = false
  scene.add(dust)

  const frustum = (inset: number) => {
    const window = input.window.map((point) => point.clone().lerp(windowCentre, inset))
    const floor = patch.map((point) => point.clone().lerp(patchCentre, inset))
    const positions: number[] = []
    const uvs: number[] = []
    for (let side = 0; side < 4; side++) {
      const a = window[side]
      const b = window[(side + 1) % 4]
      const c = floor[(side + 1) % 4]
      const d = floor[side]
      for (const [point, u, v] of [
        [a, 0, 0],
        [b, 1, 0],
        [c, 1, 1],
        [a, 0, 0],
        [c, 1, 1],
        [d, 0, 1],
      ] as const) {
        positions.push(point.x, point.y, point.z)
        uvs.push(u, v)
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()
    return geometry
  }

  const rebuild = () => {
    outer.geometry.dispose()
    core.geometry.dispose()
    pool.geometry.dispose()
    outer.geometry = frustum(0)
    core.geometry = frustum(0.45)
    const positions: number[] = []
    const uvs: number[] = []
    for (const [index, u, v] of [
      [0, 0, 0],
      [1, 1, 0],
      [2, 1, 1],
      [0, 0, 0],
      [2, 1, 1],
      [3, 0, 1],
    ] as const) {
      positions.push(patch[index].x, 0.004, patch[index].z)
      uvs.push(u, v)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
    pool.geometry = geometry
    // The dust's frame: along the shaft's axis, with two directions across it.
    const axis = patchCentre.clone().sub(windowCentre)
    const basisU = new Vector3().crossVectors(axis, new Vector3(0, 1, 0)).normalize()
    const basisV = new Vector3().crossVectors(basisU, axis).normalize()
    dustMaterial.uniforms.axis.value.copy(axis)
    dustMaterial.uniforms.basisU.value.copy(basisU)
    dustMaterial.uniforms.basisV.value.copy(basisV)
    const windowRadius = input.window[0].distanceTo(input.window[2]) / 2
    const patchRadius = patch[0].distanceTo(patch[2]) / 2
    dustMaterial.uniforms.radii.value.set(windowRadius * 0.85, patchRadius * 0.62)
  }

  let aimed = ""
  /** Point the shaft: offsets from the photographed direction (degrees) and a width scale. */
  const aim = (azimuth: number, elevation: number, width: number) => {
    const key = `${azimuth}:${elevation}:${width}`
    if (key === aimed) return
    aimed = key
    const az = ((base.azimuth + azimuth) * Math.PI) / 180
    const el = (Math.min(85, Math.max(8, base.elevation + elevation)) * Math.PI) / 180
    const direction = new Vector3(Math.sin(az) * Math.cos(el), -Math.sin(el), -Math.cos(az) * Math.cos(el))
    patchCentre.copy(windowCentre).addScaledVector(direction, -windowCentre.y / direction.y)
    input.patch.forEach((point, index) =>
      patch[index].copy(point).sub(basePatchCentre).multiplyScalar(width).add(patchCentre),
    )
    rebuild()
  }
  aim(0, 0, 1)

  return {
    windowCentre,
    get patchCentre() {
      return patchCentre
    },
    aim,
    look(look: MoonlightLook) {
      shaftMaterial.uniforms.color.value.copy(look.color)
      shaftMaterial.uniforms.strength.value = 0.42 * look.shaft * look.density
      shaftMaterial.uniforms.softness.value = look.softness
      poolMaterial.uniforms.color.value.copy(look.color).multiplyScalar(0.6)
      poolMaterial.uniforms.strength.value = 0.7 * look.pool
      dustMaterial.uniforms.color.value.copy(look.color).lerp(new Color(1, 1, 1), 0.45)
      dustMaterial.uniforms.size.value = look.dust.size
      dustMaterial.uniforms.speed.value = look.dust.speed
      dustMaterial.uniforms.glint.value = look.dust.glint
      dustMaterial.uniforms.outside.value = look.dust.outside
      dustMaterial.uniforms.dof.value = look.dust.dof
      dustMaterial.uniforms.pointer.value = look.dust.pointer
      dustGeometry.setDrawRange(0, Math.min(maxDust, Math.round(look.dust.count)))
    },
    update(frame: MoonlightFrame) {
      for (const material of [shaftMaterial, poolMaterial, dustMaterial]) material.uniforms.cloud.value = frame.cloud
      shaftMaterial.uniforms.time.value = frame.time
      dustMaterial.uniforms.time.value = frame.time
      dustMaterial.uniforms.scale.value = frame.pixelScale
      dustMaterial.uniforms.focus.value = frame.focus
      dustMaterial.uniforms.drift.value.copy(frame.drift)
      dustMaterial.uniforms.disturbAt.value.copy(frame.disturb.position)
      dustMaterial.uniforms.disturbVelocity.value.copy(frame.disturb.velocity)
    },
    dispose() {
      for (const item of [
        outer.geometry,
        core.geometry,
        pool.geometry,
        dustGeometry,
        shaftMaterial,
        poolMaterial,
        dustMaterial,
      ])
        item.dispose()
    },
  }
}
