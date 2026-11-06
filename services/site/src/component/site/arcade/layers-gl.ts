import type { LayerValues } from "./layers-tuning"

/**
 * The layered arcade's light layer (mode "layers"): plain WebGL2, no three.js on this path. One
 * full-frame pass draws the moon beam and the floor light from two textures cut out of the painting
 * (the beam is rotated and widened about the window sill), then the dust specks are drawn as soft
 * additive point sprites. The canvas is opaque black and composited with `plus-lighter`, so what it
 * draws adds to the room exactly as the painting's light did.
 */

export type LayerData = {
  size: [number, number]
  cabinet: { x: number; y: number; w: number; h: number }
  beam: { apex: [number, number]; angle: number; color: string }
  floor: { color: string }
  particleColor: string
  /** x, y (scene px), radius (px), intensity (0–1). */
  particles: [number, number, number, number][]
}

export const maxParticles = 3000

const quadVertex = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() {
  uv = corner;
  gl_Position = vec4(corner.x * 2.0 - 1.0, 1.0 - corner.y * 2.0, 0.0, 1.0);
}`

const quadFragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D beamMap;
uniform sampler2D floorMap;
uniform vec2 size;
uniform vec2 apex;
uniform vec2 axis0;
uniform vec2 axis;
uniform float width;
uniform float intensity;
uniform float floorIntensity;
uniform vec3 tint;
uniform float shimmer;
uniform float time;
void main() {
  vec2 p = uv * size;
  vec2 d = p - apex;
  vec2 normal = vec2(-axis.y, axis.x);
  vec2 normal0 = vec2(-axis0.y, axis0.x);
  float along = dot(d, axis);
  float across = dot(d, normal);
  vec2 source = apex + axis0 * along + normal0 * (across / width);
  vec3 beam = texture(beamMap, source / size).rgb;
  float ray = atan(across, max(along, 1.0));
  float wave = sin(ray * 53.0 + time * 0.7) * 0.5 + sin(ray * 97.0 - time * 1.13) * 0.3 + sin(ray * 31.0 + time * 0.31) * 0.2;
  beam *= intensity * tint * (1.0 + shimmer * 0.6 * wave);
  color = vec4(beam + texture(floorMap, uv).rgb * floorIntensity, 1.0);
}`

const particleVertex = `#version 300 es
in vec4 particle;
in float seed;
uniform vec2 size;
uniform float scale;
uniform float time;
uniform float sizeFactor;
uniform float twinkle;
out float glow;
void main() {
  float rate = 0.6 + fract(seed * 7.13);
  float phase = fract(time * 0.012 * rate + seed);
  vec2 drift = vec2(
    sin(time * 0.09 * rate + seed * 40.0) * 22.0 - (phase - 0.5) * 50.0,
    (phase - 0.5) * 110.0
  );
  vec2 at = particle.xy + drift;
  float fade = sin(phase * 3.14159);
  float sparkle = 1.0 - twinkle * 0.5 * (1.0 + sin(time * (1.3 + rate * 2.4) + seed * 61.0));
  glow = particle.w * fade * sparkle;
  gl_PointSize = max(1.0, particle.z * 2.6 * sizeFactor * scale);
  gl_Position = vec4(at.x / size.x * 2.0 - 1.0, 1.0 - at.y / size.y * 2.0, 0.0, 1.0);
}`

const particleFragment = `#version 300 es
precision mediump float;
in float glow;
out vec4 color;
uniform vec3 tone;
uniform float brightness;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 18.0);
  color = vec4(tone * glow * brightness * a, 0.0);
}`

const hex = (value: string) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16) / 255)
const warm = [1, 0.71, 0.42]
const cool = [0.42, 0.66, 1]

export function createLightLayer(
  canvas: HTMLCanvasElement,
  data: LayerData,
  maps: { beam: HTMLImageElement; floor: HTMLImageElement },
) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: true })
  if (!gl) return undefined
  const quad = program(gl, quadVertex, quadFragment)
  const dots = program(gl, particleVertex, particleFragment)
  const [width, height] = data.size

  const corners = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, corners)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)

  // The painting's specks first, then extra ones scattered around them (deterministic).
  const random = mulberry(7)
  const particles = new Float32Array(maxParticles * 5)
  for (let index = 0; index < maxParticles; index++) {
    const base = data.particles[index % data.particles.length]
    const extra = index >= data.particles.length
    particles.set(
      [
        base[0] + (extra ? (random() - 0.5) * 160 : 0),
        base[1] + (extra ? (random() - 0.5) * 160 : 0),
        base[2],
        base[3] * (extra ? 0.5 + random() * 0.6 : 1),
        random(),
      ],
      index * 5,
    )
  }
  const particleBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, particles, gl.STATIC_DRAW)

  const texture = (image: HTMLImageElement) => {
    const result = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, result)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return result
  }
  const beamMap = texture(maps.beam)
  const floorMap = texture(maps.floor)
  const angle0 = (data.beam.angle * Math.PI) / 180
  const tone = hex(data.particleColor)

  return {
    resize(scale: number) {
      canvas.width = Math.round(width * scale)
      canvas.height = Math.round(height * scale)
    },
    /** Time 0 is the frame baked into the poster (poster-*.avif); reduced motion stays on it. */
    draw(time: number, values: LayerValues) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.disable(gl.BLEND)
      gl.useProgram(quad.program)
      gl.bindBuffer(gl.ARRAY_BUFFER, corners)
      const corner = gl.getAttribLocation(quad.program, "corner")
      gl.enableVertexAttribArray(corner)
      gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, beamMap)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, floorMap)
      const angle = angle0 + (values.beam.angle * Math.PI) / 180
      const temperature = values.beam.temperature / 100
      const target = temperature > 0 ? warm : cool
      quad.set("beamMap", (location) => gl.uniform1i(location, 0))
      quad.set("floorMap", (location) => gl.uniform1i(location, 1))
      quad.set("size", (location) => gl.uniform2f(location, width, height))
      quad.set("apex", (location) => gl.uniform2f(location, data.beam.apex[0], data.beam.apex[1]))
      quad.set("axis0", (location) => gl.uniform2f(location, Math.cos(angle0), Math.sin(angle0)))
      quad.set("axis", (location) => gl.uniform2f(location, Math.cos(angle), Math.sin(angle)))
      quad.set("width", (location) => gl.uniform1f(location, values.beam.width))
      quad.set("intensity", (location) => gl.uniform1f(location, values.beam.intensity))
      quad.set("floorIntensity", (location) => gl.uniform1f(location, values.floor.intensity))
      quad.set("tint", (location) =>
        gl.uniform3f(
          location,
          ...(target.map((channel) => 1 + (channel / Math.max(...target) - 1) * Math.abs(temperature)) as [
            number,
            number,
            number,
          ]),
        ),
      )
      quad.set("shimmer", (location) => gl.uniform1f(location, values.beam.shimmer))
      quad.set("time", (location) => gl.uniform1f(location, time))
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.disableVertexAttribArray(corner)

      const count = Math.round(values.particles.count)
      if (!count) return
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(dots.program)
      gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer)
      const particle = gl.getAttribLocation(dots.program, "particle")
      const seed = gl.getAttribLocation(dots.program, "seed")
      gl.enableVertexAttribArray(particle)
      gl.enableVertexAttribArray(seed)
      gl.vertexAttribPointer(particle, 4, gl.FLOAT, false, 20, 0)
      gl.vertexAttribPointer(seed, 1, gl.FLOAT, false, 20, 16)
      dots.set("size", (location) => gl.uniform2f(location, width, height))
      dots.set("scale", (location) => gl.uniform1f(location, canvas.width / width))
      dots.set("time", (location) => gl.uniform1f(location, time * values.particles.speed))
      dots.set("sizeFactor", (location) => gl.uniform1f(location, values.particles.size))
      dots.set("twinkle", (location) => gl.uniform1f(location, values.particles.twinkle))
      dots.set("tone", (location) => gl.uniform3f(location, tone[0], tone[1], tone[2]))
      dots.set("brightness", (location) => gl.uniform1f(location, values.particles.brightness))
      gl.drawArrays(gl.POINTS, 0, Math.min(count, maxParticles))
      gl.disableVertexAttribArray(particle)
      gl.disableVertexAttribArray(seed)
    },
    dispose() {
      gl.getExtension("WEBGL_lose_context")?.loseContext()
    },
  }
}

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) throw new Error("WebGL shader")
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "WebGL shader")
    return shader
  }
  const result = gl.createProgram()
  gl.attachShader(result, compile(gl.VERTEX_SHADER, vertex))
  gl.attachShader(result, compile(gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(result)
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? "WebGL program")
  const locations = new Map<string, WebGLUniformLocation | null>()
  return {
    program: result,
    set(name: string, apply: (location: WebGLUniformLocation | null) => void) {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(result, name))
      apply(locations.get(name) ?? null)
    },
  }
}

function mulberry(seed: number) {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
