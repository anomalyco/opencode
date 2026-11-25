import {
  CanvasTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three"

/**
 * The CRT. The screen's 2D canvas (screen-canvas.ts) goes through one full-screen pass into a
 * render target, which adds what happens inside the tube: phosphor persistence, the power-on and
 * power-off collapse, the 404's tear. The glass then draws that target with what happens on the
 * tube's face: barrel curvature, the aperture grille and scanlines (resolved only up close),
 * halation, chromatic fringing, a slow rolling band, flicker, grain, and the room's reflection with
 * a glare that moves with the camera.
 */

export type Crt = ReturnType<typeof createCrt>

export function createCrt(
  renderer: WebGLRenderer,
  options: { width: number; height: number; size: number; room: Texture; glare: Vector3; reduced: boolean },
) {
  const canvas = document.createElement("canvas")
  canvas.width = options.size
  canvas.height = Math.round((options.size * options.height) / options.width)
  const context = canvas.getContext("2d")
  const source = new CanvasTexture(canvas)
  source.colorSpace = SRGBColorSpace
  source.minFilter = LinearFilter
  source.generateMipmaps = false

  const target = () => {
    const rt = new WebGLRenderTarget(canvas.width, canvas.height, {
      type: HalfFloatType,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    })
    return rt
  }
  let read = target()
  let write = target()

  // ——— The pass inside the tube ———

  const tube = new ShaderMaterial({
    uniforms: {
      source: { value: source },
      previous: { value: read.texture },
      decay: { value: 0.72 },
      time: { value: 0 },
      powerT: { value: 1 },
      powerMode: { value: 0 },
      glitch: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D source;
      uniform sampler2D previous;
      uniform float decay;
      uniform float time;
      uniform float powerT;
      uniform float powerMode;
      uniform float glitch;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 uv = vUv;
        // The 404's tear: rows slip sideways and the colours split.
        if (glitch > 0.0) {
          float row = floor(uv.y * 42.0);
          float n = hash(vec2(row, floor(time * 22.0)));
          uv.x += (n - 0.5) * 0.08 * glitch * step(0.55, n);
          uv.y += (hash(vec2(floor(time * 9.0), 3.0)) - 0.5) * 0.02 * glitch;
        }
        float shape = 1.0;
        float flash = 0.0;
        if (powerMode != 0.0) {
          // On: a dot, then a line, then the picture opens vertically. Off runs it backwards.
          float t = powerMode > 0.0 ? powerT : 1.0 - powerT;
          float sx = smoothstep(0.1, 0.4, t);
          float sy = mix(0.005, 1.0, smoothstep(0.4, 1.0, t));
          vec2 c = uv - 0.5;
          float line = step(abs(c.y), sy * 0.5) * step(abs(c.x), max(sx * 0.5, 0.0005));
          float dotR = 0.008 + 0.02 * smoothstep(0.0, 0.1, t);
          float spot = smoothstep(dotR, dotR * 0.2, length(c * vec2(1.48, 1.0)));
          shape = max(line, spot * (1.0 - sx));
          if (powerMode < 0.0) shape *= smoothstep(0.0, 0.08, t);
          uv = c / vec2(max(sx, 0.001), sy) + 0.5;
          flash = 1.0 - smoothstep(0.35, 1.0, t);
        }
        vec3 color = texture2D(source, clamp(uv, 0.0, 1.0)).rgb;
        if (glitch > 0.0) {
          color.r = texture2D(source, uv + vec2(0.008 * glitch, 0.0)).r;
          color.b = texture2D(source, uv - vec2(0.008 * glitch, 0.0)).b;
        }
        color = mix(color, vec3(0.8, 0.9, 1.0), flash * 0.85) * (1.0 + flash * 2.5) * shape;
        // Phosphor persistence: the last frame fades rather than vanishing.
        vec3 last = texture2D(previous, vUv).rgb * decay;
        gl_FragColor = vec4(max(color, last), 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  })
  const passScene = new Scene()
  const passCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new Mesh(new PlaneGeometry(2, 2), tube)
  quad.frustumCulled = false
  passScene.add(quad)

  // ——— The glass ———

  const glass = new ShaderMaterial({
    uniforms: {
      map: { value: read.texture },
      room: { value: options.room },
      glare: { value: options.glare.clone().normalize() },
      time: { value: 0 },
      power: { value: 1 },
      resolution: { value: new Vector2(canvas.width, canvas.height) },
      curvature: { value: 0.055 },
      scanlines: { value: 0.85 },
      mask: { value: 0.8 },
      bloom: { value: 0.6 },
      aberration: { value: 0.0022 },
      flicker: { value: 1 },
      roll: { value: 0.06 },
      noise: { value: 0.03 },
      reflection: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vViewNormal;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform sampler2D room;
      uniform vec3 glare;
      uniform float time;
      uniform float power;
      uniform vec2 resolution;
      uniform float curvature;
      uniform float scanlines;
      uniform float mask;
      uniform float bloom;
      uniform float aberration;
      uniform float flicker;
      uniform float roll;
      uniform float noise;
      uniform float reflection;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vViewNormal;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        float r2 = dot(c, c);
        // Barrel curvature, with the tube's rounded corners going dark.
        vec2 bent = c * (1.0 + curvature * r2);
        vec2 uv = bent * 0.5 + 0.5;
        vec2 edge = 1.0 - abs(bent);
        // The tube's rounded corners: a rounded-rectangle edge, soft by a few texels.
        vec2 corner = max(abs(bent) - vec2(1.0 - 0.09, 1.0 - 0.12), 0.0) / vec2(0.09, 0.12);
        float inside = smoothstep(1.0, 0.94, length(corner)) * smoothstep(0.0, 0.01, edge.x) * smoothstep(0.0, 0.014, edge.y);

        // Chromatic fringing grows toward the edges.
        vec2 fringe = bent * aberration * r2;
        vec3 color = vec3(
          texture2D(map, uv + fringe).r,
          texture2D(map, uv).g,
          texture2D(map, uv - fringe).b);
        // Halation: the phosphor's light spreading in the glass.
        vec3 halo = texture2D(map, uv, 3.0).rgb * 0.45 + texture2D(map, uv, 5.0).rgb * 0.55;

        // Scanlines and the aperture grille resolve only when a texel covers a few pixels.
        float texel = fwidth(vUv.y * resolution.y);
        float near = 1.0 - smoothstep(0.25, 0.75, texel);
        float scan = 0.5 + 0.5 * cos(6.28318 * uv.y * resolution.y);
        color *= mix(1.0, 0.5 + 0.5 * scan, scanlines * mix(0.14, 1.0, near));
        float sub = fract(uv.x * resolution.x);
        vec3 grille = vec3(
          smoothstep(0.0, 0.1, sub) * smoothstep(0.36, 0.24, sub),
          smoothstep(0.31, 0.41, sub) * smoothstep(0.69, 0.57, sub),
          smoothstep(0.64, 0.74, sub) * smoothstep(1.0, 0.9, sub));
        color *= mix(vec3(1.0), grille * 2.7 + 0.08, near * mask);

        // A soft band rolls slowly down the picture; the tube breathes and shimmers.
        float band = exp(-pow((fract(vUv.y + time * 0.035) - 0.5) * 9.0, 2.0));
        float breathe = 1.0 + flicker * (0.01 * sin(time * 5.3) + 0.006 * sin(time * 13.1 + 1.3) + 0.012 * (hash(vec2(floor(time * 60.0), 1.0)) - 0.5));
        float shimmer = 1.0 + 0.02 * flicker * near * sin(uv.y * resolution.y * 0.5 - time * 376.99);
        vec3 tube = (color * 1.3 + halo * bloom) * (1.0 + band * roll) * breathe * shimmer;
        tube *= smoothstep(1.6, 0.45, length(c * vec2(0.92, 1.05)));
        tube += (hash(floor(uv * resolution) + fract(time * 7.0) * 91.0) - 0.5) * noise * mix(0.25, 1.0, near) * inside;
        tube *= inside * power;

        // The glass: the room mirrored in it, stronger at grazing angles, and a glare that slides
        // across the curve as the camera moves.
        vec3 view = normalize(vWorld - cameraPosition);
        vec3 normal = normalize(vNormal);
        vec3 mirrored = reflect(view, normal);
        vec2 roomUv = vec2(0.5 - dot(mirrored, normalize(cross(vec3(0.0, 1.0, 0.0), normal))) * 0.55, 0.62 + mirrored.y * 0.6);
        vec3 mirror = texture2D(room, clamp(roomUv, 0.001, 0.999), 4.5).rgb;
        float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(-view, normal), 0.0), 5.0);
        float sweep = max(dot(mirrored, glare), 0.0);
        vec3 specular = vec3(0.72, 0.84, 1.0) * (pow(sweep, 220.0) * 0.8 + pow(sweep, 14.0) * 0.012);
        vec3 surface = (mirror * (0.018 + fresnel * 0.4) * 0.6 + specular) * reflection;
        gl_FragColor = vec4(tube + surface + vec3(0.003, 0.005, 0.01), 1.0);
        #include <colorspace_fragment>
      }
    `,
    toneMapped: false,
  })

  // The tube's face: a gently convex plane.
  const geometry = new PlaneGeometry(options.width, options.height, 32, 22)
  const positions = geometry.getAttribute("position")
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index) / (options.width / 2)
    const y = positions.getY(index) / (options.height / 2)
    positions.setZ(index, 0.012 * (1 - x * x * 0.55) * (1 - y * y * 0.55))
  }
  geometry.computeVertexNormals()
  const mesh = new Mesh(geometry, glass)

  let power: { mode: 1 | -1 | 0; start: number; duration: number } = { mode: 0, start: 0, duration: 1 }
  let dirty = true
  let settle = 0

  return {
    canvas,
    context,
    mesh,
    /** The canvas changed: upload it on the next frame. */
    touch() {
      source.needsUpdate = true
      dirty = true
    },
    powerOn() {
      power = { mode: 1, start: performance.now(), duration: options.reduced ? 1 : 750 }
    },
    powerOff() {
      power = { mode: -1, start: performance.now(), duration: options.reduced ? 1 : 420 }
    },
    tune(values: {
      curvature: number
      scanlines: number
      mask: number
      bloom: number
      aberration: number
      flicker: number
      roll: number
      noise: number
      reflection: number
    }) {
      for (const [key, value] of Object.entries(values)) glass.uniforms[key].value = value
    },
    get busy() {
      return power.mode !== 0 || dirty || settle > 0
    },
    /** Run the tube pass (when anything inside it moves) and set the glass's uniforms. */
    render(now: number, glitch: number, level: number) {
      const t = Math.min(1, (now - power.start) / power.duration)
      tube.uniforms.time.value = now / 1000
      tube.uniforms.powerT.value = t
      tube.uniforms.powerMode.value = power.mode
      tube.uniforms.glitch.value = glitch
      glass.uniforms.time.value = options.reduced ? 0 : now / 1000
      glass.uniforms.power.value = level
      // Keep running a few frames after the last change so the persistence fades out.
      if (dirty || power.mode !== 0 || glitch > 0) settle = 12
      if (settle <= 0) return
      settle -= 1
      dirty = false
      tube.uniforms.previous.value = read.texture
      const previous = renderer.getRenderTarget()
      renderer.setRenderTarget(write)
      renderer.render(passScene, passCamera)
      renderer.setRenderTarget(previous)
      ;[read, write] = [write, read]
      glass.uniforms.map.value = read.texture
      // The power-on ends on the full picture; the power-off stays dark.
      if (t >= 1 && power.mode === 1) power = { mode: 0, start: 0, duration: 1 }
    },
    dispose() {
      for (const item of [source, read, write, tube, glass, geometry, quad.geometry]) item.dispose()
    },
  }
}
