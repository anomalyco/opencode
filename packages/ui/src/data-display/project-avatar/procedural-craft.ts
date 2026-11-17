// Project icon styles from craft: textiles, printmaking and twentieth-century art. See procedural.ts for the contract.

import { mulberry32 } from "./generated"
import {
  clamp01,
  colors,
  css,
  dither,
  fbm,
  grain,
  hsl,
  int,
  legible,
  luma,
  mix,
  multiply,
  palette,
  pick,
  prefixed,
  range,
  retry,
  seed,
  shade,
  shuffle,
  smoothstep,
  tint,
  type Definition,
} from "./procedural-kit"

// Red, navy, green, yellow, white and the like: five threads each, as real setts use.
const TARTANS = [
  [0xb81d2b, 0x1b2a4a, 0x1e5631, 0xf2c230, 0xf4f1ea],
  [0x1b2a4a, 0x1e4d2b, 0x101010, 0x2b3f6b, 0x3d6b3d],
  [0xf4f1ea, 0x1b2a4a, 0x1e5631, 0xf2c230, 0x101010],
  [0xf2c230, 0x1e5631, 0xb81d2b, 0x101010, 0xf4f1ea],
  [0xc9a77c, 0x161616, 0xf4f1ea, 0xa6192e, 0x8a6b4a],
  [0xe8a0b4, 0x6b2d5c, 0xf4f1ea, 0x2a9d8f, 0xffd166],
  [0x7a8c9e, 0x2f3e4f, 0xe6e2d6, 0xc44536, 0x51606f],
]

// Ink, then ground.
const HOUNDSTOOTH = [
  [0x161616, 0xf2efe6],
  [0x4a2f1f, 0xe9dcc3],
  [0x1b2a4a, 0xf4f1ea],
  [0x8f1d21, 0x161616],
  [0x2d3a2e, 0xd9cfb4],
]

const RISO = [0xff48b0, 0x0078bf, 0xffe800, 0x00a95c, 0xff6c2f, 0x765ba7, 0x00838a, 0xf15060, 0x5ec8e5, 0x3255a4]

const PAPERS = [0xf5f0e6, 0xfffcf2, 0xe8dcc2, 0xf3ece0]

const INDIGO = [0x1b2a55, 0x22315e, 0x141c33, 0x7a3f22, 0x2b2b2e]

const POP = [0xff2d6f, 0xffd60a, 0x00b4d8, 0x8338ec, 0x06d6a0, 0xff7b00, 0x111111, 0xf8f4ec, 0x3a86ff]

// Six-by-six motifs for the screenprint, top row in the high bits.
const MOTIFS = [
  [0b010010, 0b111111, 0b111111, 0b111111, 0b011110, 0b001100],
  [0b001100, 0b001100, 0b111111, 0b011110, 0b011110, 0b110011],
  [0b011110, 0b101101, 0b111111, 0b101101, 0b110011, 0b011110],
  [0b000110, 0b001100, 0b011110, 0b001100, 0b011000, 0b010000],
  [0b001100, 0b001100, 0b011110, 0b111111, 0b111111, 0b011110],
  [0b010010, 0b110011, 0b001100, 0b001100, 0b110011, 0b010010],
]

const DE_STIJL = [0xd7261e, 0x1d3f9a, 0xf6cf1a]

const MEMPHIS_GROUNDS = [0xffe3ec, 0xfff4c2, 0xd9f2ef, 0xe6e1ff, 0x1a1a1a]

const MEMPHIS_INKS = [0xff5fa2, 0xffcd3c, 0x2ec4b6, 0x3a5bff, 0x111111, 0xff7a3d]

const DECO_GROUNDS = [0x101418, 0x0e2a24, 0x1b1f3b, 0x2a0f1a, 0xf1e9d8]

const DECO_METALS = [0xd4af37, 0xc9c9c9, 0xe0a984, 0x7fd1b9]

const KANDINSKY = [0xe0a526, 0xc8323a, 0x24479a, 0x3a8a4f, 0x161616, 0xefe3c8, 0x6b3f8f, 0xe86a2b, 0xe58fb0]

// Ground, then up to three fields.
const ROTHKO = [
  [0x5a1a1a, 0xd9472b, 0x2b0e0e, 0xe8a33d],
  [0x1d2b3a, 0x2f5d62, 0x0d1a24, 0x5e8b7e],
  [0xd96b2b, 0xf2c14e, 0xb3311f, 0xf6e0a6],
  [0x2a1a2e, 0x6b2d5c, 0x111111, 0xa2456b],
  [0x8a8a83, 0x2a2a2a, 0xcfcac0, 0x4a4a4a],
  [0x6e1e2b, 0x1d1d3a, 0xcf3b2c, 0x2b1a14],
  [0x3d5a80, 0x98c1d9, 0x293241, 0xe0fbfc],
]

const TEXTILES: Definition[] = [
  {
    id: "tartan",
    name: "Tartan",
    family: "Textiles",
    label: "A mirrored sett of three to five stripes, woven in 2/2 twill; it slides on hover",
    animated: true,
    resolve: (random) => {
      const r = random("tartan")
      const threads = r() < 0.55 ? pick(r, TARTANS) : colors(palette(random("palette")))
      const count = int(r, 3, 5)

      const order = retry(
        () => Array.from({ length: count }, () => Math.floor(r() * 5)),
        (list) => list.every((color, i) => i === 0 || color !== list[i - 1]),
      )

      return {
        grid: r() < 0.6 ? 16 : 24,
        count,
        twill: r() < 0.5 ? 1 : -1,
        ...prefixed(
          "s",
          order.map((i) => threads[i]),
        ),
        ...prefixed(
          "w",
          order.map((_, i) => (i === 0 ? int(r, 3, 6) : r() < 0.35 ? 1 : int(r, 2, 4))),
        ),
      }
    },
    paint: (pixels, p, t) => {
      const stripes = colors(p, "s", p.count)
      const widths = colors(p, "w", p.count)
      const period = widths.reduce((sum, width) => sum + width, 0)
      const shift = Math.floor(t * 4)

      const thread = (i: number) => {
        const k = (((i + shift) % (period * 2)) + period * 2) % (period * 2)
        const along = k < period ? k : period * 2 - 1 - k
        const index = widths.findIndex((_, j) => widths.slice(0, j + 1).reduce((sum, w) => sum + w, 0) > along)

        return stripes[index]
      }

      pixels.each((x, y) => (((x + p.twill * y) & 3) < 2 ? shade(thread(x), 0.9) : thread(y)))
    },
  },
  {
    id: "houndstooth",
    name: "Houndstooth",
    family: "Textiles",
    label: "Four-and-four threads in a 2/2 twill, one and a half to three teeth across, sometimes overchecked",
    animated: true,
    resolve: (random) => {
      const r = random("houndstooth")
      const all = colors(palette(random("palette")))
      const ink = legible(r, all.slice(1), all[0])
      const [color, ground] = r() < 0.5 ? pick(r, HOUNDSTOOTH) : r() < 0.6 ? [ink, all[0]] : [all[0], ink]

      const [grid, unit] = pick(r, [
        [16, 1],
        [24, 1],
        [16, 1],
        [12, 1],
      ])

      return {
        grid,
        unit,
        ink: color,
        ground,
        over: r() < 0.35 ? 1 : 0,
        overColor: pick(r, all.slice(1).filter((c) => c !== color && c !== ground)),
        dir: r() < 0.5 ? 1 : -1,
        ox: int(r, 0, 7),
        oy: int(r, 0, 7),
      }
    },
    paint: (pixels, p, t) => {
      const shift = Math.floor(t * 3)

      pixels.each((x, y) => {
        const i = Math.floor(x / p.unit) + p.ox + shift
        const j = Math.floor(y / p.unit) + p.oy
        const warp = (i & 7) < 4 ? p.ink : p.ground
        const weft = (j & 7) < 4 ? p.ink : p.ground
        const color = ((i + p.dir * j) & 3) < 2 ? warp : weft

        return p.over && ((i & 15) === 9 || (j & 15) === 9) ? mix(color, p.overColor, 0.7) : color
      })
    },
  },
  {
    id: "gingham",
    name: "Gingham",
    family: "Textiles",
    label: "Even checks with a half-tone where bands cross, or a buffalo check or windowpane",
    resolve: (random) => {
      const r = random("gingham")
      const all = colors(palette(random("palette")))

      return {
        grid: 16,
        size: int(r, 2, 4),
        kind: pick(r, [0, 0, 0, 1, 2]),
        ink: legible(r, all.slice(1), all[0]),
        paper: r() < 0.7 ? all[0] : 0xffffff,
        ox: int(r, 0, 3),
        oy: int(r, 0, 3),
      }
    },
    paint: (pixels, p) => {
      pixels.each((x, y) => {
        const a = Math.floor((x + p.ox) / p.size) % 2 === 0
        const b = Math.floor((y + p.oy) / p.size) % 2 === 0
        const texture = (x + y) % 2 ? 0.93 : 1

        if (p.kind === 1) {
          if (a && b) return shade(mix(0x111111, p.ink, 0.25), 1)

          return a || b ? shade(p.ink, 0.62 * texture) : p.ink
        }

        if (p.kind === 2) {
          const period = p.size * 2 + 2
          const line = (x + p.ox) % period === 0 || (y + p.oy) % period === 0
          const thin = (x + p.ox) % period === p.size + 1 || (y + p.oy) % period === p.size + 1

          return line ? p.ink : thin ? mix(p.paper, p.ink, 0.3) : p.paper
        }

        if (a && b) return p.ink

        return a || b ? shade(mix(p.paper, p.ink, 0.5), texture) : p.paper
      })
    },
  },
  {
    id: "argyle",
    name: "Argyle",
    family: "Textiles",
    label: "Harlequin diamonds with a dashed or solid overcheck through their centres",
    resolve: (random) => {
      const r = random("argyle")
      const all = shuffle(r, colors(palette(random("palette"))))
      const [a, b] = all

      return {
        grid: 16,
        across: pick(r, [1, 2, 2]),
        tall: pick(r, [1, 1.3, 1.6]),
        oy: range(r, 0, 4),
        dashed: r() < 0.6 ? 1 : 0,
        a,
        b,
        line: legible(r, all.slice(2), mix(a, b, 0.5)),
      }
    },
    paint: (pixels, p) => {
      const w = 16 / p.across
      const h = w * p.tall
      const scale = 1 / Math.hypot(1 / w, 1 / h)

      pixels.each((x, y) => {
        const u = (x + 0.5) / w + (y + 0.5 - p.oy) / h + 0.5
        const v = (x + 0.5) / w - (y + 0.5 - p.oy) / h + 0.5
        const base = (Math.floor(u) + Math.floor(v)) & 1 ? p.b : p.a
        const du = Math.abs((((u % 1) + 1) % 1) - 0.5) * scale
        const dv = Math.abs((((v % 1) + 1) % 1) - 0.5) * scale
        const dash = !p.dashed || (x + y) % 3 !== 2

        return (du < 0.55 || dv < 0.55) && dash ? p.line : base
      })
    },
  },
  {
    id: "zigzag",
    name: "Zigzag",
    family: "Textiles",
    label: "Chevron stripes, or bargello flame-stitch peaks in graded shades; they climb on hover",
    animated: true,
    resolve: (random) => {
      const r = random("zigzag")
      const all = colors(palette(random("palette")))
      const flame = r() < 0.4 ? 1 : 0
      const [from, to] = shuffle(r, all.slice(1))
      const count = int(r, 3, 4)

      return {
        grid: 16,
        flame,
        seed: seed(r),
        period: pick(r, [4, 8, 8, 16]),
        width: int(r, 2, 3),
        vertical: r() < 0.25 ? 1 : 0,
        count: flame ? 5 : count,
        ...prefixed(
          "z",
          flame
            ? [shade(from, 0.6), from, mix(from, to, 0.5), to, tint(to, 0.5)]
            : [all[0], ...shuffle(r, all.slice(1))].slice(0, count),
        ),
      }
    },
    paint: (pixels, p, t) => {
      const cycle = colors(p, "z", p.count)
      const rand = mulberry32(p.seed)
      const walk = Array.from({ length: 16 }).reduce<number[]>(
        (list) => [...list, (list[list.length - 1] ?? 0) + pick(rand, [-2, -1, 1, 1, 2, 2])],
        [],
      )
      const shift = t * 4

      pixels.each((cx, cy) => {
        const x = p.vertical ? cy : cx
        const y = p.vertical ? cx : cy
        const k = (x % p.period) / p.period
        const offset = p.flame ? walk[x] : Math.abs(k - 0.5) * p.period
        const band = Math.floor((y + offset + shift) / p.width)

        return cycle[((band % p.count) + p.count) % p.count]
      })
    },
  },
  {
    id: "seigaiha",
    name: "Seigaiha",
    family: "Textiles",
    label: "Overlapping wave scales of three or four rings, one and a half to two across; the rings ripple on hover",
    animated: true,
    resolve: (random) => {
      const r = random("seigaiha")
      const all = colors(palette(random("palette")))
      const classic = r() < 0.35
      const [a, b, c] = shuffle(r, all.slice(1))

      return {
        across: pick(r, [1.5, 2, 2]),
        rings: int(r, 3, 4),
        lines: r() < 0.4 ? 1 : 0,
        accent: r() < 0.4 ? 1 : 0,
        ground: classic ? 0x1d3557 : a,
        ink: classic ? 0xf4efe6 : legible(r, [b, c, all[0]], a),
        third: c,
      }
    },
    vector: (ctx, px, p, t) => {
      const radius = px / p.across / 2
      const step = radius * 0.5
      const phase = (t * 0.8) % 1

      for (let j = -1; j * step < px + radius; j++)
        for (let i = -1; i * radius * 2 < px + radius * 2; i++) {
          const cx = i * radius * 2 + (j % 2 ? radius : 0)
          const cy = j * step

          for (let k = 0; k < p.rings; k++) {
            const ring = Math.max(0, radius * (1 - (k - (k ? phase : 0)) / p.rings))
            ctx.beginPath()
            ctx.arc(cx, cy, ring, 0, Math.PI * 2)

            if (p.lines) {
              ctx.fillStyle = css(p.ground)
              ctx.fill()
              ctx.strokeStyle = css(p.accent && k === p.rings - 1 ? p.third : p.ink)
              ctx.lineWidth = radius * 0.1
              ctx.stroke()
              continue
            }

            ctx.fillStyle = css(k % 2 ? p.ink : p.accent && k === 2 ? p.third : p.ground)
            ctx.fill()
          }
        }
    },
  },
  {
    id: "tie-dye",
    name: "Tie-dye",
    family: "Textiles",
    label: "A dye spiral, bullseye or crumple with bleeding bands and white crinkles",
    resolve: (random) => {
      const r = random("tie-dye")
      const rainbow = r() < 0.55
      const count = int(r, 4, 6)
      const hue = r()
      const inks = shuffle(r, colors(palette(random("palette"))).slice(1))

      return {
        grid: 32,
        kind: pick(r, [0, 0, 1, 2]),
        arms: int(r, 2, 5),
        twist: range(r, 2, 6) * (r() < 0.5 ? -1 : 1),
        cx: range(r, 10, 22),
        cy: range(r, 10, 22),
        seedX: r() * 40,
        seedY: r() * 40,
        count: rainbow ? count : 4,
        ...prefixed(
          "d",
          rainbow ? Array.from({ length: count }, (_, i) => hsl(hue + i / count, 0.85, 0.55)) : inks,
        ),
      }
    },
    paint: (pixels, p) => {
      const dyes = colors(p, "d", p.count)

      pixels.each((x, y) => {
        const dx = x + 0.5 - p.cx
        const dy = y + 0.5 - p.cy
        const d = Math.hypot(dx, dy) / 32
        const wobble = fbm(x * 0.15 + p.seedX, y * 0.15 + p.seedY)
        const angle = Math.atan2(dy, dx) / (Math.PI * 2)

        const value =
          p.kind === 0
            ? angle * p.arms + p.twist * Math.sqrt(d) + wobble * 0.5
            : p.kind === 1
              ? d * 7 + wobble * 1.2 + Math.sin(angle * Math.PI * 2 * p.arms) * 0.15
              : fbm(x * 0.09 + p.seedY, y * 0.09 + p.seedX) * p.count * 1.6

        const band = Math.floor(value * (p.kind === 0 ? 1 : 1))
        const along = value - band
        const a = dyes[((band % p.count) + p.count) % p.count]
        const b = dyes[(((band + 1) % p.count) + p.count) % p.count]
        const color = mix(a, b, smoothstep(0.7, 1, along))
        const crinkle = fbm(x * 0.6 + p.seedX * 2, y * 0.6 + p.seedY)

        return crinkle > 0.74 ? mix(color, 0xffffff, 0.55) : color
      })
    },
  },
  {
    id: "shibori",
    name: "Shibori",
    family: "Textiles",
    label: "Resist-dyed indigo: clamped squares, circles or diamonds, pole-wrapped stripes or spider webs",
    resolve: (random) => {
      const r = random("shibori")

      return {
        grid: 32,
        kind: pick(r, [0, 0, 1, 2]),
        dye: pick(r, INDIGO),
        cloth: pick(r, [0xeef0ee, 0xf2ead8, 0xe3e8ee]),
        cells: pick(r, [2, 3, 4]),
        shape: int(r, 0, 2),
        angle: range(r, 0.3, 1.2) * (r() < 0.5 ? 1 : -1),
        spacing: range(r, 3.5, 6),
        centers: int(r, 1, 3),
        seed: seed(r),
        seedX: r() * 40,
        seedY: r() * 40,
      }
    },
    paint: (pixels, p) => {
      const rand = mulberry32(p.seed)
      const webs = Array.from({ length: p.centers }, () => ({
        x: range(rand, 6, 26),
        y: range(rand, 6, 26),
        r: range(rand, 7, 12),
      }))
      const size = 32 / p.cells

      pixels.each((x, y) => {
        const n = fbm(x * 0.2 + p.seedX, y * 0.2 + p.seedY)
        const kinds = [
          () => {
            const u = ((x + 0.5) % size) / size - 0.5
            const v = ((y + 0.5) % size) / size - 0.5
            const d = [Math.max(Math.abs(u), Math.abs(v)), Math.hypot(u, v), Math.abs(u) + Math.abs(v)][p.shape]

            return smoothstep(0.32, 0.22, d + (n - 0.5) * 0.18)
          },
          () => {
            const v = (x * Math.cos(p.angle) + y * Math.sin(p.angle)) / p.spacing + n * 1.4

            return smoothstep(0.8, 0.97, Math.abs(Math.sin(v * Math.PI))) * smoothstep(0.25, 0.5, n)
          },
          () =>
            Math.max(
              ...webs.map((web) => {
                const d = Math.hypot(x + 0.5 - web.x, y + 0.5 - web.y)
                const spoke = Math.abs(Math.sin(Math.atan2(y + 0.5 - web.y, x + 0.5 - web.x) * 6 + d * 0.15))

                return d < web.r ? smoothstep(0.75, 0.98, spoke) * (1 - d / web.r) + (d < 1.6 ? 1 : 0) : 0
              }),
            ),
          () => {
            const row = Math.round(y / p.spacing) * p.spacing
            const stitch = Math.abs(y - row) < 0.8 && Math.floor(x / 2 + row) % 2 === 0

            return stitch ? 0.85 : 0
          },
        ]

        const resist = clamp01(kinds[p.kind]())
        const dyed = shade(p.dye, 0.85 + n * 0.3)

        return [dyed, mix(dyed, p.cloth, 0.5), p.cloth][dither(resist, 3, x, y)]
      })
    },
  },
]

const PRINT: Definition[] = [
  {
    id: "risograph",
    name: "Risograph",
    family: "Print",
    label: "Two fluorescent inks, each a disc, stripes, half or ring, overprinted out of register with grain",
    resolve: (random) => {
      const r = random("riso")
      const [a, b] = shuffle(r, RISO)

      const layer = (prefix: string) =>
        prefixed(prefix, [int(r, 0, 3), range(r, 0.3, 0.7), range(r, 0.3, 0.7), range(r, 0.3, 0.45), r() * Math.PI])

      return {
        grid: 32,
        paper: pick(r, PAPERS),
        a,
        b,
        ...layer("a"),
        ...layer("b"),
        mx: range(r, 0.8, 1.8) * (r() < 0.5 ? 1 : -1),
        my: range(r, 0.8, 1.8) * (r() < 0.5 ? 1 : -1),
        salt: r() * 100,
      }
    },
    paint: (pixels, p) => {
      const layer = (prefix: string, ox: number, oy: number) => {
        const [kind, cx, cy, size, angle] = colors(p, prefix, 5)
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const bands = 4 + size * 8

        return (x: number, y: number) => {
          const u = (x + ox) / 32 - cx
          const v = (y + oy) / 32 - cy
          const along = u * cos + v * sin

          if (kind === 1) return Math.floor((along + 2) * bands) % 2
          if (kind === 2) return along > 0 ? 1 : 0
          const d = Math.hypot(u, v)

          return (kind === 0 ? d < size : Math.abs(d - size) < size * 0.4) ? 1 : 0
        }
      }

      const a = layer("a", 0.5, 0.5)
      const b = layer("b", 0.5 + p.mx, 0.5 + p.my)

      // Uneven coverage and speckle are properties of the paper, so both inks share them.
      pixels.each((x, y) => {
        const texture = (0.78 + 0.22 * fbm(x * 0.3 + 7, y * 0.3)) * (grain(x, y, p.salt) < 0.1 ? 0.3 : 1)

        return multiply(multiply(p.paper, mix(0xffffff, p.a, a(x, y) * texture)), mix(0xffffff, p.b, b(x, y) * texture))
      })
    },
  },
  {
    id: "halftone",
    name: "Halftone",
    family: "Print",
    label: "A rotated dot screen of a gradient, sphere or wave, sometimes two screens overprinted",
    resolve: (random) => {
      const r = random("halftone")
      const all = colors(palette(random("palette")))
      const ink = legible(r, all.slice(1), all[0])
      const field = int(r, 0, 3)

      return {
        cells: int(r, 6, 9),
        angle: (pick(r, [15, 45, 75, 0]) * Math.PI) / 180,
        field,
        dir: r() * Math.PI * 2,
        cx: range(r, 0.3, 0.7),
        cy: range(r, 0.3, 0.7),
        paper: all[0],
        ink,
        second: r() < 0.4 ? 1 : 0,
        ink2: pick(
          r,
          all.slice(1).filter((color) => color !== ink),
        ),
      }
    },
    vector: (ctx, px, p) => {
      ctx.fillStyle = css(p.paper)
      ctx.fillRect(0, 0, px, px)

      const tone = (u: number, v: number, screen: number) => {
        const dx = u - p.cx
        const dy = v - p.cy
        const along = dx * Math.cos(p.dir + screen * 2) + dy * Math.sin(p.dir + screen * 2)

        const fields = [
          () => along + 0.5,
          () => 1 - Math.hypot(dx, dy) * 1.6,
          () => {
            const d = Math.hypot(dx, dy) / 0.34

            return d > 1 ? 0.06 : 1 - (Math.sqrt(1 - Math.min(1, d * d)) * 0.6 + 0.25 - (dx + dy) * 0.7)
          },
          () => 0.5 + 0.5 * Math.sin(along * 14),
        ]

        return clamp01(fields[p.field]())
      }

      const screens = p.second ? [0, 1] : [0]
      ctx.globalCompositeOperation = "multiply"
      screens.forEach((screen) => {
        const cell = px / p.cells
        const angle = p.angle + screen * (Math.PI / 6)
        ctx.fillStyle = css(screen ? p.ink2 : p.ink)

        for (let i = -p.cells; i < p.cells * 2; i++)
          for (let j = -p.cells; j < p.cells * 2; j++) {
            const lx = (i + 0.5) * cell
            const ly = (j + 0.5) * cell
            const x = px / 2 + (lx - px / 2) * Math.cos(angle) - (ly - px / 2) * Math.sin(angle)
            const y = px / 2 + (lx - px / 2) * Math.sin(angle) + (ly - px / 2) * Math.cos(angle)

            if (x < -cell || y < -cell || x > px + cell || y > px + cell) continue
            const radius = Math.sqrt(tone(x / px, y / px, screen)) * cell * 0.62

            if (radius < cell * 0.06) continue
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
          }
      })
      ctx.globalCompositeOperation = "source-over"
    },
  },
  {
    id: "linocut",
    name: "Linocut",
    family: "Print",
    label: "A sun, peak, moon or hill left standing in paper, with gouged lines that shorten away from it",
    resolve: (random) => {
      const r = random("linocut")

      return {
        grid: 24,
        motif: int(r, 0, 3),
        mx: range(r, 8, 16),
        my: range(r, 7, 12),
        size: range(r, 4.5, 6.5),
        spacing: pick(r, [3, 3, 4]),
        horizon: int(r, 16, 19),
        ink: pick(r, [0x161616, 0x1d2b4f, 0x5a1a1a, 0x1f3b2c, 0x3a2a4f]),
        paper: pick(r, [0xf2ead8, 0xf6f1e7, 0xe9d8b4, 0xf0d9c8]),
        seedX: r() * 40,
        seedY: r() * 40,
      }
    },
    paint: (pixels, p) => {
      pixels.each((x, y) => {
        const X = x + 0.5
        const Y = y + 0.5
        const dx = X - p.mx
        const dy = Y - p.my
        const d = Math.hypot(dx, dy)

        const motifs = [
          () => d < p.size,
          () => Y > p.my - p.size && Y < p.horizon && Math.abs(dx) < (Y - (p.my - p.size)) * 0.85,
          () => d < p.size && Math.hypot(dx - p.size * 0.5, dy - p.size * 0.2) > p.size * 0.8,
          () => Y > p.my + 2 + Math.sin(X * 0.3 + p.seedX) * 2.5 && Y < p.horizon,
        ]

        if (motifs[p.motif]()) {
          const gouge = p.motif === 1 ? Y > p.my - p.size * 0.2 && (x + y) % 4 === 0 : p.motif === 3 && (x - y * 2) % 6 === 0

          return gouge ? p.ink : p.paper
        }

        const wobble = fbm(X * 0.3 + p.seedX, Y * 0.3 + p.seedY)

        if (Y >= p.horizon) return (y - p.horizon) % 2 === 1 && wobble > 0.35 ? p.paper : p.ink
        const near = 1 - clamp01((d - p.size) / 11)

        return y % p.spacing === 1 && wobble < near * 0.95 ? p.paper : p.ink
      })
    },
  },
  {
    id: "screenprint",
    name: "Screenprint",
    family: "Print",
    label: "A pop motif repeated in clashing colourways with a misregistered shadow, or one big",
    resolve: (random) => {
      const r = random("screenprint")
      const ways = shuffle(r, POP)

      return {
        grid: 16,
        motif: int(r, 0, MOTIFS.length - 1),
        single: r() < 0.5 ? 1 : 0,
        dx: pick(r, [1, -1]),
        dy: pick(r, [1, 0, -1]),
        ...prefixed("g", ways.slice(0, 4)),
        ...prefixed("i", ways.slice(4, 8)),
        ...prefixed("s", ways.slice(1, 5)),
      }
    },
    paint: (pixels, p) => {
      const grounds = colors(p, "g", 4)
      const inks = colors(p, "i", 4)
      const shadows = colors(p, "s", 4)
      const motif = MOTIFS[p.motif]
      const at = (x: number, y: number) => x >= 0 && y >= 0 && x < 6 && y < 6 && ((motif[y] >> (5 - x)) & 1) === 1

      pixels.each((x, y) => {
        if (p.single) {
          const lx = Math.floor((x - 2) / 2)
          const ly = Math.floor((y - 2) / 2)

          if (at(lx, ly)) return inks[0]

          return at(Math.floor((x - 2 - p.dx) / 2), Math.floor((y - 2 - p.dy) / 2)) ? shadows[1] : grounds[0]
        }

        const panel = Math.floor(y / 8) * 2 + Math.floor(x / 8)
        const lx = (x % 8) - 1
        const ly = (y % 8) - 1
        const ink = inks[panel] === grounds[panel] ? shadows[panel] : inks[panel]

        if (at(lx, ly)) return ink

        return at(lx - p.dx, ly - p.dy) ? shadows[(panel + 1) % 4] : grounds[panel]
      })
    },
  },
]

const ART: Definition[] = [
  {
    id: "de-stijl",
    name: "De Stijl",
    family: "Art movements",
    label: "Recursive black-lined rectangles with primary fills, sometimes turned 45° like van Doesburg",
    resolve: (random) => {
      const r = random("de-stijl")

      return {
        seed: seed(r),
        depth: int(r, 2, 4),
        weight: range(r, 0.05, 0.085),
        turn: r() < 0.22 ? 1 : 0,
        line: r() < 0.85 ? 0x111111 : 0x5a5a5a,
        white: pick(r, [0xf2efe8, 0xf7f4ee, 0xebe6dc]),
        grey: r() < 0.3 ? 1 : 0,
      }
    },
    vector: (ctx, px, p) => {
      const rand = mulberry32(p.seed)
      const gap = px * p.weight
      const leaves: { x: number; y: number; w: number; h: number }[] = []

      const split = (x: number, y: number, w: number, h: number, depth: number) => {
        if (depth === 0 || (depth < p.depth && rand() < 0.3) || Math.min(w, h) < px * 0.18) {
          leaves.push({ x, y, w, h })

          return
        }

        const k = 0.28 + rand() * 0.44

        if (w > h ? rand() < 0.75 : rand() < 0.25) {
          split(x, y, w * k, h, depth - 1)
          split(x + w * k, y, w * (1 - k), h, depth - 1)

          return
        }

        split(x, y, w, h * k, depth - 1)
        split(x, y + h * k, w, h * (1 - k), depth - 1)
      }

      const extent = p.turn ? px * 1.5 : px
      split(-gap / 2, -gap / 2, extent + gap, extent + gap, p.depth)
      const fills = shuffle(rand, leaves.map((_, i) => i)).slice(0, Math.max(1, Math.round(leaves.length * 0.4)))

      ctx.save()

      if (p.turn) {
        ctx.translate(px / 2, px / 2)
        ctx.rotate(Math.PI / 4)
        ctx.translate(-extent / 2, -extent / 2)
      }

      ctx.fillStyle = css(p.line)
      ctx.fillRect(-px, -px, extent + px * 2, extent + px * 2)
      leaves.forEach((leaf, i) => {
        const slot = fills.indexOf(i)
        const accent = slot < 0 ? p.white : slot < 3 ? DE_STIJL[(slot + p.seed) % 3] : p.grey ? 0xbdbab3 : p.white
        ctx.fillStyle = css(accent)
        ctx.fillRect(leaf.x + gap / 2, leaf.y + gap / 2, Math.max(0, leaf.w - gap), Math.max(0, leaf.h - gap))
      })
      ctx.restore()
    },
  },
  {
    id: "memphis",
    name: "Memphis",
    family: "Art movements",
    label: "Squiggles, triangles, dot grids and zigzags scattered over a pastel ground",
    resolve: (random) => {
      const r = random("memphis")

      return { seed: seed(r), ground: pick(r, MEMPHIS_GROUNDS), count: int(r, 3, 4) }
    },
    vector: (ctx, px, p) => {
      const rand = mulberry32(p.seed)
      const dark = luma(p.ground) < 0.3
      const inks = MEMPHIS_INKS.filter((ink) => !dark || ink !== 0x111111)
      ctx.fillStyle = css(p.ground)
      ctx.fillRect(0, 0, px, px)
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.lineWidth = px * 0.075
      const spots = shuffle(rand, [
        [0.28, 0.28],
        [0.72, 0.3],
        [0.3, 0.72],
        [0.72, 0.72],
      ])
      const kinds = shuffle(rand, [0, 1, 2, 3, 4, 5])

      spots.slice(0, p.count).forEach(([u, v], i) => {
        const x = u * px + (rand() - 0.5) * px * 0.1
        const y = v * px + (rand() - 0.5) * px * 0.1
        const s = px * (0.16 + rand() * 0.08)
        const ink = css(pick(rand, inks))
        ctx.fillStyle = ink
        ctx.strokeStyle = ink
        ctx.beginPath()

        const shapes = [
          () => {
            ctx.moveTo(x - s * 1.2, y)
            Array.from({ length: 13 }, (_, k) =>
              ctx.lineTo(x - s * 1.2 + (k * s * 2.4) / 12, y + Math.sin(k * 1.1) * s * 0.4),
            )
            ctx.stroke()
          },
          () => {
            const turn = rand() * Math.PI * 2
            Array.from({ length: 3 }, (_, k) =>
              ctx.lineTo(x + Math.cos(turn + (k * Math.PI * 2) / 3) * s, y + Math.sin(turn + (k * Math.PI * 2) / 3) * s),
            )
            ctx.fill()
          },
          () => {
            Array.from({ length: 9 }, (_, k) => {
              ctx.moveTo(x + ((k % 3) - 1) * s * 0.7 + s * 0.12, y + (Math.floor(k / 3) - 1) * s * 0.7)
              ctx.arc(x + ((k % 3) - 1) * s * 0.7, y + (Math.floor(k / 3) - 1) * s * 0.7, s * 0.12, 0, Math.PI * 2)
            })
            ctx.fill()
          },
          () => {
            ctx.moveTo(x - s * 1.1, y + s * 0.3)
            Array.from({ length: 5 }, (_, k) => ctx.lineTo(x - s * 1.1 + ((k + 1) * s * 2.2) / 5, y + (k % 2 ? 0.3 : -0.3) * s))
            ctx.stroke()
          },
          () => {
            ctx.arc(x, y, s * 0.8, 0, Math.PI * 2)
            ctx.stroke()
          },
          () => {
            ctx.arc(x, y + s * 0.3, s * 0.9, Math.PI, Math.PI * 2)
            ctx.fill()
          },
        ]

        shapes[kinds[i]]()
      })
    },
  },
  {
    id: "deco",
    name: "Art Deco",
    family: "Art movements",
    label: "Metallic sunburst fans, a trio of fans, a ziggurat or a corner fan on a dark lacquer",
    resolve: (random) => {
      const r = random("deco")

      return {
        layout: int(r, 0, 3),
        ground: pick(r, DECO_GROUNDS),
        metal: pick(r, DECO_METALS),
        rays: int(r, 7, 13),
        arcs: int(r, 2, 3),
      }
    },
    vector: (ctx, px, p) => {
      const ground = p.ground === 0xf1e9d8 ? shade(p.metal, 0.45) : p.metal
      ctx.fillStyle = css(p.ground)
      ctx.fillRect(0, 0, px, px)
      ctx.strokeStyle = css(ground)
      ctx.fillStyle = css(ground)
      ctx.lineWidth = px * 0.035

      const fan = (cx: number, cy: number, radius: number, from: number, to: number, filled: boolean) => {
        Array.from({ length: p.rays }, (_, k) => {
          const angle = from + ((to - from) * (k + 0.5)) / p.rays
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(angle) * radius * 0.3, cy + Math.sin(angle) * radius * 0.3)
          ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
          ctx.stroke()
        })
        Array.from({ length: p.arcs }, (_, k) => {
          ctx.beginPath()
          ctx.arc(cx, cy, radius * (1 - k * 0.22), from, to)
          ctx.stroke()
        })
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, radius * 0.3, from, to)
        ctx.closePath()

        if (filled) ctx.fill()

        if (!filled) ctx.stroke()
      }

      const layouts = [
        () => fan(px / 2, px * 0.92, px * 0.78, Math.PI, Math.PI * 2, true),
        () => {
          fan(px * 0.2, px * 0.95, px * 0.38, Math.PI, Math.PI * 2, false)
          fan(px * 0.8, px * 0.95, px * 0.38, Math.PI, Math.PI * 2, false)
          fan(px / 2, px * 0.95, px * 0.56, Math.PI, Math.PI * 2, true)
        },
        () => {
          const steps = 4
          Array.from({ length: steps }, (_, k) => {
            const w = px * (0.7 - k * 0.15)
            ctx.fillRect((px - w) / 2, px * (0.95 - (k + 1) * 0.1), w, px * 0.1 + 1)
          })
          fan(px / 2, px * 0.55, px * 0.5, Math.PI * 1.08, Math.PI * 1.92, false)
        },
        () => {
          Array.from({ length: p.rays }, (_, k) => {
            if (k % 2) return
            const a = -Math.PI / 2 + ((Math.PI / 2) * k) / p.rays
            const b = -Math.PI / 2 + ((Math.PI / 2) * (k + 1)) / p.rays
            ctx.beginPath()
            ctx.moveTo(0, px)
            ctx.arc(0, px, px * 1.1, a, b)
            ctx.closePath()
            ctx.fill()
          })
          ctx.beginPath()
          ctx.arc(0, px, px * 0.45, -Math.PI / 2, 0)
          ctx.lineTo(0, px)
          ctx.fillStyle = css(p.ground)
          ctx.fill()
          ctx.stroke()
        },
      ]

      layouts[p.layout]()
    },
  },
  {
    id: "kandinsky",
    name: "Kandinsky",
    family: "Art movements",
    label: "Four squares of two to four loose concentric circles in clashing colours",
    resolve: (random) => {
      const r = random("kandinsky")

      return { seed: seed(r), tiles: 2, rings: int(r, 2, 4) }
    },
    vector: (ctx, px, p) => {
      const rand = mulberry32(p.seed)
      const size = px / p.tiles

      for (let i = 0; i < p.tiles; i++)
        for (let j = 0; j < p.tiles; j++) {
          const order = shuffle(rand, KANDINSKY)
          const cx = (i + 0.5) * size
          const cy = (j + 0.5) * size
          ctx.fillStyle = css(order[0])
          ctx.fillRect(i * size - 0.5, j * size - 0.5, size + 1, size + 1)

          for (let k = 0; k < p.rings; k++) {
            const radius = size * 0.44 * (1 - k / (p.rings + 0.4)) * (0.9 + rand() * 0.15)
            ctx.beginPath()
            ctx.arc(cx + (rand() - 0.5) * size * 0.06, cy + (rand() - 0.5) * size * 0.06, radius, 0, Math.PI * 2)
            ctx.fillStyle = css(order[k + 1])
            ctx.fill()
          }
        }
    },
  },
  {
    id: "albers",
    name: "Albers",
    family: "Art movements",
    label: "Homage to the Square: three or four nested squares sinking toward the bottom edge",
    resolve: (random) => {
      const r = random("albers")
      const hue = r()
      const count = int(r, 3, 4)
      const drift = range(r, -0.08, 0.08)
      const rising = r() < 0.6
      const s = range(r, 0.35, 0.8)

      return {
        count,
        ...prefixed(
          "a",
          Array.from({ length: count }, (_, k) => {
            const l = rising ? 0.28 + k * 0.17 : 0.82 - k * 0.15

            return hsl(hue + drift * k, s, l)
          }),
        ),
      }
    },
    vector: (ctx, px, p) => {
      const squares = colors(p, "a", p.count)
      const step = 1 / (p.count + 1)

      squares.forEach((color, k) => {
        const size = px * (1 - k * step)
        const bottom = px * k * step * 0.25
        ctx.fillStyle = css(color)
        ctx.fillRect((px - size) / 2, px - bottom - size, size, size)
      })
    },
  },
  {
    id: "rothko",
    name: "Rothko",
    family: "Art movements",
    label: "Two or three soft-edged colour fields floating on a stained ground",
    resolve: (random) => {
      const r = random("rothko")
      const set = r() < 0.75 ? pick(r, ROTHKO) : [shade(hsl(r(), 0.5, 0.3), 1), hsl(r(), 0.6, 0.5), hsl(r(), 0.5, 0.25), hsl(r(), 0.7, 0.6)]
      const count = r() < 0.6 ? 2 : 3

      return {
        grid: 32,
        count,
        split: range(r, 0.38, 0.62),
        margin: range(r, 3, 4.5),
        ...prefixed("f", set),
        seedX: r() * 40,
        seedY: r() * 40,
      }
    },
    paint: (pixels, p) => {
      const [ground, ...fields] = colors(p, "f", 4)
      const gap = 2.2
      const top = p.margin
      const bottom = 32 - p.margin
      const inner = bottom - top - gap * (p.count - 1)
      const heights = p.count === 2 ? [inner * p.split, inner * (1 - p.split)] : [inner * 0.3, inner * 0.22, inner * 0.48]

      const bands = heights.map((height, i) => {
        const y0 = top + heights.slice(0, i).reduce((sum, h) => sum + h, 0) + gap * i

        return { y0, y1: y0 + height, color: fields[i] }
      })

      pixels.each((x, y) => {
        const n = fbm(x * 0.25 + p.seedX, y * 0.25 + p.seedY)
        const X = x + 0.5 + (n - 0.5) * 1.6
        const Y = y + 0.5 + (n - 0.5) * 1.6
        const stained = shade(ground, 0.88 + n * 0.22)

        return bands.reduce((color, band) => {
          const edge = Math.min(X - p.margin + 0.6, 32 - p.margin + 0.6 - X, Y - band.y0, band.y1 - Y)

          return mix(color, shade(band.color, 0.9 + n * 0.18), smoothstep(-0.8, 1.4, edge))
        }, stained)
      })
    },
  },
]

export const CRAFT: Definition[] = [...TEXTILES, ...PRINT, ...ART]
