// Project icon styles from machines and mathematics: retro computing and plotted or generated curves. See procedural.ts
// for the contract.

import { mulberry32 } from "./generated"
import {
  colors,
  css,
  fbm,
  grain,
  hsl,
  int,
  legible,
  luma,
  mix,
  palette,
  pick,
  prefixed,
  ramped,
  range,
  seed,
  shade,
  shuffle,
  tint,
  type Definition,
} from "./procedural-kit"

// Background, text, accent.
const TERMINALS = [
  [0x0c120c, 0x39ff7a, 0x1d6b3a],
  [0x140d05, 0xffb43a, 0x7a5218],
  [0x002b36, 0x93a1a1, 0xb58900],
  [0x282a36, 0xf8f8f2, 0xff79c6],
  [0x1d3fb0, 0xffffff, 0xffd166],
  [0xf4f1ea, 0x1a1a1a, 0xc8102e],
  [0x1e1e2e, 0xa6e3a1, 0x89b4fa],
]

// Three-by-five prompt glyphs, three bits a row: >, $, #, λ, %, ❯.
const PROMPTS = [
  [0b100, 0b010, 0b001, 0b010, 0b100],
  [0b011, 0b110, 0b010, 0b011, 0b110],
  [0b101, 0b111, 0b101, 0b111, 0b101],
  [0b100, 0b010, 0b010, 0b101, 0b101],
  [0b101, 0b001, 0b010, 0b100, 0b101],
  [0b110, 0b011, 0b001, 0b011, 0b110],
]

const MASKS = [0x0f5132, 0x123a6b, 0x111418, 0x3b1f5c, 0x6b1a1a, 0x1d5c5c]

const COPPERS = [0xd4af37, 0xc8743a, 0xc9c9c9]

// Segments a–g, a in the high bit, for 0–9 and A–F.
const SEGMENTS = [
  0b1111110, 0b0110000, 0b1101101, 0b1111001, 0b0110011, 0b1011011, 0b1011111, 0b1110000, 0b1111111, 0b1111011,
  0b1110111, 0b0011111, 0b1001110, 0b0111101, 0b1001111, 0b1000111,
]

// Panel, lit segment.
const DISPLAYS = [
  [0x1a0505, 0xff3b30],
  [0x04140a, 0x39ff7a],
  [0x140c02, 0xffb000],
  [0x030c17, 0x4fc3ff],
  [0x05100f, 0x7af5e1],
  [0xd8dccf, 0x1f2420],
]

// Darkest to lightest.
const HANDHELDS = [
  [0x0f380f, 0x306230, 0x8bac0f, 0x9bbc0f],
  [0x2b2b26, 0x6b6b5e, 0xa9a99a, 0xd6d6c4],
  [0x002b2b, 0x1f6b5f, 0x5fb8a0, 0x9fe8d0],
  [0x331e50, 0xa63725, 0xd68e49, 0xf7e7c6],
  [0x081820, 0x346856, 0x88c070, 0xe0f8d0],
  [0x2c2137, 0x764462, 0xa96868, 0xedb4a1],
]

const SPECTRUM = [0x0000d7, 0xd70000, 0xd700d7, 0x00d700, 0x00d7d7, 0xd7d700, 0xd7d7d7]

const DISKS = [0x1a1a1a, 0x1f4fa0, 0xd9d2c0, 0xc8102e, 0x2a9d8f, 0xf2c230, 0x6b3fa0, 0xff6fb5]

const TAPES = [0x1a1a1a, 0xb8bcc2, 0xf4f1ea, 0xe86a2b, 0x2457c5, 0xc8102e]

const STRIPES = [
  [0xf28c28, 0xc8102e],
  [0xffd166, 0x2a9d8f],
  [0x3ad6ff, 0xff4fd8],
  [0xe9c46a, 0x264653],
  [0xffffff, 0xffffff],
]

const PHOSPHORS = [0x39ff7a, 0xffb43a, 0x6fe3ff, 0xff6fb5, 0xd6e4ff]

const LISSAJOUS = [
  [1, 2],
  [2, 3],
  [3, 4],
  [3, 2],
  [1, 3],
  [5, 4],
  [3, 5],
]

const COATS = [
  [0xe0b060, 0x2b1d10],
  [0xf2e2c0, 0x9c5a2c],
  [0xf4f1ea, 0x161616],
  [0xd9e7d2, 0x24443a],
  [0xff8a65, 0x5d1f2a],
  [0x2b2d42, 0xedf2f4],
]

// Sky, ground, bark, leaves.
const SEASONS = [
  [0xfdf0f2, 0x9cc28a, 0x5a3d2b, 0xffa3bf],
  [0xd9f1ff, 0x6aa84f, 0x5a3d2b, 0x3f8f4a],
  [0xfbe7c2, 0xb07a3a, 0x4a2f1f, 0xe76f51],
  [0xc9d6e3, 0xf4f8fb, 0x3a2f2a, 0xffffff],
  [0x14183a, 0x0c1024, 0x05070f, 0x3a6e5a],
  [0xf4efe6, 0xe9e0cf, 0x1d3557, 0x2a9d8f],
]

const RETRO: Definition[] = [
  {
    id: "terminal",
    name: "Terminal",
    family: "Retro tech",
    label: "A prompt and a blinking cursor in a terminal theme, alone, in a session or in a window",
    animated: true,
    resolve: (random) => {
      const r = random("terminal")

      return {
        grid: 16,
        ...prefixed("t", pick(r, TERMINALS)),
        prompt: int(r, 0, PROMPTS.length - 1),
        layout: int(r, 0, 2),
        seed: seed(r),
      }
    },
    paint: (pixels, p, t) => {
      const [ground, text, accent] = colors(p, "t", 3)
      const rand = mulberry32(p.seed)
      const prompt = PROMPTS[p.prompt]
      const cursor = t % 1 < 0.55
      const dim = mix(ground, text, 0.45)
      pixels.fill(ground)

      const glyph = (x0: number, y0: number, scale: number, color: number) => {
        for (let y = 0; y < 5 * scale; y++)
          for (let x = 0; x < 3 * scale; x++)
            if ((prompt[Math.floor(y / scale)] >> (2 - Math.floor(x / scale))) & 1) pixels.set(x0 + x, y0 + y, color)
      }

      const words = (x0: number, y: number, max: number, color: number) => {
        const typed = Math.floor(t * 8)
        let x = x0

        while (x < max) {
          const length = 1 + Math.floor(rand() * 4)
          pixels.rect(x, y, Math.min(length, max - x), 2, color)
          x += length + 1
        }

        return Math.min(max, x0 + typed)
      }

      const layouts = [
        () => {
          glyph(2, 3, 2, accent)

          if (cursor) pixels.rect(9, 11, 5, 2, text)
        },
        () => {
          glyph(1, 1, 1, accent)
          words(5, 2, 15, text)
          words(1, 7, 13, dim)
          glyph(1, 10, 1, accent)

          if (cursor) pixels.rect(5, 11, 2, 3, text)
        },
        () => {
          pixels.rect(0, 0, 16, 3, mix(ground, text, 0.18))
          ;[1, 3, 5].forEach((x, i) => pixels.set(x, 1, [0xff5f57, 0xfebc2e, 0x28c840][i]))
          glyph(1, 5, 1, accent)
          words(5, 6, 14, text)
          glyph(1, 11, 1, accent)

          if (cursor) pixels.rect(5, 12, 2, 3, text)
        },
      ]

      layouts[p.layout]()
    },
  },
  {
    id: "circuit",
    name: "Circuit",
    family: "Retro tech",
    label: "A chip on a solder mask with traces fanning from its pins to vias; a signal runs the traces on hover",
    animated: true,
    resolve: (random) => {
      const r = random("circuit")
      const width = pick(r, [4, 6, 6, 8])
      const height = pick(r, [4, 6, 6])

      return {
        grid: 16,
        seed: seed(r),
        mask: pick(r, MASKS),
        copper: pick(r, COPPERS),
        width,
        height,
        x: int(r, 3, 13 - width),
        y: int(r, 3, 13 - height),
        density: range(r, 0.45, 0.9),
      }
    },
    paint: (pixels, p, t) => {
      const rand = mulberry32(p.seed)
      const used = new Set<number>()
      const trace = shade(p.copper, 0.85)
      const x1 = p.x + p.width - 1
      const y1 = p.y + p.height - 1

      pixels.fill(p.mask)
      pixels.each((x, y) => (grain(x, y, 4) < 0.07 ? mix(p.mask, 0x000000, 0.25) : undefined))
      pixels.rect(p.x - 1, p.y - 1, p.width + 2, p.height + 2, mix(p.mask, 0x000000, 0.3))
      pixels.rect(p.x, p.y, p.width, p.height, 0x1c1c22)
      pixels.rect(p.x, p.y, p.width, 1, 0x2e2e36)
      pixels.set(p.x + 1, p.y + 1, 0x5a5a64)

      for (let y = p.y - 1; y <= y1 + 1; y++) for (let x = p.x - 1; x <= x1 + 1; x++) used.add(y * 16 + x)

      const pins = [
        ...Array.from({ length: p.width / 2 }, (_, k) => [p.x + k * 2 + 1, p.y - 1, 0, -1]),
        ...Array.from({ length: p.width / 2 }, (_, k) => [p.x + k * 2, y1 + 1, 0, 1]),
        ...Array.from({ length: p.height / 2 }, (_, k) => [p.x - 1, p.y + k * 2 + 1, -1, 0]),
        ...Array.from({ length: p.height / 2 }, (_, k) => [x1 + 1, p.y + k * 2, 1, 0]),
      ]

      const paths = pins.flatMap(([px, py, dx, dy]) => {
        pixels.set(px, py, p.copper)

        if (rand() > p.density) return []
        const path = [[px, py]]
        const bend = rand() < 0.5 ? 0 : rand() < 0.5 ? 1 : -1
        const turnAt = 1 + Math.floor(rand() * 3)
        const length = 2 + Math.floor(rand() * 8)

        for (let k = 1; k <= length; k++) {
          const [x, y] = path[path.length - 1]
          const jog = k > turnAt && k <= turnAt + 2 ? bend : 0
          const next = [x + dx + (dy ? jog : 0), y + dy + (dx ? jog : 0)]

          if (next[0] < 0 || next[1] < 0 || next[0] > 15 || next[1] > 15 || used.has(next[1] * 16 + next[0])) break
          used.add(next[1] * 16 + next[0])
          path.push(next)
        }

        return path.length > 2 ? [path] : []
      })

      paths.forEach((path) => path.slice(1).forEach(([x, y]) => pixels.set(x, y, trace)))
      paths.forEach((path) => {
        const [x, y] = path[path.length - 1]

        if (x <= 0 || y <= 0 || x >= 15 || y >= 15) return
        pixels.set(x, y, mix(p.mask, 0x000000, 0.5))
        ;[
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].forEach(([dx, dy]) => !used.has((y + dy) * 16 + x + dx) && pixels.set(x + dx, y + dy, p.copper))
      })

      if (t <= 0) return
      paths.forEach((path, i) => {
        const [x, y] = path[Math.floor(t * 8 + i * 3) % path.length]
        pixels.set(x, y, tint(p.copper, 0.7))
      })
    },
  },
  {
    id: "seven-segment",
    name: "Seven-segment",
    family: "Retro tech",
    label: "Two LED or VFD digits, decimal or hex, upright or slanted, with ghosted segments; they count on hover",
    animated: true,
    resolve: (random) => {
      const r = random("segments")
      const [panel, lit] = pick(r, DISPLAYS)

      return {
        grid: 16,
        panel,
        lit,
        hex: r() < 0.3 ? 1 : 0,
        value: int(r, 0, 255),
        slant: r() < 0.5 ? 1 : 0,
        dot: int(r, 0, 2),
      }
    },
    paint: (pixels, p, t) => {
      const base = p.hex ? 16 : 10
      const value = (p.value + Math.floor(t * 5)) % (base * base)
      const off = mix(p.panel, p.lit, 0.13)
      pixels.fill(p.panel)
      pixels.rect(0, 0, 16, 1, shade(p.panel, 0.6))
      pixels.rect(0, 15, 16, 1, tint(p.panel, 0.06))

      const digit = (x0: number, n: number) => {
        const bits = SEGMENTS[n]
        const put = (segment: number, x: number, y: number) => {
          const lean = p.slant ? Math.floor((12 - y) / 4) : 0
          pixels.set(x0 + x + lean, 3 + y, (bits >> (6 - segment)) & 1 ? p.lit : off)
        }

        for (let k = 1; k <= 3; k++) {
          put(0, k, 0)
          put(3, k, 8)
          put(6, k, 4)
          put(1, 4, k)
          put(2, 4, k + 4)
          put(5, 0, k)
          put(4, 0, k + 4)
        }
      }

      digit(1, Math.floor(value / base))
      digit(9, value % base)

      if (p.dot === 1) pixels.set(7, 11, p.lit)

      if (p.dot === 2) {
        pixels.set(7 + (p.slant ? 1 : 0), 5, t % 1 < 0.5 ? p.lit : off)
        pixels.set(7, 9, t % 1 < 0.5 ? p.lit : off)
      }
    },
  },
  {
    id: "game-boy",
    name: "Handheld",
    family: "Retro tech",
    label: "A tiny platformer scene in four tones of a classic handheld screen; the hero hops on hover",
    animated: true,
    resolve: (random) => {
      const r = random("handheld")

      return {
        grid: 16,
        ...prefixed("g", pick(r, HANDHELDS)),
        hero: int(r, 1, 11),
        block: int(r, 2, 12),
        blockY: int(r, 4, 6),
        cloud: int(r, 0, 12),
        prop: int(r, 0, 2),
        propX: int(r, 1, 12),
        bricks: r() < 0.5 ? 1 : 0,
      }
    },
    paint: (pixels, p, t) => {
      const [darkest, dark, light, lightest] = colors(p, "g", 4)
      const ground = 12
      const hop = Math.max(0, Math.round(Math.sin(t * 5) * 3))
      pixels.fill(lightest)

      const cloudX = Math.round(p.cloud - t * 2) % 16
      pixels.rect(cloudX + 1, 2, 3, 1, light)
      pixels.rect(cloudX, 3, 5, 1, light)

      const props = [
        () => {
          pixels.rect(p.propX, ground - 4, 3, 4, dark)
          pixels.rect(p.propX - 1, ground - 5, 5, 2, dark)
          pixels.rect(p.propX, ground - 5, 1, 5, light)
        },
        () =>
          pixels.each((x, y) => (y < ground && Math.hypot(x + 0.5 - (p.propX + 1.5), y + 0.5 - ground) < 3.5 ? light : undefined)),
        () => undefined,
      ]

      props[p.prop]()
      pixels.rect(p.block, p.blockY, 3, 3, dark)
      pixels.rect(p.block, p.blockY, 3, 1, light)
      pixels.set(p.block + 1, p.blockY + 1, lightest)

      pixels.each((x, y) => {
        if (y < ground) return undefined

        if (y === ground) return dark

        return p.bricks && (y % 2 === 1 ? x % 4 === 0 : x % 4 === 2) ? darkest : (y + x) % 5 === 0 ? dark : light
      })

      const hx = p.hero
      const hy = ground - 5 - hop
      pixels.rect(hx + 1, hy, 2, 1, darkest)
      pixels.rect(hx, hy + 1, 4, 2, darkest)
      pixels.set(hx + 2, hy + 1, lightest)
      pixels.rect(hx + 1, hy + 3, 2, 1, dark)
      pixels.set(hx, hy + 4, darkest)
      pixels.set(hx + 3, hy + 4, darkest)
    },
  },
  {
    id: "spectrum",
    name: "Tape loader",
    family: "Retro tech",
    label: "Loading-border stripes around a paper with the four-colour rainbow flash; the stripes roll on hover",
    animated: true,
    resolve: (random) => {
      const r = random("spectrum")
      const [inkA, inkB] = shuffle(r, SPECTRUM)
      const pilot = r() < 0.5

      return {
        grid: 16,
        seed: seed(r),
        stripeA: pilot ? 0xd70000 : inkA,
        stripeB: pilot ? 0x00d7d7 : inkB,
        data: r() < 0.5 ? 1 : 0,
        paper: pick(r, [0x000000, 0x000000, 0xd7d7d7, 0x0000d7]),
        corner: int(r, 0, 3),
        border: pick(r, [2, 2, 3]),
        width: pick(r, [1, 2, 2]),
      }
    },
    paint: (pixels, p, t) => {
      const rand = mulberry32(p.seed)
      const roll = Math.floor(t * 12)
      const rows = Array.from({ length: 32 }, (_, i) => (p.data ? rand() < 0.5 : Math.floor(i / 2) % 2 === 0))
      const rainbow = [0xff0000, 0xffff00, 0x00ff00, 0x00ffff]
      const inner = 16 - p.border * 2

      pixels.each((x, y) => {
        if (x < p.border || y < p.border || x >= 16 - p.border || y >= 16 - p.border) return rows[(y + roll) % 32] ? p.stripeA : p.stripeB
        const lx = p.corner & 1 ? inner - 1 - (x - p.border) : x - p.border
        const ly = p.corner & 2 ? inner - 1 - (y - p.border) : y - p.border
        const d = lx + ly - (inner - 1)

        if (d >= 0 && d < 4 * p.width) return rainbow[Math.floor(d / p.width)]

        return p.paper
      })
    },
  },
  {
    id: "floppy",
    name: "Floppy",
    family: "Retro tech",
    label: "A 3½-inch disk in one of eight shells with a lined, striped or blank label; the shutter slides on hover",
    animated: true,
    resolve: (random) => {
      const r = random("floppy")
      const all = colors(palette(random("palette")))
      const body = pick(r, DISKS)

      return {
        grid: 16,
        body,
        ground: legible(r, all, body),
        label: int(r, 0, 3),
        labelColor: pick(r, [0xf6f3ec, 0xf6f3ec, 0xffe9a8, 0xd6ecff]),
        stripe: pick(r, all.slice(1)),
        ink: pick(r, [0x1f4fa0, 0x1a1a1a, 0xc8102e]),
        seed: seed(r),
      }
    },
    paint: (pixels, p, t) => {
      const rand = mulberry32(p.seed)
      const metal = 0xb8bec6
      const slide = Math.round(Math.min(1, t * 2) * 2)
      pixels.fill(p.ground)
      pixels.rect(1, 1, 14, 14, p.body)
      pixels.set(14, 1, p.ground)
      pixels.rect(1, 14, 14, 1, shade(p.body, 0.75))
      pixels.rect(4 + slide, 1, 7, 5, metal)
      pixels.rect(4 + slide, 1, 7, 1, tint(metal, 0.3))
      pixels.rect(8 + slide, 2, 2, 3, shade(p.body, 0.5))
      pixels.rect(2, 13, 1, 1, shade(p.body, 0.4))
      pixels.rect(3, 7, 10, 7, p.labelColor)

      const labels = [
        () => [9, 11].forEach((y) => pixels.rect(4, y, 4 + Math.floor(rand() * 5), 1, p.ink)),
        () => {
          pixels.rect(3, 7, 10, 2, p.stripe)
          pixels.rect(4, 11, 6, 1, p.ink)
        },
        () => [7, 9, 11].forEach((y, i) => pixels.rect(3, y, 10, 1, hsl(i * 0.12 + rand() * 0.5, 0.7, 0.55))),
        () => undefined,
      ]

      labels[p.label]()
    },
  },
  {
    id: "cassette",
    name: "Cassette",
    family: "Retro tech",
    label: "A compact cassette with striped label and tape on both reels; the reels turn on hover",
    animated: true,
    resolve: (random) => {
      const r = random("cassette")
      const all = colors(palette(random("palette")))
      const body = pick(r, TAPES)
      const [a, b] = pick(r, STRIPES)

      return {
        grid: 16,
        body,
        ground: legible(r, all, body),
        a,
        b,
        labelColor: pick(r, [0xf6f3ec, 0xf2e3c4, 0x1a1a1a]),
        tape: range(r, 0.2, 0.8),
      }
    },
    paint: (pixels, p, t) => {
      const window = 0x2a2422
      const tape = 0x5a3a24
      const spin = Math.floor(t * 8) % 4
      pixels.fill(p.ground)
      pixels.rect(0, 3, 16, 10, p.body)
      pixels.rect(0, 12, 16, 1, shade(p.body, 0.7))
      pixels.rect(1, 4, 14, 6, p.labelColor)
      pixels.rect(1, 4, 14, 1, p.a)
      pixels.rect(1, 9, 14, 1, p.b)
      pixels.rect(4, 6, 8, 3, window)
      ;[
        [5, p.tape],
        [10, 1 - p.tape],
      ].forEach(([x, amount]) => {
        if (amount > 0.45) pixels.rect(x - 1, 6, 3, 3, tape)
        pixels.set(x, 7, 0xf6f3ec)
        const [dx, dy] = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ][(spin + x) % 4]
        pixels.set(x + dx, 7 + dy, t > 0 ? 0xf6f3ec : amount > 0.45 ? tape : window)
      })
      pixels.rect(4, 10, 8, 2, shade(p.body, 0.82))
      ;[5, 10].forEach((x) => pixels.set(x, 11, shade(p.body, 0.5)))
      ;[
        [0, 3],
        [15, 3],
        [0, 12],
        [15, 12],
      ].forEach(([x, y]) => pixels.set(x, y, p.ground))
    },
  },
]

const CURVES: Definition[] = [
  {
    id: "lissajous",
    name: "Lissajous",
    family: "Tiling and curves",
    label: "A Lissajous figure on an oscilloscope or in ink on paper; its phase drifts on hover",
    animated: true,
    resolve: (random) => {
      const r = random("lissajous")
      const all = colors(palette(random("palette")))
      const scope = r() < 0.55
      const [a, b] = pick(r, LISSAJOUS)

      return {
        a,
        b,
        delta: r() * Math.PI,
        scope: scope ? 1 : 0,
        ground: scope ? mix(0x050807, pick(r, PHOSPHORS), 0.05) : all[0],
        ink: scope ? pick(r, PHOSPHORS) : legible(r, all.slice(1), all[0]),
        grid: r() < 0.6 ? 1 : 0,
        weight: range(r, 0.03, 0.055),
      }
    },
    vector: (ctx, px, p, t) => {
      ctx.fillStyle = css(p.ground)
      ctx.fillRect(0, 0, px, px)

      if (p.grid) {
        ctx.strokeStyle = css(p.ink, p.scope ? 0.14 : 0.18)
        ctx.lineWidth = Math.max(1, px / 64)
        Array.from({ length: 3 }, (_, k) => {
          const at = ((k + 1) * px) / 4
          ctx.beginPath()
          ctx.moveTo(at, 0)
          ctx.lineTo(at, px)
          ctx.moveTo(0, at)
          ctx.lineTo(px, at)
          ctx.stroke()
        })
      }

      ctx.beginPath()
      Array.from({ length: 241 }, (_, k) => {
        const s = (k / 240) * Math.PI * 2
        const x = px / 2 + Math.sin(p.a * s + p.delta + t * 0.8) * px * 0.36
        const y = px / 2 + Math.sin(p.b * s) * px * 0.36

        if (k === 0) return ctx.moveTo(x, y)
        ctx.lineTo(x, y)
      })
      ctx.lineJoin = "round"

      if (p.scope) {
        ctx.strokeStyle = css(p.ink, 0.25)
        ctx.lineWidth = px * p.weight * 2.6
        ctx.stroke()
      }

      ctx.strokeStyle = css(p.scope ? tint(p.ink, 0.35) : p.ink)
      ctx.lineWidth = px * p.weight
      ctx.stroke()
    },
  },
  {
    id: "spirograph",
    name: "Spirograph",
    family: "Tiling and curves",
    label: "One or two hypotrochoids traced in ink on paper; they turn on hover",
    animated: true,
    resolve: (random) => {
      const r = random("spirograph")
      const all = colors(palette(random("palette")))
      const [a, b] = shuffle(r, all.slice(1))

      const gear = () => {
        const [num, den] = pick(r, [
          [3, 7],
          [2, 5],
          [5, 8],
          [3, 8],
          [4, 9],
          [5, 12],
          [2, 7],
          [7, 10],
        ])

        return { r: num / den, den, d: range(r, 0.55, 1.05) }
      }

      const one = gear()
      const two = gear()

      return {
        paper: r() < 0.8 ? all[0] : 0x14161c,
        a,
        b,
        two: r() < 0.45 ? 1 : 0,
        r1: one.r,
        n1: one.den,
        d1: one.d,
        r2: two.r,
        n2: two.den,
        d2: two.d,
        weight: range(r, 0.018, 0.03),
      }
    },
    vector: (ctx, px, p, t) => {
      ctx.fillStyle = css(p.paper)
      ctx.fillRect(0, 0, px, px)
      ctx.lineJoin = "round"

      const curve = (radius: number, turns: number, d: number, ink: number, turn: number) => {
        const extent = 1 - radius + d * radius
        ctx.beginPath()
        Array.from({ length: turns * 90 + 1 }, (_, k) => {
          const s = (k / 90) * Math.PI * 2
          const x = (1 - radius) * Math.cos(s) + d * radius * Math.cos(((1 - radius) / radius) * s)
          const y = (1 - radius) * Math.sin(s) - d * radius * Math.sin(((1 - radius) / radius) * s)
          const rx = x * Math.cos(turn) - y * Math.sin(turn)
          const ry = x * Math.sin(turn) + y * Math.cos(turn)

          if (k === 0) return ctx.moveTo(px / 2 + (rx / extent) * px * 0.42, px / 2 + (ry / extent) * px * 0.42)
          ctx.lineTo(px / 2 + (rx / extent) * px * 0.42, px / 2 + (ry / extent) * px * 0.42)
        })
        ctx.strokeStyle = css(luma(p.paper) < 0.3 ? tint(ink, 0.3) : ink)
        ctx.lineWidth = px * p.weight
        ctx.stroke()
      }

      curve(p.r1, p.n1, p.d1, p.a, t * 0.4)

      if (p.two) curve(p.r2, p.n2, p.d2 * 0.7, p.b, -t * 0.3)
    },
  },
  {
    id: "flow",
    name: "Flow field",
    family: "Tiling and curves",
    label: "Short strokes following a noise field, in two to four inks on light or dark; they stream on hover",
    animated: true,
    resolve: (random) => {
      const r = random("flow")
      const all = colors(palette(random("palette")))
      const dark = r() < 0.35

      return {
        seed: seed(r),
        seedX: r() * 40,
        seedY: r() * 40,
        scale: range(r, 1.2, 2.6),
        curl: range(r, 1.5, 3.5),
        lines: int(r, 28, 48),
        weight: range(r, 0.03, 0.06),
        count: int(r, 2, 4),
        ground: dark ? shade(all[1], 0.45) : all[0],
        ...prefixed("f", shuffle(r, dark ? [all[0], ...all.slice(2)] : all.slice(1))),
      }
    },
    vector: (ctx, px, p, t) => {
      const inks = colors(p, "f", p.count)
      const rand = mulberry32(p.seed)
      ctx.fillStyle = css(p.ground)
      ctx.fillRect(0, 0, px, px)
      ctx.lineCap = "round"
      ctx.lineWidth = px * p.weight

      Array.from({ length: p.lines }, () => {
        let x = rand() * 1.2 - 0.1
        let y = rand() * 1.2 - 0.1
        ctx.strokeStyle = css(pick(rand, inks))
        ctx.beginPath()
        ctx.moveTo(x * px, y * px)

        for (let k = 0; k < 12; k++) {
          const angle = fbm(x * p.scale + p.seedX + t * 0.15, y * p.scale + p.seedY) * Math.PI * p.curl
          x += Math.cos(angle) * 0.03
          y += Math.sin(angle) * 0.03
          ctx.lineTo(x * px, y * px)
        }

        ctx.stroke()
      })
    },
  },
  {
    id: "turing",
    name: "Turing",
    family: "Tiling and curves",
    label: "Warped interference read as an animal coat: spots, labyrinth stripes or rosettes",
    resolve: (random) => {
      const r = random("turing")
      const all = colors(palette(random("palette")))
      const [ground, mark] = r() < 0.6 ? pick(r, COATS) : [all[0], legible(r, all.slice(1), all[0])]

      return {
        grid: 32,
        kind: int(r, 0, 2),
        frequency: range(r, 0.55, 0.9),
        a1: r() * Math.PI,
        a2: r() * Math.PI,
        a3: r() * Math.PI,
        p1: r() * 6.28,
        p2: r() * 6.28,
        p3: r() * 6.28,
        warp: range(r, 1.5, 4),
        seedX: r() * 40,
        seedY: r() * 40,
        ground,
        mark,
      }
    },
    paint: (pixels, p) => {
      pixels.each((x, y) => {
        const wx = x + (fbm(x * 0.08 + p.seedX, y * 0.08 + p.seedY) - 0.5) * p.warp * 2
        const wy = y + (fbm(x * 0.08 + p.seedY, y * 0.08 + p.seedX) - 0.5) * p.warp * 2
        const wave = (angle: number, phase: number) => Math.cos(p.frequency * (wx * Math.cos(angle) + wy * Math.sin(angle)) + phase)
        const v = (wave(p.a1, p.p1) + wave(p.a2, p.p2) + wave(p.a3, p.p3)) / 3

        if (p.kind === 0) return v > 0.25 ? p.mark : p.ground

        if (p.kind === 1) return Math.abs(v) < 0.16 ? p.mark : p.ground

        if (v > 0.5) return mix(p.ground, p.mark, 0.35)

        return v > 0.22 ? p.mark : p.ground
      })
    },
  },
  {
    id: "tree",
    name: "Branching tree",
    family: "Tiling and curves",
    label: "A recursive tree in spring blossom, summer, autumn, winter snow, night or ink; it sways on hover",
    animated: true,
    resolve: (random) => {
      const r = random("tree")

      return {
        seed: seed(r),
        ...prefixed("s", pick(r, SEASONS)),
        spread: range(r, 0.32, 0.62),
        ratio: range(r, 0.66, 0.78),
        depth: int(r, 5, 7),
        lean: range(r, -0.18, 0.18),
        skew: range(r, -0.15, 0.15),
        trunk: range(r, 0.22, 0.3),
      }
    },
    vector: (ctx, px, p, t) => {
      const [sky, ground, bark, leaf] = colors(p, "s", 4)
      const rand = mulberry32(p.seed)
      const sway = Math.sin(t * 2) * 0.06 * Math.min(1, t * 2)
      ctx.fillStyle = css(sky)
      ctx.fillRect(0, 0, px, px)
      ctx.fillStyle = css(ground)
      ctx.fillRect(0, px * 0.86, px, px)
      ctx.strokeStyle = css(bark)
      ctx.lineCap = "round"
      const tips: [number, number][] = []

      const branch = (x: number, y: number, angle: number, length: number, depth: number) => {
        const bend = angle + (sway + p.lean * 0.3) * (p.depth - depth + 1) * 0.4
        const nx = x + Math.cos(bend) * length
        const ny = y + Math.sin(bend) * length
        ctx.lineWidth = Math.max(px / 64, px * 0.012 * depth)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(nx, ny)
        ctx.stroke()

        if (depth <= 1) {
          tips.push([nx, ny])

          return
        }

        const jitter = () => (rand() - 0.5) * 0.25
        branch(nx, ny, bend - p.spread + p.skew + jitter(), length * (p.ratio + jitter() * 0.3), depth - 1)
        branch(nx, ny, bend + p.spread + p.skew + jitter(), length * (p.ratio + jitter() * 0.3), depth - 1)
      }

      branch(px / 2, px * 0.88, -Math.PI / 2 + p.lean, px * p.trunk, p.depth)
      const bare = leaf === 0xffffff
      ctx.fillStyle = css(leaf, bare ? 0.9 : 0.85)
      tips.forEach(([x, y]) => {
        ctx.beginPath()
        ctx.arc(x, y, px * (bare ? 0.015 : 0.045), 0, Math.PI * 2)
        ctx.fill()
      })
    },
  },
  {
    id: "hilbert",
    name: "Hilbert",
    family: "Tiling and curves",
    label: "A Hilbert curve of order two or three, in any of eight orientations, graded along its length; colour flows on hover",
    animated: true,
    resolve: (random) => {
      const r = random("hilbert")
      const all = colors(palette(random("palette")))
      const rainbow = r() < 0.35
      const hue = r()
      const inks = ramped(all.slice(1))

      const order = r() < 0.3 ? 2 : 3

      return {
        order,
        // A curve of order n has 2^n points a side, two cells apart.
        grid: 2 ** (order + 1),
        flip: int(r, 0, 7),
        ground: rainbow ? 0x15151c : all[0],
        ...prefixed(
          "h",
          rainbow ? [0, 1, 2, 3].map((i) => hsl(hue + i * 0.18, 0.75, 0.58)) : r() < 0.5 ? inks : inks.toReversed(),
        ),
      }
    },
    paint: (pixels, p, t) => {
      const ramp = colors(p, "h", 4)
      const side = 2 ** p.order
      const total = side * side
      const shift = t * 0.4

      const point = (d: number) => {
        let x = 0
        let y = 0
        let k = d

        for (let s = 1; s < side; s *= 2) {
          const rx = 1 & (k / 2)
          const ry = 1 & (k ^ rx)

          if (ry === 0) {
            if (rx === 1) {
              x = s - 1 - x
              y = s - 1 - y
            }

            ;[x, y] = [y, x]
          }

          x += s * rx
          y += s * ry
          k = Math.floor(k / 4)
        }

        const fx = p.flip & 1 ? side - 1 - x : x
        const fy = p.flip & 2 ? side - 1 - y : y

        return p.flip & 4 ? [fy, fx] : [fx, fy]
      }

      pixels.fill(p.ground)
      Array.from({ length: total }, (_, d) => {
        const [x0, y0] = point(d)
        const [x1, y1] = point(Math.min(total - 1, d + 1))
        const along = (((d / total + shift) % 1) + 1) % 1
        const level = along * 3
        const color = mix(ramp[Math.floor(level)], ramp[Math.min(3, Math.floor(level) + 1)], level % 1)
        pixels.line(x0 * 2, y0 * 2, x1 * 2, y1 * 2, color)
      })
    },
  },
]

export const MACHINE: Definition[] = [...RETRO, ...CURVES]
