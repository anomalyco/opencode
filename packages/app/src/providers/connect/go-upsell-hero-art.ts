// The Go upsell hero: the OpenCode GO letters on a dot grid. Lightspeed brings GO in from far away, and the
// warp's brake settles into a ring that the Ripple loop then continues. Every frame is a pure function of art
// time `t` (ms since the dialog opened), so the reduced-motion still is just one chosen frame.

type RGB = readonly [number, number, number]

export type HeroPalette = {
  light: boolean
  dot: RGB
  dotAlpha: number
  logoG: RGB
  logoO: RGB
  shadow: RGB
  accent: RGB
  peak: RGB
}

const PITCH = 8

// How much light the letters' counters (shadow cells, holes, the gap) take, as a fraction of the strokes'.
const COUNTER = 0.15

// The OpenCode pixel letters (packages/tui/src/logo.ts `go`): 4×5 units per letter, s = shadow.
const GO = ["GGGG.OOOO", "G....O..O", "GsGG.OssO", "GssG.OssO", "GGGG.OOOO"]

const LOGO_COLS = 18

const LOGO_ROWS = 10

type Kind = 0 | 1 | 2 // G, O, shadow

type LogoCell = { col: number; row: number; kind: Kind }

const LOGO: LogoCell[] = GO.flatMap((line, uy) =>
  Array.from(line).flatMap((ch, ux) => {
    if (ch === ".") return []
    let kind: Kind = 2

    if (ch === "G") kind = 0

    if (ch === "O") kind = 1

    return [0, 1, 2, 3].map((i) => ({ col: ux * 2 + (i % 2), row: uy * 2 + (i >> 1), kind }))
  }),
)

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ── math ──────────────────────────────────────────────────────────────────────
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))

  return t * t * (3 - 2 * t)
}

/** Instant attack, convex decay: a flash that cools. */
const flash = (age: number, tau: number) => (age < 0 ? 0 : Math.exp(-age / tau))

/** sin² window: rings fade in and out instead of popping. */
const envelope = (phase: number) => {
  const s = Math.sin(clamp01(phase) * Math.PI)

  return s * s * (3 - 2 * s)
}

const mixRGB = (a: RGB, b: RGB, t: number): RGB => {
  const k = clamp01(t)

  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp01(a).toFixed(3)})`

// Colours repeat from frame to frame, so each CSS colour string is built once.
const styles = new Map<number, string>()

function style(c: RGB, a: number) {
  const alpha = Math.round(clamp01(a) * 255)
  const key = ((c[0] << 16) | (c[1] << 8) | c[2]) * 256 + alpha
  const cached = styles.get(key)

  if (cached) return cached

  if (styles.size > 4096) styles.clear()

  const value = rgba(c, alpha / 255)
  styles.set(key, value)

  return value
}

// ── timeline (art ms) ─────────────────────────────────────────────────────────
// 0–340 gather · 340–520 warp attack · cruise to 900 · brake (τ 260) · GO arrives 340–1000, lands ~720
// 560 the brake ring leaves GO, slows with the warp, then drifts at the loop's speed
// 1400–2300 streaks cool and the grid returns · then Ripple: three rings per 4.6 s, a shimmer through GO
const ATTACK_START = 340

const ATTACK_END = 520

const BRAKE = 900

const BRAKE_TAU = 260

const PERIOD = 4600

const SPACING = PERIOD / 3

const BRAKE_RING_START = 560

/** The share of the field the brake ring covers on the warp's momentum, before it drifts like a loop ring. */
const BRAKE_RING_KICK = 0.45

/** When the brake ring would have launched had it drifted at the loop's speed all along. */
const RING_ORIGIN = BRAKE_RING_START - PERIOD * BRAKE_RING_KICK

/** Loop rings keep the brake ring's cadence: the first slot after it is skipped because GO is still landing. */
const LOOP_START = RING_ORIGIN + SPACING * 2

/** A settled loop frame for reduced motion: one ring mid-field, the next just leaving GO. */
export const STILL_TIME = LOOP_START + PERIOD * 0.42

/** Distance the warp has travelled (ms of full speed): the integral of its velocity. */
function warpDistance(t: number) {
  if (t <= ATTACK_START) return 0
  const span = ATTACK_END - ATTACK_START

  const attack = (x: number) => {
    const u = clamp01((x - ATTACK_START) / span)

    return span * (u * u * u - 0.5 * u * u * u * u)
  }

  if (t <= ATTACK_END) return attack(t)

  if (t <= BRAKE) return attack(ATTACK_END) + (t - ATTACK_END)

  return attack(ATTACK_END) + (BRAKE - ATTACK_END) + BRAKE_TAU * (1 - Math.exp(-(t - BRAKE) / BRAKE_TAU))
}

const WARP_TOTAL = warpDistance(Infinity)

function warpVelocity(t: number) {
  if (t <= ATTACK_START) return 0

  if (t <= ATTACK_END) return smoothstep(ATTACK_START, ATTACK_END, t)

  if (t <= BRAKE) return 1

  return Math.exp(-(t - BRAKE) / BRAKE_TAU)
}

/** GO's arrival scale: from far away with a small push past rest, never from zero. */
function arrivalScale(t: number) {
  const p = clamp01((t - ATTACK_START) / 660)

  return lerp(0.55, 1, 1 - (1 - p) ** 3) + Math.sin(p * Math.PI) * 0.06 * (1 - p)
}

/**
 * Field phase (0 at GO's centre, 1 past the edge) of the brake ring. Its speed is the loop's drift plus a share
 * of the warp's, so it slows with the brake and keeps going as the first Ripple ring, without a seam.
 */
function brakeRingPhase(t: number) {
  const warp = (warpDistance(t) - warpDistance(BRAKE_RING_START)) / (WARP_TOTAL - warpDistance(BRAKE_RING_START))

  return (t - BRAKE_RING_START) / PERIOD + BRAKE_RING_KICK * warp
}

const STARS = (() => {
  const random = rng(23)

  return Array.from({ length: 120 }, () => ({
    angle: random() * Math.PI * 2,
    r0: random(),
    speed: 0.55 + random() * 0.9,
    width: 0.6 + random() * 0.8,
  }))
})()

// ── geometry ──────────────────────────────────────────────────────────────────
type Geometry = ReturnType<typeof geometry>

function geometry(w: number, h: number, dpr: number) {
  const P = PITCH
  const logoLeft = Math.round(w / 2 - (LOGO_COLS / 2) * P)
  const logoTop = Math.round(h / 2 - (LOGO_ROWS / 2) * P)
  const ox = ((logoLeft % P) + P) % P
  const oy = ((logoTop % P) + P) % P
  const cols = Math.ceil((w - ox) / P) + 1
  const rows = Math.ceil((h - oy) / P) + 1
  const lc = Math.round((logoLeft - ox) / P)
  const lr = Math.round((logoTop - oy) / P)
  const cx = ox + (lc + LOGO_COLS / 2) * P
  const cy = oy + (lr + LOGO_ROWS / 2) * P
  const reach = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))
  const dist = new Float32Array(cols * rows)
  const falloff = new Float32Array(cols * rows)

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = ox + c * P + P / 2
      const y = oy + r * P + P / 2
      const d = Math.hypot(x - cx, (y - cy) * 1.25)
      dist[r * cols + c] = d
      // Fade toward the edges so the field never ends on a hard line.
      const edge = clamp01(Math.min(Math.min(x, w - x) / 48, Math.min(y, h - y) / 32))
      falloff[r * cols + c] = (1 - smoothstep(reach * 0.45, reach * 1.05, d)) * edge
    }

  const width = Math.round(w * dpr)
  const height = Math.round(h * dpr)
  // The grid is written as pixels and put in one call; see `draw`.
  const grid = layer(width, height)
  const pixels = grid.ctx.createImageData(width, height)
  const words = new Uint32Array(pixels.data.buffer)

  return {
    w,
    h,
    dpr,
    P,
    cols,
    rows,
    ox,
    oy,
    lc,
    lr,
    cx,
    cy,
    reach,
    dist,
    falloff,
    width,
    height,
    grid,
    pixels,
    field: new Float32Array(cols * rows),
    words,
    bloom: layer(width, height),
    bloomAlpha: new Uint8ClampedArray(words.length),
    bloomWords: new Uint32Array(words.length),
    bloomLevel: -1,
  }
}

type Layer = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; palette?: HeroPalette }

function layer(width: number, height: number): Layer {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  return { canvas, ctx: canvas.getContext("2d")! }
}

// ImageData is RGBA in memory, so a little-endian 32-bit word holds it as ABGR.
const pack = (r: number, g: number, b: number, alpha: number) =>
  ((alpha << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0

const BLOOM_MAX = 1.6

/** The bloom at full alpha, rendered once per size and palette, and kept as an alpha mask for the pixel path. */
function renderBloom(g: Geometry, pal: HeroPalette) {
  const { ctx } = g.bloom
  const [x, y] = [g.cx * g.dpr, g.cy * g.dpr]
  const grad = ctx.createRadialGradient(x, y, 0, x, y, LOGO_COLS * g.P * 0.9 * g.dpr)

  grad.addColorStop(0, rgba(pal.accent, 1))
  grad.addColorStop(0.45, rgba(pal.accent, 0.35))
  grad.addColorStop(1, rgba(pal.accent, 0))
  ctx.clearRect(0, 0, g.width, g.height)
  ctx.save()
  ctx.fillStyle = grad
  ctx.translate(x, y)
  ctx.scale(1.35, 0.8)
  ctx.translate(-x, -y)
  ctx.fillRect(0, 0, g.width, g.height)
  ctx.restore()
  const data = ctx.getImageData(0, 0, g.width, g.height).data

  for (let i = 0; i < g.bloomAlpha.length; i++) g.bloomAlpha[i] = data[i * 4 + 3]!

  g.bloom.palette = pal
  g.bloomLevel = -1
}

// ── one frame ─────────────────────────────────────────────────────────────────
// The intro composites layers with the canvas: bloom, streaks, the grid as one image, then GO. Once the streaks
// are gone the bloom is the only thing under the grid, so the steady loop blends grid over bloom in the pixel
// buffer and puts the whole frame at once, then draws GO. Both paths produce the same pixels.
const INTRO_END = 2300

function draw(ctx: CanvasRenderingContext2D, g: Geometry, pal: HeroPalette, t: number) {
  const { dpr, P, field } = g
  const R = g.reach * 1.1
  const v = warpVelocity(t)
  const D = warpDistance(t)
  field.fill(0)

  // Gather: energy collects at the source before the jump.
  const gather = smoothstep(0, ATTACK_START, t) * (1 - smoothstep(ATTACK_START, 560, t))
  // The grid steps back during the warp and returns as it cools.
  const dim = 1 - smoothstep(300, ATTACK_END, t) * (1 - smoothstep(1300, 2300, t)) * 0.8
  const breath = (0.5 + 0.5 * Math.sin(t * 0.0008)) * 0.05 * smoothstep(1800, 2600, t)

  const rings: { head: number; amp: number }[] = []

  if (t > BRAKE_RING_START) {
    const phase = brakeRingPhase(t)
    // Strong on the brake, calming to a loop ring's strength, then fading out like one.
    const amp = lerp(1, 0.55, smoothstep(BRAKE, 1700, t)) * smoothstep(BRAKE_RING_START, BRAKE_RING_START + 120, t)

    if (phase < 1) rings.push({ head: phase * R, amp: amp * (phase < 0.5 ? 1 : envelope(phase)) })
  }

  if (t > LOOP_START) {
    const newest = Math.floor((t - RING_ORIGIN) / SPACING)

    for (let n = Math.max(2, newest - 3); n <= newest; n++) {
      const phase = (t - RING_ORIGIN - n * SPACING) / PERIOD

      if (phase >= 0 && phase < 1) rings.push({ head: phase * R, amp: envelope(phase) * 0.55 })
    }
  }

  const crest = P * 2.6
  const tail = P * 8

  for (let i = 0; i < field.length; i++) {
    const d = g.dist[i]!
    let level = gather * Math.exp(-d / (P * 4)) * 0.9

    for (const ring of rings) {
      const delta = d - ring.head
      const c = Math.abs(delta) < crest ? 0.5 + 0.5 * Math.cos((delta / crest) * Math.PI) : 0
      const tl = delta < 0 && delta > -tail ? (1 + delta / tail) ** 2.3 : 0
      level += (c * 0.62 + tl * 0.16) * ring.amp * g.falloff[i]!
    }

    field[i] = level + breath * g.falloff[i]!
  }

  // Bloom: one soft radial fill behind GO, the only glow in the scene.
  const arrive = smoothstep(ATTACK_START, ATTACK_END, t)
  const landing = flash(t - 720, 260)
  const bloom = arrive * (0.4 + landing * 0.6 + gather * 0.8) + gather * 0.6 + breath * 2
  const bloomPeak = bloom > 0.01 ? (pal.light ? 0.1 : 0.16) * Math.min(BLOOM_MAX, bloom) : 0

  if (g.bloom.palette !== pal) renderBloom(g, pal)

  const { words, width, height } = g
  const steady = t >= INTRO_END

  if (steady) {
    // Rebuild the bloom pixels only when its peak moves by a quarter of an 8-bit step.
    const level = Math.round(bloomPeak * 1020)

    if (level !== g.bloomLevel) {
      const color = pack(pal.accent[0], pal.accent[1], pal.accent[2], 0)

      for (let i = 0; i < g.bloomWords.length; i++)
        g.bloomWords[i] = (color | (Math.round(g.bloomAlpha[i]! * bloomPeak) << 24)) >>> 0

      g.bloomLevel = level
    }

    words.set(g.bloomWords)
  } else {
    ctx.globalCompositeOperation = "copy"
    ctx.globalAlpha = bloomPeak
    ctx.drawImage(g.bloom.canvas, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = "source-over"
    words.fill(0)
  }

  // Warp streaks emerge from behind GO and fade before the hero's sides.
  const cool = 1 - smoothstep(1400, 2300, t)

  if (!steady && cool > 0 && t > ATTACK_START) {
    const hw = (LOGO_COLS / 2 + 1) * P
    const hh = (LOGO_ROWS / 2 + 1) * P
    const color = mixRGB(pal.accent, pal.peak, v * 0.5)
    ctx.lineCap = "round"

    for (const s of STARS) {
      const dx = Math.cos(s.angle)
      const dy = Math.sin(s.angle) * 0.8
      const edge = Math.min(hw / Math.max(1e-3, Math.abs(dx)), hh / Math.max(1e-3, Math.abs(dy)))
      const travel = (s.r0 * R + D * s.speed * 0.9) % R
      const r = edge + travel
      const len = Math.max(1.2, v * s.speed * P * 7 * Math.min(1, travel / (P * 10)))
      const x1 = g.cx + dx * r
      const y1 = g.cy + dy * r
      const edgeFade = clamp01(Math.min(x1, g.w - x1) / 64) * clamp01(Math.min(y1, g.h - y1) / 36)
      const alpha = smoothstep(0, P * 3, travel) * cool * (0.3 + 0.5 * v) * edgeFade

      if (alpha < 0.01) continue
      const r0 = Math.max(edge, r - len)
      ctx.strokeStyle = style(color, alpha)
      ctx.lineWidth = s.width * 1.5 * dpr
      ctx.beginPath()
      ctx.moveTo((g.cx + dx * r0) * dpr, (g.cy + dy * r0) * dpr)
      ctx.lineTo(x1 * dpr, y1 * dpr)
      ctx.stroke()
    }
  }

  // The grid: resting dots grow into lit cells as energy reaches them. Cells are whole-pixel squares.
  const dot = Math.max(1.5, P * 0.19)
  const full = P * 0.74
  const lit = pal.light ? 0.75 : 0.85
  const accent = pal.accent
  const dotColor = pal.dot
  // The intro composites only the part of the grid that has cells in it.
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0

  for (let r = 0; r < g.rows; r++) {
    const y = g.oy + r * P + P / 2

    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c
      const fall = g.falloff[i]!
      // Inside GO's box the grid is the letters' counters: it stays dim so GO reads as one solid shape.
      const inLogo = c >= g.lc && c < g.lc + LOGO_COLS && r >= g.lr && r < g.lr + LOGO_ROWS
      const e = Math.min(1, field[i]!) * (inLogo ? COUNTER : 1)
      const base = pal.dotAlpha * fall * dim

      if (base < 0.004 && e < 0.01) continue
      const x = g.ox + c * P + P / 2
      const s = lerp(dot, full, e ** 1.3) * dpr
      const size = Math.round(s)
      const left = Math.round(x * dpr - s / 2)
      const top = Math.round(y * dpr - s / 2)
      // The cell colour mixes from the dot towards the accent; kept in scalars, as this runs for every cell.
      const k = clamp01(e * 1.6)
      const red = dotColor[0] + (accent[0] - dotColor[0]) * k
      const green = dotColor[1] + (accent[1] - dotColor[1]) * k
      const blue = dotColor[2] + (accent[2] - dotColor[2]) * k
      const alpha = Math.round(clamp01(base + e * lit * fall) * 255)
      const word = pack(red, green, blue, alpha)
      const x0 = Math.max(0, left)
      const x1 = Math.min(width, left + size)
      const y0 = Math.max(0, top)
      const y1 = Math.min(height, top + size)
      minX = Math.min(minX, x0)
      minY = Math.min(minY, y0)
      maxX = Math.max(maxX, x1)
      maxY = Math.max(maxY, y1)

      for (let py = y0; py < y1; py++) {
        const row = py * width

        for (let px = x0; px < x1; px++) {
          const under = words[row + px]! >>> 24
          // Over a transparent pixel the cell is copied; over the bloom it is blended like source-over.
          words[row + px] = under === 0 ? word : over(red, green, blue, alpha, accent, under)
        }
      }
    }
  }

  if (steady) ctx.putImageData(g.pixels, 0, 0)
  else if (maxX > minX && maxY > minY) {
    const [sw, sh] = [maxX - minX, maxY - minY]
    g.grid.ctx.putImageData(g.pixels, 0, 0, minX, minY, sw, sh)
    ctx.drawImage(g.grid.canvas, minX, minY, sw, sh, minX, minY, sw, sh)
  }

  // GO, drawn last so nothing passes over it. The Ripple shimmer crosses it as each ring leaves the centre.
  const maxD = Math.hypot(LOGO_COLS / 2, LOGO_ROWS / 2)
  const shimmer = smoothstep(LOOP_START - 400, LOOP_START + 500, t)

  const heads = [0, 0.5].map((off) => {
    const ph = ((((t - RING_ORIGIN) / PERIOD + off + 0.71) % 1) + 1) % 1

    return { head: ph * (maxD + 6), amp: envelope(ph) * shimmer }
  })

  const scale = arrivalScale(t)
  const gap = Math.max(1, Math.round(P * 0.14 * dpr)) / dpr

  for (const cell of LOGO) {
    const d = Math.hypot(cell.col + 0.5 - LOGO_COLS / 2, cell.row + 0.5 - LOGO_ROWS / 2)
    let peak = landing * 0.8
    let glow = (1 - smoothstep(ATTACK_END, 1100, t)) * 0.7 * arrive + landing * 0.3

    for (const h of heads) {
      const delta = d - h.head
      peak += Math.exp(-(Math.abs(delta / 1.3) ** 1.8)) * 0.5 * h.amp
      glow += (delta < 0 && delta > -6 ? (1 + delta / 6) ** 2.6 : 0) * 0.3 * h.amp
    }

    // Shadow cells are counters once they settle: they take only a fraction of the strokes' light.
    const damp = cell.kind === 2 ? lerp(1, COUNTER, smoothstep(0.7, 1, arrive)) : 1
    const tone = [pal.logoG, pal.logoO, pal.shadow][cell.kind]!
    const hot = mixRGB(mixRGB(tone, pal.accent, Math.min(1, glow) * damp), pal.peak, Math.min(1, peak) * damp)
    const color = arrive < 0.3 ? mixRGB(pal.dot, hot, arrive / 0.3) : hot
    const alpha = lerp(pal.dotAlpha * 1.4, 1, smoothstep(0, 0.6, arrive)) * arrive

    if (alpha <= 0.002) continue
    const s = lerp(dot, P - gap, arrive ** 1.2) * scale * dpr
    const x = (g.cx + (g.ox + (g.lc + cell.col) * P + P / 2 - g.cx) * scale) * dpr - s / 2
    const y = (g.cy + (g.oy + (g.lr + cell.row) * P + P / 2 - g.cy) * scale) * dpr - s / 2
    ctx.fillStyle = style(color, alpha)

    // Snap only at rest on the grid; while GO scales in, cells keep sub-pixel positions.
    if (scale === 1) ctx.fillRect(Math.round(x), Math.round(y), Math.round(s), Math.round(s))
    else ctx.fillRect(x, y, s, s)
  }
}

/** Source-over of a cell colour on a pixel of bloom (accent at `under`/255 alpha), unpremultiplied for ImageData. */
function over(red: number, green: number, blue: number, alpha: number, accent: RGB, under: number) {
  const a = alpha / 255
  const b = (under / 255) * (1 - a)
  const out = a + b
  const k = out > 0 ? 1 / out : 0

  return pack(
    (red * a + accent[0] * b) * k,
    (green * a + accent[1] * b) * k,
    (blue * a + accent[2] * b) * k,
    Math.round(out * 255),
  )
}

// ── theme ─────────────────────────────────────────────────────────────────────
function parseColor(ctx: CanvasRenderingContext2D, value: string, fallback: RGB): RGB {
  if (!value) return fallback
  ctx.fillStyle = "#000"
  ctx.fillStyle = value
  const css = String(ctx.fillStyle).trim()
  const hex = /^#([0-9a-f]{3,8})$/i.exec(css)?.[1]

  if (hex) {
    const full = hex.length <= 4 ? Array.from(hex, (ch) => ch + ch).join("") : hex

    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(css)

  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]

  return fallback
}

/** The hero's colours, read from the v2 theme tokens so it follows light, dark and custom themes. */
export function readPalette(el: Element, ctx: CanvasRenderingContext2D): HeroPalette {
  const style = getComputedStyle(el)
  const token = (name: string, fallback: RGB) => parseColor(ctx, style.getPropertyValue(name).trim(), fallback)
  const surface = token("--v2-background-bg-layer-01", [36, 36, 36])
  const light = (surface[0] * 0.2126 + surface[1] * 0.7152 + surface[2] * 0.0722) / 255 > 0.5
  const text = token("--v2-text-text-base", light ? [22, 22, 22] : [250, 250, 250])
  const accent = light ? token("--v2-orange-800", [209, 100, 39]) : token("--v2-orange-500", [255, 164, 120])

  return {
    light,
    dot: text,
    dotAlpha: light ? 0.11 : 0.1,
    logoG: light ? token("--v2-text-text-faint", [128, 128, 128]) : token("--v2-text-text-muted", [174, 174, 174]),
    logoO: text,
    shadow: light
      ? token("--v2-background-bg-layer-04", [219, 219, 219])
      : token("--v2-background-bg-layer-03", [58, 58, 58]),
    accent,
    peak: light ? accent : token("--v2-text-text-contrast", [255, 255, 255]),
  }
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
/**
 * Runs the hero on `canvas` until the returned function is called. One rAF loop, only while the page is visible
 * and motion is allowed; reduced motion draws a single still. Hidden time does not advance the art.
 */
export function mountGoUpsellHero(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")

  if (!ctx) return () => {}

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
  let palette = readPalette(canvas, ctx)
  let g: Geometry | undefined
  let raf = 0
  let last = 0
  let t = 0

  const render = () => {
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)

    if (!g || g.w !== w || g.h !== h || g.dpr !== dpr) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      g = geometry(w, h, dpr)
    }

    draw(ctx, g, palette, reduce.matches ? STILL_TIME : t)
  }

  const tick = (now: number) => {
    t += Math.min(100, now - last)
    last = now
    render()
    raf = requestAnimationFrame(tick)
  }

  const run = () => {
    cancelAnimationFrame(raf)
    raf = 0

    if (reduce.matches) return render()

    if (document.hidden) return
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  // A still has to be redrawn when its size, pixel ratio or theme changes; a running loop picks them up next frame.
  const redraw = () => {
    if (!raf) render()
  }

  // A resolution query matches only the current ratio, so each change re-arms it for the new one.
  let density: MediaQueryList | undefined

  function watchDensity() {
    density?.removeEventListener("change", onDensity)
    density = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    density.addEventListener("change", onDensity)
  }

  function onDensity() {
    watchDensity()
    redraw()
  }

  const restyle = () => {
    palette = readPalette(canvas, ctx)
    redraw()
  }

  const resize = new ResizeObserver(redraw)
  resize.observe(canvas)
  const theme = new MutationObserver(restyle)
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-color-scheme", "data-theme", "style", "class"],
  })
  document.addEventListener("visibilitychange", run)
  reduce.addEventListener("change", run)
  watchDensity()
  run()

  return () => {
    cancelAnimationFrame(raf)
    raf = 0
    resize.disconnect()
    theme.disconnect()
    document.removeEventListener("visibilitychange", run)
    reduce.removeEventListener("change", run)
    density?.removeEventListener("change", onDensity)
  }
}
