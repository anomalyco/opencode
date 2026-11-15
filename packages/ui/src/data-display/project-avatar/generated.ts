// Default project avatars: a soft "mesh gradient" (layered noise color waves on a gently folded, lit plane) with a
// coarse film grain. The values that define one icon, including its palette, are resolved once (see
// generateProjectIcon) and stored with the project, so a stored icon keeps drawing the same even if the defaults or
// palettes below change later. This mirrors the Mesh gradient generator and Grain effect of the project icon
// playground, ported from its fragment shader to a CPU pass so it needs no WebGL context.

export type GeneratedProjectIcon = {
  readonly style: string
  readonly version: number
  readonly params: Readonly<Record<string, number>>
}

export const GENERATED_PROJECT_ICON_STYLE = "mesh"

const DEFAULTS = {
  scale: 0.95,
  fold: 0.4,
  light: 1,
  tilt: -0.02,
  speed: 0.9,
  grain: 0.14,
  grainSize: 16,
}

// Paper first, then four inks, as in the playground's art palettes. The mesh uses the four inks.
export const PALETTES = [
  ["#f4efe6", "#1d3557", "#e63946", "#f1a208", "#2a9d8f"],
  ["#efe8d8", "#264653", "#e76f51", "#f4a261", "#e9c46a"],
  ["#f6f1eb", "#3d405b", "#e07a5f", "#81b29a", "#f2cc8f"],
  ["#fbf7f0", "#0b3954", "#087e8b", "#ff5a5f", "#c81d25"],
  ["#f5f0e6", "#5f0f40", "#9a031e", "#fb8b24", "#0f4c5c"],
  ["#eef0eb", "#10451d", "#4c956c", "#d68c45", "#f2e8cf"],
  ["#f7f3ec", "#22223b", "#4a4e69", "#9a8c98", "#c9ada7"],
  ["#fff8f0", "#3a0ca3", "#ff006e", "#3a86ff", "#ffbe0b"],
  ["#f2f2ed", "#003049", "#d62828", "#f77f00", "#fcbf49"],
  ["#f4f1de", "#335c67", "#e09f3e", "#9e2a2b", "#540b0e"],
  ["#f3efe7", "#2d3047", "#419d78", "#e0a458", "#ffdbb5"],
  ["#f1ece4", "#283618", "#606c38", "#dda15e", "#bc6c25"],
]

export function generateProjectIcon(key: string): GeneratedProjectIcon {
  const random = (tag: string) => mulberry32(cyrb53(`${key}|0|${tag}`))
  const palette = PALETTES[Math.floor(random("palette")() * PALETTES.length)]
  const seed = random("mesh")
  const grain = random("post")

  return {
    style: GENERATED_PROJECT_ICON_STYLE,
    version: 1,
    params: {
      ...DEFAULTS,
      seedX: seed() * 40,
      seedY: seed() * 40,
      grainX: Math.floor(grain() * 64),
      grainY: Math.floor(grain() * 64),
      ...Object.fromEntries(palette.slice(1).map((color, i) => [`color${i}`, parseInt(color.slice(1), 16)])),
    },
  }
}

/** Draws the icon `seconds` into its hover animation (0 is the static frame) into a square `px` × `px` context. */
export function drawProjectIcon(ctx: CanvasRenderingContext2D, px: number, icon: GeneratedProjectIcon, seconds: number) {
  const params = new Map([...Object.entries(DEFAULTS), ...Object.entries(icon.params)])
  const p = (key: string) => params.get(key) ?? 0

  const colors = [0, 1, 2, 3].map((i) => {
    const value = p(`color${i}`)

    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
  })

  const scale = p("scale")
  const fold = p("fold")
  const light = p("light")
  const tilt = p("tilt")
  const seedX = p("seedX")
  const seedY = p("seedY")
  const t = seconds * p("speed") * 0.6
  const across = Math.max(1, p("grainSize"))
  const amount = p("grain")
  const grainX = p("grainX")
  const grainY = p("grainY")

  const height = (x: number, y: number) => {
    const sx = x * 0.45 + t * 0.05
    const sy = y * 0.45 + t * 0.03

    return (0.7 * valueNoise(sx, sy) + 0.3 * valueNoise(sx * 2.3 + 3, sy * 2.3 + 3)) * fold
  }

  const [lx, ly, lz] = normalize(-0.4, 0.6, 0.7)
  const image = ctx.createImageData(px, px)
  const data = image.data

  for (let row = 0; row < px; row++) {
    for (let column = 0; column < px; column++) {
      // Shader coordinates: origin at the bottom left, sampled at pixel centers.
      const u = (column + 0.5) / px
      const v = (px - row - 0.5) / px
      const mask = tileMask(u, v, px)

      if (mask <= 0) continue
      const x = (u * 1.6) * scale * 1.6 + seedX
      const y = (v + u * tilt) * scale * 1.6 + seedY
      let r = colors[0][0]
      let g = colors[0][1]
      let b = colors[0][2]

      for (let i = 0; i < 3; i++) {
        const sx = x * (0.35 + 0.12 * i) + t * 0.05 * (i + 1)
        const sy = y * 0.6 + i * 3.7
        const n = 0.65 * valueNoise(sx, sy) + 0.35 * valueNoise(sx * 2.1 + 7, sy * 2.1 + 7)
        const k = smoothstep(0.35, 0.75, n)
        const c = colors[i + 1]
        r += (c[0] - r) * k
        g += (c[1] - g) * k
        b += (c[2] - b) * k
      }

      const e = 0.02
      const h = height(x, y)
      const [nx, ny, nz] = normalize(-(height(x + e, y) - h) / e, -(height(x, y + e) - h) / e, 1.4)
      const lit = nx * lx + ny * ly + nz * lz
      const shade = 1 + (0.78 + 0.38 * lit - 1) * light
      const gloss = Math.pow(Math.max(lit, 0), 18) * 0.25 * light
      // Film grain in coarse cells, `across` cells over the whole icon, offset per project.
      const gx = Math.floor((column * across) / px)
      const gy = Math.floor((row * across) / px)
      const noise = Math.sin((gx + grainX) * 127.1 + (gy + grainY) * 311.7) * 43758.5453
      const grain = (noise - Math.floor(noise) - 0.5) * 255 * amount
      const index = (row * px + column) * 4
      data[index] = clamp01(r * shade + gloss) * 255 + grain
      data[index + 1] = clamp01(g * shade + gloss) * 255 + grain
      data[index + 2] = clamp01(b * shade + gloss) * 255 + grain
      data[index + 3] = mask * 255
    }
  }

  ctx.putImageData(image, 0, 0)
}

// The playground's rounded tile: corner radius 22% of the size, antialiased over about one pixel.
export function tileMask(u: number, v: number, px: number) {
  const pixel = 1 / px
  const dx = Math.abs(u * 2 - 1) - 0.56
  const dy = Math.abs(v * 2 - 1) - 0.56
  const distance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - 0.44

  return 1 - smoothstep(-3 * pixel, pixel, distance)
}

// GLSL's float32 hash, evaluated in float32 so the CPU port picks the same lattice values as the playground shader.
function hash(x: number, y: number) {
  const f = Math.fround
  let px = fract(f(x * f(123.34)))
  let py = fract(f(y * f(456.21)))
  const d = f(f(px * f(px + f(45.32))) + f(py * f(py + f(45.32))))
  px = f(px + d)
  py = f(py + d)

  return fract(f(px * py))
}

export function valueNoise(x: number, y: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)

  return a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy
}

function fract(value: number) {
  return Math.fround(value - Math.floor(value))
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp01((value - edge0) / (edge1 - edge0))

  return t * t * (3 - 2 * t)
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function normalize(x: number, y: number, z: number) {
  const length = Math.hypot(x, y, z)

  return [x / length, y / length, z / length]
}

export function cyrb53(input: string) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  return (h1 ^ h2) >>> 0
}

export function mulberry32(seed: number) {
  let a = seed

  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
