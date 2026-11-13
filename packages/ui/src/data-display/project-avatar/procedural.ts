// Experimental generators for the default project avatar, compared side by side in the components lab. Each keeps the
// mesh's contract (see generated.ts): the values that define an icon are resolved once from a key, so a stored icon
// never changes, and drawing is a CPU pass on a 2D canvas clipped to the same rounded tile. Most styles paint a small
// grid of pixels that is scaled up nearest-neighbour, with limited palettes and ordered dithering. Only the components
// lab imports this module.

import { cyrb53, drawProjectIcon, generateProjectIcon, mulberry32, tileMask, valueNoise, type GeneratedProjectIcon } from "./generated"
import { CRAFT } from "./procedural-craft"
import {
  clamp01,
  colors,
  css,
  dither,
  ease,
  int,
  legible,
  luma,
  mix,
  normalize,
  ones,
  palette,
  pick,
  Pixels,
  prefixed,
  ramped,
  retry,
  seed,
  shade,
  shuffle,
  smoothstep,
  stars,
  threshold,
  tint,
  type Definition,
} from "./procedural-kit"
import { MACHINE } from "./procedural-machine"
import { WORLD } from "./procedural-world"

export type ProjectIconStyle = {
  readonly id: string
  readonly name: string
  readonly label: string
  /** The gallery group the style belongs to. */
  readonly family: string
  /** Whether the style has a hover animation. */
  readonly animated: boolean
  readonly generate: (key: string) => GeneratedProjectIcon
  /** Draws the icon `seconds` into its hover animation (0 is the static frame) into a square `px` × `px` context. */
  readonly draw: (ctx: CanvasRenderingContext2D, px: number, icon: GeneratedProjectIcon, seconds: number) => void
}

// Curated colors for scenes James's paper-and-ink palettes do not cover.
const SPACE = [0x0e1027, 0x111827, 0x1a1033, 0x071a26, 0x14121f]

const LEAVES = [0x4c956c, 0x2a9d8f, 0x606c38, 0x81b29a, 0x419d78, 0x3f7d3a]

const SOILS = [0x6b4423, 0x5c3d2e, 0x3d2b1f, 0x7a5230]

const PHOSPHORS = [0x39ff7a, 0xffb43a, 0x6fe3ff, 0xd6e4ff, 0xff6fb5]

// Sky top, sky bottom, sun, far ridge, near ridge.
const SCENES = [
  [0x2b1b4a, 0xf28c5a, 0xffe08a, 0x7a3d6b, 0x3a1f3d],
  [0x5fb4e8, 0xd9f1ff, 0xfff3b0, 0x6aa56a, 0x2f6b4f],
  [0x0b1030, 0x2a3a7a, 0xf0f0d0, 0x1f2a55, 0x0a0f24],
  [0xf2a65a, 0xfbe7c2, 0xfff8e0, 0xc4703f, 0x7a3e28],
  [0x8fc7e6, 0xeaf6fb, 0xffffff, 0x9fb8c8, 0x5c7488],
  [0xe89aa8, 0xfde2c8, 0xfff1d6, 0x6d8f71, 0x33503c],
]

// Sky top, sky bottom, sun top, sun bottom, ground, grid lines.
const SYNTH = [
  [0x1b0b3b, 0xe8467c, 0xffd166, 0xff5f7e, 0x13072e, 0xff4fd8],
  [0x0b132b, 0x5b4b8a, 0xfff07a, 0xff8c42, 0x0a0f1f, 0x3ad6ff],
  [0x2d1e4f, 0xff9a62, 0xfff3b0, 0xff6b6b, 0x24133b, 0xffb0d9],
  [0x08263b, 0x1f8a9e, 0xf9f871, 0xf2a65a, 0x061a26, 0x7af5d1],
]

// Classic 8 × 8 one-bit fills, one byte per row.
const PATTERNS = [
  [0xff, 0x80, 0x80, 0x80, 0xff, 0x08, 0x08, 0x08],
  [0xcc, 0xcc, 0x33, 0x33, 0xcc, 0xcc, 0x33, 0x33],
  [0xc1, 0x83, 0x07, 0x0e, 0x1c, 0x38, 0x70, 0xe0],
  [0x80, 0x80, 0x41, 0x3e, 0x08, 0x08, 0x14, 0xe3],
  [0x00, 0x66, 0x66, 0x00, 0x00, 0x66, 0x66, 0x00],
  [0x81, 0x42, 0x24, 0x18, 0x81, 0x42, 0x24, 0x18],
  [0x00, 0x18, 0x18, 0x7e, 0x7e, 0x18, 0x18, 0x00],
  [0xff, 0x88, 0x88, 0x88, 0xff, 0x88, 0x88, 0x88],
  [0x18, 0x3c, 0x7e, 0xff, 0x7e, 0x3c, 0x18, 0x00],
  [0x33, 0x66, 0xcc, 0x99, 0x33, 0x66, 0xcc, 0x99],
]

// 3 × 3 runes, top row in the high bits.
const GLYPHS = [
  0b010111010, 0b101010101, 0b111101111, 0b100100111, 0b111010010, 0b111000111, 0b101101101, 0b100010001, 0b110011001,
  0b101101111, 0b111100111, 0b010101010, 0b011010110, 0b111001001,
]

// The seven tetrominoes as cells, and their colors: the guideline set, a handheld's greys, an 8-bit set and pastels.
const TETROMINOES = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [1, 1],
  ],
  [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
  [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
]

const TETROMINO_COLORS = [
  [0x2ad4e6, 0xf2d230, 0xa64ce0, 0x46d04a, 0xe8413c, 0x3a64e8, 0xf0902a],
  [0x9bbc0f, 0x8bac0f, 0x306230, 0x8bac0f, 0x306230, 0x9bbc0f, 0x306230],
  [0x3cbcfc, 0xf8b800, 0xd800cc, 0x58d854, 0xf83800, 0x0058f8, 0xfca044],
  [0x9ad8e8, 0xf6e3a1, 0xc9b1e8, 0xb5e3b0, 0xf2a7a7, 0xa7b8f2, 0xf5c09a],
]

const RULES = [18, 22, 30, 60, 86, 90, 102, 110, 126, 150, 182]

// An isometric cube eight pixels wide: top, left and right faces.
const CUBE = ["...TT...", ".TTTTTT.", "LTTTTTTR", "LLLTTRRR", "LLLLRRRR", "LLLLRRRR", ".LLLRRR.", "...LR..."]

const DEFINITIONS: Definition[] = [
  {
    id: "pixel-mesh",
    name: "Pixel mesh",
    family: "Gradients",
    label: "James's mesh waves on a 16 grid, dithered to its four inks",
    animated: true,
    resolve: (random) => {
      const position = random("mesh")

      return { grid: 16, seedX: position() * 40, seedY: position() * 40, ...palette(random("palette")) }
    },
    paint: (pixels, p, t) => {
      const inks = colors(p).slice(1)

      pixels.each((x, y) => {
        const u = (x + 0.5) / pixels.n
        const v = 1 - (y + 0.5) / pixels.n
        const mx = u * 3.6 + p.seedX
        const my = (v - u * 0.02) * 2.4 + p.seedY

        return [0, 1, 2].reduce((color, i) => {
          const sx = mx * (0.35 + 0.12 * i) + t * 0.2 * (i + 1)
          const sy = my * 0.6 + i * 3.7
          const k = smoothstep(0.35, 0.75, 0.65 * valueNoise(sx, sy) + 0.35 * valueNoise(sx * 2.1 + 7, sy * 2.1 + 7))

          return k > threshold(x, y) ? inks[i + 1] : color
        }, inks[0])
      })
    },
  },
  {
    id: "dither",
    name: "Dither ramp",
    family: "Pixel and dither",
    label: "A three-step gradient through a 4×4 Bayer matrix",
    animated: true,
    resolve: (random) => {
      const r = random("dither")
      const all = colors(palette(random("palette")))
      const ramp = ramped(shuffle(r, all).slice(0, 3))

      return {
        grid: 16,
        mode: r() < 0.6 ? 0 : 1,
        angle: r() * Math.PI * 2,
        cx: 0.15 + r() * 0.7,
        cy: 0.15 + r() * 0.7,
        ...prefixed("r", ramp),
      }
    },
    paint: (pixels, p, t) => {
      const ramp = colors(p, "r", 3)
      const angle = p.angle + t * 0.9
      const cx = p.cx + Math.sin(t * 1.3) * 0.2
      const cy = p.cy + Math.sin(t * 1.1) * 0.2

      pixels.each((x, y) => {
        const u = (x + 0.5) / pixels.n
        const v = (y + 0.5) / pixels.n

        const value =
          p.mode === 0
            ? ((u - 0.5) * Math.cos(angle) + (v - 0.5) * Math.sin(angle)) * 1.1 + 0.5
            : Math.hypot(u - cx, v - cy)

        return ramp[dither(value, 3, x, y)]
      })
    },
  },
  {
    id: "plasma",
    name: "Plasma",
    family: "Pixel and dither",
    label: "Demoscene sine plasma posterised to a five-step ramp",
    animated: true,
    resolve: (random) => {
      const r = random("plasma")

      return {
        grid: 16,
        a: 0.5 + r() * 0.7,
        b: 0.5 + r() * 0.7,
        c: 0.3 + r() * 0.5,
        d: 0.6 + r() * 0.8,
        p1: r() * 6.28,
        p2: r() * 6.28,
        p3: r() * 6.28,
        cx: r(),
        cy: r(),
        ...prefixed("r", ramped(colors(palette(random("palette"))))),
      }
    },
    paint: (pixels, p, t) => {
      const ramp = colors(p, "r", 5)

      pixels.each((x, y) => {
        const X = ((x + 0.5) / pixels.n) * 6.28
        const Y = ((y + 0.5) / pixels.n) * 6.28

        const value =
          (Math.sin(X * p.a + p.p1 + t * 1.6) +
            Math.sin(Y * p.b + p.p2 - t * 1.1) +
            Math.sin((X + Y) * p.c + p.p3 + t * 0.8) +
            Math.sin(Math.hypot(X - p.cx * 6.28, Y - p.cy * 6.28) * p.d - t * 2)) /
          4

        return ramp[Math.min(4, Math.floor(clamp01(value * 0.6 + 0.5) * 5))]
      })
    },
  },
  {
    id: "contour",
    name: "Contours",
    family: "Pixel and dither",
    label: "Topographic bands of value noise with darker iso-lines",
    animated: true,
    resolve: (random) => {
      const r = random("contour")

      return {
        grid: 16,
        seedX: r() * 40,
        seedY: r() * 40,
        scale: 1.6 + r(),
        ...prefixed("r", ramped(colors(palette(random("palette"))))),
      }
    },
    paint: (pixels, p, t) => {
      const ramp = colors(p, "r", 5)
      const n = pixels.n

      const band = (x: number, y: number) => {
        const X = (x / n) * p.scale + p.seedX + t * 0.3
        const Y = (y / n) * p.scale + p.seedY
        const h = 0.65 * valueNoise(X, Y) + 0.35 * valueNoise(X * 2.1 + 5, Y * 2.1 + 5)

        return Math.max(0, Math.min(4, Math.floor(((h - 0.2) / 0.6) * 5)))
      }

      const bands = Array.from({ length: (n + 2) * (n + 2) }, (_, i) =>
        band((i % (n + 2)) - 1, Math.floor(i / (n + 2)) - 1),
      )

      const at = (x: number, y: number) => bands[(y + 1) * (n + 2) + x + 1]

      pixels.each((x, y) => {
        const b = at(x, y)
        const edge = at(x + 1, y) < b || at(x - 1, y) < b || at(x, y + 1) < b || at(x, y - 1) < b

        return edge ? shade(ramp[b], 0.7) : ramp[b]
      })
    },
  },
  {
    id: "cells",
    name: "Cells",
    family: "Pixel and dither",
    label: "Voronoi cells from four to six seeds, with one-pixel seams",
    animated: true,
    resolve: (random) => ({ grid: 16, seed: seed(random("cells")), ...palette(random("palette")) }),
    paint: (pixels, p, t) => {
      const all = colors(p)
      const rand = mulberry32(p.seed)
      const offset = Math.floor(rand() * 5)

      const sites = Array.from({ length: 4 + Math.floor(rand() * 3) }, (_, i) => {
        const phase = rand() * 6.28

        return {
          x: rand() * pixels.n + Math.sin(t * 1.2 + phase) * 1.5 * Math.min(1, t),
          y: rand() * pixels.n + Math.cos(t * 1.2 + phase) * 1.5 * Math.min(1, t),
          color: all[(i + offset) % 5],
        }
      })

      const seam = shade(ramped(all)[0], 0.55)

      pixels.each((x, y) => {
        const distances = sites
          .map((site) => ({ color: site.color, d: Math.hypot(x + 0.5 - site.x, y + 0.5 - site.y) }))
          .toSorted((a, b) => a.d - b.d)

        return distances[1].d - distances[0].d < 1 ? seam : distances[0].color
      })
    },
  },
  {
    id: "rings",
    name: "Rings",
    family: "Patterns",
    label: "Off-centre concentric rings stepping through three inks",
    animated: true,
    resolve: (random) => {
      const r = random("rings")

      return {
        grid: 16,
        cx: 3 + r() * 10,
        cy: 3 + r() * 10,
        width: 1.5 + r(),
        ...prefixed("r", shuffle(r, colors(palette(random("palette")))).slice(0, 3)),
      }
    },
    paint: (pixels, p, t) => {
      const cycle = colors(p, "r", 3)

      pixels.each((x, y) => {
        const ring = Math.floor((Math.hypot(x + 0.5 - p.cx, y + 0.5 - p.cy) - t * 3) / p.width)

        return cycle[((ring % 3) + 3) % 3]
      })
    },
  },
  {
    id: "kilim",
    name: "Kilim",
    family: "Patterns",
    label: "Stepped diamonds or squares, mirrored like a woven rug",
    animated: true,
    resolve: (random) => {
      const r = random("kilim")

      const [period, band] = pick(r, [
        [16, 2],
        [8, 1],
        [16, 3],
      ])

      return {
        grid: 16,
        period,
        band,
        metric: r() < 0.7 ? 0 : 1,
        ...prefixed("r", shuffle(r, colors(palette(random("palette")))).slice(0, 4)),
      }
    },
    paint: (pixels, p, t) => {
      const cycle = colors(p, "r", 4)
      const center = (p.period - 1) / 2
      const shift = Math.floor(t * 3)

      pixels.each((x, y) => {
        const dx = Math.abs((x % p.period) - center)
        const dy = Math.abs((y % p.period) - center)
        const band = Math.floor((p.metric === 0 ? dx + dy : Math.max(dx, dy)) / p.band) - shift

        return cycle[((band % 4) + 4) % 4]
      })
    },
  },
  {
    id: "triangles",
    name: "Triangles",
    family: "Patterns",
    label: "Four diagonal Truchet tiles; they flip one by one on hover",
    animated: true,
    resolve: (random) => {
      const r = random("triangles")
      const all = colors(palette(random("palette")))
      const ground = pick(r, all)

      return {
        grid: 16,
        seed: seed(r),
        ground,
        ink: legible(
          r,
          all.filter((color) => color !== ground),
          ground,
        ),
      }
    },
    paint: (pixels, p, t) => {
      const rand = mulberry32(p.seed)
      const tiles = Array.from({ length: 4 }, () => ({ o: Math.floor(rand() * 4), r: rand() }))

      pixels.each((x, y) => {
        const tile = tiles[Math.floor(y / 8) * 2 + Math.floor(x / 8)]
        const o = (tile.o + Math.floor(t * 1.2 + tile.r)) % 4
        const lx = o & 1 ? 7 - (x % 8) : x % 8
        const ly = o & 2 ? 7 - (y % 8) : y % 8

        return lx + ly < 7 || (lx + ly === 7 && lx < 4) ? p.ink : p.ground
      })
    },
  },
  {
    id: "quilt",
    name: "Quilt",
    family: "Patterns",
    label: "Half-square triangles mirrored into a four-patch block",
    resolve: (random) => {
      const r = random("quilt")
      const all = colors(palette(random("palette")))

      return { grid: 16, seed: seed(r), ...prefixed("q", [all[0], ...shuffle(r, all.slice(1)).slice(0, 2)]) }
    },
    paint: (pixels, p) => {
      const fabric = colors(p, "q", 3)
      const rand = mulberry32(p.seed)

      const blocks = Array.from({ length: 4 }, () => {
        const a = Math.floor(rand() * 3)

        return { o: Math.floor(rand() * 4), a, b: (a + 1 + Math.floor(rand() * 2)) % 3 }
      })

      pixels.each((x, y) => {
        const X = x < 8 ? x : 15 - x
        const Y = y < 8 ? y : 15 - y
        const block = blocks[Math.floor(Y / 4) * 2 + Math.floor(X / 4)]
        const lx = block.o & 1 ? 3 - (X % 4) : X % 4
        const ly = block.o & 2 ? 3 - (Y % 4) : Y % 4

        return fabric[lx + ly < 3 || (lx + ly === 3 && lx < 2) ? block.a : block.b]
      })
    },
  },
  {
    id: "weave",
    name: "Weave",
    family: "Patterns",
    label: "Basket or twill weave of flat two-pixel strands, each lit along one edge",
    resolve: (random) => {
      const r = random("weave")
      const all = shuffle(r, colors(palette(random("palette"))))

      return {
        grid: 16,
        twill: r() < 0.35 ? 1 : 0,
        strands: r() < 0.5 ? 2 : 1,
        warp: all[0],
        weft: legible(r, all.slice(1), all[0]),
        accent: all[1],
        stripe: r() < 0.4 ? 1 : 0,
      }
    },
    paint: (pixels, p) => {
      pixels.each((x, y) => {
        const cell = 4
        const i = Math.floor(x / cell)
        const j = Math.floor(y / cell)
        const across = p.twill ? (i + j) % 4 < 2 : (i + j) % 2 === 0
        const along = across ? y % cell : x % cell
        const strand = Math.floor(along / (cell / p.strands))
        const edge = along % (cell / p.strands)
        const base = across ? p.weft : p.stripe && i % 3 === 1 ? p.accent : p.warp
        const lit = edge === 0 ? tint(base, 0.18) : edge === cell / p.strands - 1 ? shade(base, 0.62) : base

        return strand % 2 && p.strands === 2 ? shade(lit, 0.9) : lit
      })
    },
  },
  {
    id: "one-bit",
    name: "1-bit",
    family: "Bits and symbols",
    label: "A classic 8×8 fill pattern in one ink; it scrolls on hover",
    animated: true,
    resolve: (random) => {
      const r = random("bits")
      const all = colors(palette(random("palette")))
      const ink = legible(r, all.slice(1), all[0])
      const invert = r() < 0.5

      return {
        grid: 8,
        pattern: Math.floor(r() * PATTERNS.length),
        ox: Math.floor(r() * 8),
        oy: Math.floor(r() * 8),
        ink: invert ? all[0] : ink,
        ground: invert ? ink : all[0],
      }
    },
    paint: (pixels, p, t) => {
      const shift = Math.floor(t * 3)
      const rows = PATTERNS[p.pattern]

      pixels.each((x, y) => ((rows[(y + p.oy + shift) & 7] >> (7 - ((x + p.ox + shift) & 7))) & 1 ? p.ink : p.ground))
    },
  },
  {
    id: "glyphs",
    name: "Glyphs",
    family: "Bits and symbols",
    label: "Four 3×3 runes on coloured tiles; they cycle on hover",
    animated: true,
    resolve: (random) => ({ grid: 16, seed: seed(random("glyphs")), ...palette(random("palette")) }),
    paint: (pixels, p, t) => {
      const all = colors(p)
      const rand = mulberry32(p.seed)

      const grounds = retry(
        () => Array.from({ length: 4 }, () => Math.floor(rand() * 5)),
        (list) => list[0] !== list[1] && list[0] !== list[2] && list[3] !== list[1] && list[3] !== list[2],
      )

      const tiles = grounds.map((ground) => ({
        ground: all[ground],
        ink: legible(
          rand,
          all.filter((_, i) => i !== ground),
          all[ground],
        ),
        glyph: Math.floor(rand() * GLYPHS.length),
        r: rand(),
      }))

      pixels.each((x, y) => {
        const tile = tiles[Math.floor(y / 8) * 2 + Math.floor(x / 8)]
        const lx = (x % 8) - 1
        const ly = (y % 8) - 1

        if (lx < 0 || ly < 0 || lx > 5 || ly > 5) return tile.ground
        const glyph = GLYPHS[(tile.glyph + Math.floor(t * 2 + tile.r)) % GLYPHS.length]

        return (glyph >> (8 - (Math.floor(ly / 2) * 3 + Math.floor(lx / 2)))) & 1 ? tile.ink : tile.ground
      })
    },
  },
  {
    id: "flag",
    name: "Flag",
    family: "Bits and symbols",
    label: "Stripe, cross and canton compositions, like an invented flag",
    resolve: (random) => {
      const r = random("flag")

      return {
        grid: 16,
        layout: Math.floor(r() * 9),
        ...prefixed("f", shuffle(r, colors(palette(random("palette")))).slice(0, 3)),
      }
    },
    paint: (pixels, p) => {
      const [a, b, c] = colors(p, "f", 3)

      const layouts = [
        (x: number, y: number) => (y < 5 ? a : y < 11 ? b : c),
        (x: number, _: number) => (x < 5 ? a : x < 11 ? b : c),
        (x: number, y: number) =>
          (x >= 5 && x <= 6) || (y >= 7 && y <= 8) ? c : (x >= 4 && x <= 7) || (y >= 6 && y <= 9) ? b : a,
        (x: number, y: number) => (x + y < 14 ? a : x + y > 16 ? b : c),
        (x: number, y: number) => (x < 7 && y < 7 ? c : Math.floor(y / 2) % 2 ? b : a),
        (x: number, y: number) => (x < 8 - Math.abs(y - 7.5) ? c : y < 8 ? a : b),
        (x: number, y: number) => (Math.hypot(x - 7.5, y - 7.5) < 4.6 ? b : a),
        (x: number, y: number) => (x < 8 !== y < 8 ? b : a),
        (x: number, y: number) => (Math.abs(x - y) <= 1 || Math.abs(x + y - 15) <= 1 ? b : a),
      ]

      pixels.each(layouts[p.layout])
    },
  },
  {
    id: "identicon",
    name: "Identicon",
    family: "Characters",
    label: "A mirrored 6×6 sprite on a tinted ground",
    resolve: (random) => {
      const r = random("sprite")
      const all = colors(palette(random("palette")))
      const ink = legible(r, all.slice(1), all[0])
      const invert = r() < 0.3

      return {
        grid: 8,
        bits: retry(
          () => Math.floor(r() * 2 ** 18),
          (bits) => ones(bits) >= 7 && ones(bits) <= 12,
        ),
        ink: invert ? all[0] : ink,
        ground: invert ? ink : mix(all[0], ink, 0.14),
      }
    },
    paint: (pixels, p) => {
      pixels.fill(p.ground)

      for (let row = 0; row < 6; row++)
        for (let column = 0; column < 3; column++) {
          if (!((p.bits >> (row * 3 + column)) & 1)) continue
          pixels.set(1 + column, 1 + row, p.ink)
          pixels.set(6 - column, 1 + row, p.ink)
        }
    },
  },
  {
    id: "critter",
    name: "Critter",
    family: "Characters",
    label: "A mirrored little creature with see-through eyes; it walks and blinks on hover",
    animated: true,
    resolve: (random) => {
      const r = random("critter")
      const all = colors(palette(random("palette")))
      const body = pick(r, all.slice(1))

      return {
        grid: 8,
        w1: 1 + Math.floor(r() * 2),
        w3: 2 + Math.floor(r() * 2),
        w4: 1 + Math.floor(r() * 3),
        antenna: Math.floor(r() * 3),
        arms: r() < 0.5 ? 1 : 0,
        legs: 1 + Math.floor(r() * 7),
        feet: Math.floor(r() * 3),
        cyclops: r() < 0.25 ? 1 : 0,
        mouth: r() < 0.35 ? 1 : 0,
        body,
        ground: luma(body) > 0.45 ? mix(0x14151a, body, 0.15) : mix(all[0], body, 0.1),
      }
    },
    paint: (pixels, p, t) => {
      // Rows: antenna, head, eyes, body, belly, legs, feet, and an empty bottom row.
      const widths = [0, p.w1, 3, p.w3, p.w4]
      const step = Math.floor(t * 5) % 2
      const blink = t % 2.2 > 2

      const put = (dc: number, row: number, color: number) => {
        pixels.set(3 - dc, row, color)
        pixels.set(4 + dc, row, color)
      }

      pixels.fill(p.ground)
      widths.forEach((width, row) => {
        for (let dc = 0; dc < width; dc++) put(dc, row, p.body)
      })

      if (p.antenna) put(p.antenna, 0, p.body)

      if (p.arms) put(3, 3, p.body)

      for (let dc = 0; dc < 3; dc++) {
        if (!((p.legs >> dc) & 1)) continue
        put(dc, 5, p.body)
        const shifted = Math.max(0, Math.min(3, dc + (p.feet === 1 ? 1 : p.feet === 2 ? -1 : 0)))
        put(step ? dc : shifted, 6, p.body)
      }

      if (!blink) put(p.cyclops ? 0 : 1, 2, p.ground)

      if (p.mouth && p.w4 > 1) put(0, 4, p.ground)
    },
  },
  {
    id: "phosphor",
    name: "Phosphor",
    family: "Characters",
    label: "A glowing sprite on a dark tube with scanlines; the roll bar passes on hover",
    animated: true,
    resolve: (random) => {
      const r = random("phosphor")

      return {
        grid: 16,
        phosphor: pick(r, PHOSPHORS),
        bits: retry(
          () => Math.floor(r() * 2 ** 15),
          (bits) => ones(bits) >= 7 && ones(bits) <= 11 && (bits & 0b100100100100100) !== 0,
        ),
      }
    },
    paint: (pixels, p, t) => {
      const ground = mix(0x060807, p.phosphor, 0.06)

      const lit = (x: number, y: number) => {
        if (x < 3 || y < 3 || x > 12 || y > 12) return false
        const gx = Math.floor((x - 3) / 2)
        const gy = Math.floor((y - 3) / 2)

        return ((p.bits >> (gy * 3 + (gx < 3 ? gx : 4 - gx))) & 1) === 1
      }

      const bar = ((t * 7) % 24) - 4

      pixels.each((x, y) => {
        const on = lit(x, y)
        const glow = !on && (lit(x - 1, y) || lit(x + 1, y) || lit(x, y - 1) || lit(x, y + 1))
        const base = on ? p.phosphor : glow ? mix(ground, p.phosphor, 0.3) : ground
        const roll = t > 0 ? Math.max(0, 1 - Math.abs(y - bar) / 2.5) : 0
        const scan = y % 2 ? 0.62 : 1
        const vignette = Math.hypot(x - 7.5, y - 7.5) > 7.5 ? 0.8 : 1

        return shade(mix(base, tint(p.phosphor, 0.5), roll * 0.35), scan * vignette)
      })
    },
  },
  {
    id: "planet",
    name: "Planet",
    family: "Scenes",
    label: "A banded, dithered planet, sometimes ringed; it turns on hover",
    animated: true,
    resolve: (random) => {
      const r = random("planet")
      const inks = colors(palette(random("palette"))).slice(1)
      const [a, b, ring] = shuffle(r, inks)

      return {
        grid: 16,
        seed: seed(r),
        space: pick(r, SPACE),
        a,
        b,
        ringColor: tint(ring, 0.35),
        ring: r() < 0.4 ? 1 : 0,
        tilt: (r() - 0.5) * 0.8,
        radius: 5.2 + r() * 1.2,
        bands: 2 + r() * 3,
        phase: r() * 6.28,
      }
    },
    paint: (pixels, p, t) => {
      pixels.fill(p.space)
      stars(pixels, mulberry32(p.seed), p.space, 5)
      const [lx, ly, lz] = normalize(-0.55, -0.5, 0.67)
      const cos = Math.cos(p.tilt)
      const sin = Math.sin(p.tilt)

      pixels.each((x, y) => {
        const dx = (x + 0.5 - 8) / p.radius
        const dy = (y + 0.5 - 8) / p.radius
        const rx = dx * cos + dy * sin
        const ry = -dx * sin + dy * cos
        const e = (rx / 1.75) ** 2 + (ry / 0.42) ** 2
        const ring = p.ring === 1 && e > 0.72 && e < 1

        if (dx * dx + dy * dy > 1) return ring ? p.ringColor : undefined

        if (ring && ry > 0) return p.ringColor
        const dz = Math.sqrt(1 - dx * dx - dy * dy)
        const lon = Math.atan2(dx, dz) + t * 1.2
        const base = Math.sin(dy * p.bands * Math.PI + p.phase + 0.6 * Math.sin(lon * 2 + dy * 3)) > 0 ? p.a : p.b

        return [shade(base, 0.5), base, tint(base, 0.3)][dither((dx * lx + dy * ly + dz * lz) * 0.75 + 0.3, 3, x, y)]
      })
    },
  },
  {
    id: "moon",
    name: "Moon",
    family: "Scenes",
    label: "A cratered moon in phase with a faint halo; it waxes on hover",
    animated: true,
    resolve: (random) => {
      const r = random("moon")
      const paper = colors(palette(random("palette")))[0]

      return {
        grid: 16,
        seed: seed(r),
        night: pick(r, SPACE),
        moon: mix(paper, 0xd8dce6, r() * 0.6),
        radius: 5.4 + r(),
        ox: (r() - 0.5) * 1.2,
        oy: (r() - 0.5) * 1.2,
        phase: 0.55 + r() * 0.9,
        side: r() < 0.5 ? -1 : 1,
      }
    },
    paint: (pixels, p, t) => {
      const rand = mulberry32(p.seed)
      const cx = 8 + p.ox
      const cy = 8 + p.oy
      pixels.fill(p.night)
      stars(pixels, rand, p.night, 4)

      const craters = Array.from({ length: 4 }, () => ({
        x: cx + (rand() * 2 - 1) * p.radius * 0.6,
        y: cy + (rand() * 2 - 1) * p.radius * 0.6,
        r: 0.8 + rand() * 1.2,
      }))

      const offset = (p.phase + Math.sin(t * 0.9) * 0.45) * p.radius * p.side

      pixels.each((x, y) => {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)

        if (d > p.radius) return d < p.radius + 1 ? mix(p.night, p.moon, 0.12) : undefined

        const surface = craters.some((crater) => Math.hypot(x + 0.5 - crater.x, y + 0.5 - crater.y) < crater.r)
          ? shade(p.moon, 0.8)
          : p.moon

        return Math.hypot(x + 0.5 - cx - offset, y + 0.5 - cy) < p.radius ? mix(p.night, surface, 0.16) : surface
      })
    },
  },
  {
    id: "starfield",
    name: "Starfield",
    family: "Scenes",
    label: "Stars, two with cross glints, over a dithered nebula; they twinkle on hover",
    animated: true,
    resolve: (random) => {
      const r = random("stars")

      return {
        grid: 16,
        seed: seed(r),
        space: pick(r, SPACE),
        nebula: pick(r, colors(palette(random("palette"))).slice(1)),
        seedX: r() * 40,
        seedY: r() * 40,
      }
    },
    paint: (pixels, p, t) => {
      const bottom = mix(p.space, p.nebula, 0.12)

      pixels.each((x, y) => {
        const base = dither(y / 15, 2, x, y) ? bottom : p.space

        const cloud =
          0.7 * valueNoise(x * 0.22 + p.seedX, y * 0.22 + p.seedY) +
          0.3 * valueNoise(x * 0.5 + p.seedY, y * 0.5 + p.seedX)

        const level = dither((cloud - 0.4) / 0.3, 3, x, y)

        return level ? mix(base, p.nebula, level * 0.18) : base
      })
      const rand = mulberry32(p.seed)
      Array.from({ length: 10 }, (_, i) => {
        const x = i < 2 ? 2 + Math.floor(rand() * 12) : Math.floor(rand() * 16)
        const y = i < 2 ? 2 + Math.floor(rand() * 12) : Math.floor(rand() * 16)
        const level = [0.55, 0.8, 1][Math.floor(rand() * 3)]
        const twinkle = 1 - 0.45 * (1 - Math.cos(t * (2 + rand() * 4)))
        pixels.set(x, y, mix(p.space, i % 3 ? 0xfff6e0 : 0xdfe9ff, (i < 2 ? 1 : level) * twinkle))

        if (i >= 2) return
        const glint = mix(p.space, 0xfff6e0, 0.7 * twinkle)
        pixels.set(x - 1, y, glint)
        pixels.set(x + 1, y, glint)
        pixels.set(x, y - 1, glint)
        pixels.set(x, y + 1, glint)
      })
    },
  },
  {
    id: "horizon",
    name: "Horizon",
    family: "Scenes",
    label: "A dithered sky, a sun and two ridgelines; they drift on hover",
    animated: true,
    resolve: (random) => {
      const r = random("horizon")

      return {
        grid: 16,
        ...prefixed("s", pick(r, SCENES)),
        sunX: 4 + r() * 8,
        sunY: 4.5 + r() * 3.5,
        back: 6 + r() * 2,
        front: 3 + r() * 1.5,
        p1: r() * 6.28,
        p2: r() * 6.28,
        p3: r() * 6.28,
        p4: r() * 6.28,
      }
    },
    paint: (pixels, p, t) => {
      const [top, bottom, sun, far, near] = colors(p, "s", 5)
      const sky = [top, mix(top, bottom, 0.5), bottom]

      pixels.each((x, y) => {
        const front = p.front + 1.3 * (Math.sin(x * 0.7 + p.p3 + t * 1.4) + 0.5 * Math.sin(x * 1.6 + p.p4 + t * 1.4))

        if (y >= 16 - front) return near
        const back = p.back + 1.6 * (Math.sin(x * 0.5 + p.p1 + t * 0.6) + 0.5 * Math.sin(x * 1.1 + p.p2 + t * 0.6))

        if (y >= 16 - back) return far

        if (Math.hypot(x + 0.5 - p.sunX, y + 0.5 - p.sunY) < 2.6) return sun

        return sky[dither(y / 12, 3, x, y)]
      })
    },
  },
  {
    id: "sundown",
    name: "Sundown",
    family: "Scenes",
    label: "A slatted retro sun over a perspective grid; the slats rise on hover",
    animated: true,
    resolve: (random) => {
      const r = random("sundown")

      return { grid: 16, radius: 4.6 + r(), ...prefixed("s", pick(r, SYNTH)) }
    },
    paint: (pixels, p, t) => {
      const [top, bottom, sunTop, sunBottom, ground, line] = colors(p, "s", 6)
      const sky = [top, mix(top, bottom, 0.5), bottom]
      const shift = Math.floor(t * 4)

      pixels.each((x, y) => {
        if (y === 11) return line

        if (y > 11) {
          const depth = (y + 0.5 - 11) / 4.5
          const lane = (x + 0.5 - 8) / depth / 5
          const horizontal = y === 13 || y === 15

          return horizontal || Math.abs(lane - Math.round(lane)) < 0.5 / (5 * depth) ? mix(ground, line, 0.75) : ground
        }

        if (Math.hypot(x + 0.5 - 8, y + 0.5 - 11) < p.radius && !(y >= 7 && (y + shift) % 3 === 0))
          return dither((y - (11 - p.radius)) / p.radius, 2, x, y) ? sunBottom : sunTop

        return sky[dither(y / 11, 3, x, y)]
      })
    },
  },
  {
    id: "sprout",
    name: "Sprout",
    family: "Scenes",
    label: "A plant with leaves and a bloom on a strip of soil; it sways on hover",
    animated: true,
    resolve: (random) => {
      const r = random("sprout")
      const all = colors(palette(random("palette")))
      const bloom = legible(r, all.slice(1), all[0])

      return {
        grid: 16,
        seed: seed(r),
        paper: all[0],
        leaf: pick(r, LEAVES),
        soil: pick(r, SOILS),
        bloom,
        center: luma(bloom) > 0.6 ? shade(bloom, 0.55) : 0xf6c344,
        height: 6 + Math.floor(r() * 3),
        x: 7 + Math.floor(r() * 2),
        flower: Math.floor(r() * 3),
        leafA: 2 + Math.floor(r() * 2),
        leafB: 4 + Math.floor(r() * 2),
        side: r() < 0.5 ? -1 : 1,
      }
    },
    paint: (pixels, p, t) => {
      const top = 12 - p.height
      const sway = (y: number) => Math.round(Math.sin(t * 2.2) * ((12 - y) / p.height) * 1.4 * Math.min(1, t * 2))
      const rand = mulberry32(p.seed)
      pixels.fill(p.paper)
      pixels.rect(0, 13, 16, 3, p.soil)
      pixels.rect(0, 13, 16, 1, tint(p.soil, 0.18))
      Array.from({ length: 3 }, () => pixels.set(Math.floor(rand() * 16), 12, p.leaf))

      for (let y = 12; y > top; y--) pixels.set(p.x + sway(y), y, p.leaf)
      ;[
        [p.leafA, p.side],
        [p.leafB, -p.side],
      ].forEach(([height, side]) => {
        const y = 12 - height
        const x = p.x + sway(y)
        pixels.set(x + side, y, p.leaf)
        pixels.set(x + side * 2, y - 1, p.leaf)
        pixels.set(x + side, y - 1, tint(p.leaf, 0.2))
      })
      const x = p.x + sway(top)

      const flowers = [
        () => {
          ;[
            [0, -1],
            [-1, 0],
            [1, 0],
            [0, 1],
          ].forEach(([dx, dy]) => pixels.set(x + dx, top + dy, p.bloom))
          pixels.set(x, top, p.center)
        },
        () => {
          pixels.rect(x - 1, top - 1, 3, 2, p.bloom)
          pixels.set(x - 1, top - 2, p.bloom)
          pixels.set(x + 1, top - 2, p.bloom)
          pixels.set(x, top - 1, shade(p.bloom, 0.75))
        },
        () => {
          ;[
            [-2, 0],
            [2, 0],
            [0, -2],
            [0, 2],
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].forEach(([dx, dy]) => pixels.set(x + dx, top + dy, p.bloom))
          ;[
            [0, 0],
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ].forEach(([dx, dy]) => pixels.set(x + dx, top + dy, p.center))
        },
      ]

      flowers[p.flower]()
    },
  },
  {
    id: "iso",
    name: "Iso blocks",
    family: "Scenes",
    label: "Isometric cubes stacked on a 2×2 footprint, lit from the top left",
    resolve: (random) => {
      const r = random("iso")

      const heights = retry(
        () => Array.from({ length: 4 }, () => Math.floor(r() * 3)),
        (list) => list.reduce((sum, h) => sum + h, 0) >= 3,
      )

      return {
        grid: 16,
        ...prefixed("h", heights),
        ...prefixed(
          "k",
          heights.map(() => Math.floor(r() * 4)),
        ),
        ...palette(random("palette")),
      }
    },
    paint: (pixels, p) => {
      const inks = colors(p).slice(1)

      const cubes = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]
        .flatMap(([i, j], index) =>
          Array.from({ length: p[`h${index}`] }, (_, k) => ({ i, j, k, ink: inks[p[`k${index}`]] })),
        )
        .toSorted((a, b) => a.i + a.j - (b.i + b.j) || a.k - b.k)

      const tops = cubes.map((cube) => (cube.i + cube.j) * 2 - cube.k * 4)
      const extent = Math.max(...tops) + 8 - Math.min(...tops)
      const oy = Math.round((16 - extent) / 2) - Math.min(...tops)

      pixels.fill(p.c0)
      cubes.forEach((cube) => {
        const faces = { T: tint(cube.ink, 0.3), L: cube.ink, R: shade(cube.ink, 0.72) }
        const x0 = 4 + (cube.i - cube.j) * 4
        const y0 = oy + (cube.i + cube.j) * 2 - cube.k * 4
        CUBE.forEach((row, dy) =>
          [...row].forEach((face, dx) => {
            if (face === "T" || face === "L" || face === "R") pixels.set(x0 + dx, y0 + dy, faces[face])
          }),
        )
      })
    },
  },
  {
    id: "stack",
    name: "Stack",
    family: "Geometry",
    label: "Tetrominoes dropped into an eight-wide well, with the next piece falling; it lands on hover",
    animated: true,
    resolve: (random) => {
      const r = random("stack")

      return {
        grid: 16,
        seed: seed(r),
        pieces: int(r, 12, 18),
        ...prefixed("t", pick(r, TETROMINO_COLORS)),
        well: pick(r, [0x0b0d14, 0x101010, 0x14102a, 0x0a1a1f]),
      }
    },
    paint: (pixels, p, t) => {
      const tints = colors(p, "t", 7)
      const rand = mulberry32(p.seed)
      const board = Array.from({ length: 64 }, () => -1)
      const filled = (x: number, y: number) => x < 0 || x > 7 || y > 7 || (y >= 0 && board[y * 8 + x] >= 0)
      const fits = (cells: number[][], x: number, y: number) => cells.every(([cx, cy]) => !filled(x + cx, y + cy))

      // Drop each piece where it leaves the fewest holes of six random columns and turns, as a player would, keeping
      // the top three rows clear.
      Array.from({ length: p.pieces }, () => {
        const kind = Math.floor(rand() * 7)

        const [cells, x, y] = Array.from({ length: 6 }, () => {
          const cells = turned(TETROMINOES[kind], Math.floor(rand() * 4))
          const x = Math.floor(rand() * (9 - (Math.max(...cells.map(([cx]) => cx)) + 1)))
          let y = -2

          while (fits(cells, x, y + 1)) y++
          const own = (cx: number, cy: number) => cells.some(([ox, oy]) => ox === cx && oy === cy)
          const holes = cells.filter(([cx, cy]) => !own(cx, cy + 1) && !filled(x + cx, y + cy + 1)).length

          return [cells, x, y, y - holes * 3] as const
        }).toSorted((a, b) => b[3] - a[3])[0]

        if (cells.some(([, cy]) => y + cy < 3)) return
        cells.forEach(([cx, cy]) => (board[(y + cy) * 8 + x + cx] = kind))
      })

      const kind = Math.floor(rand() * 7)
      const falling = turned(TETROMINOES[kind], Math.floor(rand() * 4))
      const fx = Math.floor(rand() * (9 - (Math.max(...falling.map(([x]) => x)) + 1)))
      let landing = 0

      while (fits(falling, fx, landing + 1)) landing++
      const fy = Math.min(landing, Math.floor(t * 4))

      pixels.fill(p.well)

      const block = (bx: number, by: number, color: number) => {
        pixels.set(bx * 2, by * 2, tint(color, 0.45))
        pixels.set(bx * 2 + 1, by * 2, color)
        pixels.set(bx * 2, by * 2 + 1, color)
        pixels.set(bx * 2 + 1, by * 2 + 1, shade(color, 0.6))
      }

      board.forEach((piece, i) => piece >= 0 && block(i % 8, Math.floor(i / 8), tints[piece]))
      falling.forEach(([cx, cy]) => block(fx + cx, fy + cy, tints[kind]))
    },
  },
  {
    id: "maze",
    name: "Maze",
    family: "Geometry",
    label: "A 5×5 backtracker maze with its route marked; a runner walks it on hover",
    animated: true,
    resolve: (random) => {
      const r = random("maze")
      const all = colors(palette(random("palette")))
      const wall = ramped(all.slice(1))[0]

      return {
        grid: 16,
        seed: seed(r),
        wall,
        path: all[0],
        route: legible(
          r,
          all.slice(1).filter((color) => color !== wall),
          all[0],
        ),
      }
    },
    paint: (pixels, p, t) => {
      const rand = mulberry32(p.seed)
      const passages = new Set<string>()
      const visited = new Set([0])
      const stack = [0]
      const link = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`

      const neighbours = (cell: number) =>
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].flatMap(([dx, dy]) => {
          const x = (cell % 5) + dx
          const y = Math.floor(cell / 5) + dy

          return x >= 0 && y >= 0 && x < 5 && y < 5 ? [y * 5 + x] : []
        })

      while (stack.length) {
        const cell = stack[stack.length - 1]
        const options = neighbours(cell).filter((next) => !visited.has(next))

        if (!options.length) {
          stack.pop()
          continue
        }

        const next = options[Math.floor(rand() * options.length)]
        visited.add(next)
        passages.add(link(cell, next))
        stack.push(next)
      }

      // The tree has one path between any two cells: walk back from the exit through each cell's parent.
      const parents = new Map([[0, -1]])
      const queue = [0]

      while (queue.length) {
        const cell = queue.shift()!
        neighbours(cell)
          .filter((next) => passages.has(link(cell, next)) && !parents.has(next))
          .forEach((next) => {
            parents.set(next, cell)
            queue.push(next)
          })
      }

      const route = [24]

      while (route[route.length - 1] !== 0) route.push(parents.get(route[route.length - 1])!)

      const open = (a: number, b: number, color: number) => {
        const ax = 1 + 3 * (a % 5)
        const ay = 1 + 3 * Math.floor(a / 5)
        pixels.rect(ax, ay, 2, 2, color)

        if (b < 0) return
        const bx = 1 + 3 * (b % 5)
        const by = 1 + 3 * Math.floor(b / 5)
        pixels.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(ax - bx) + 2, Math.abs(ay - by) + 2, color)
      }

      pixels.fill(p.wall)
      Array.from({ length: 25 }, (_, cell) => open(cell, -1, p.path))
      passages.forEach((key) => {
        const [a, b] = key.split("-").map(Number)
        open(a, b, p.path)
      })
      route.forEach((cell, i) => open(cell, route[i + 1] ?? -1, p.route))

      if (t <= 0) return
      const runner = route.toReversed()[Math.floor(t * 5) % route.length]
      open(runner, -1, tint(p.route, 0.65))
    },
  },
  {
    id: "rule",
    name: "Rule",
    family: "Geometry",
    label: "An elementary cellular automaton grown from a random first row; it scrolls on hover",
    animated: true,
    resolve: (random) => {
      const r = random("rule")
      const all = colors(palette(random("palette")))
      const a = legible(r, all.slice(1), all[0])

      return {
        grid: 16,
        rule: pick(r, RULES),
        first: Array.from({ length: 1 + Math.floor(r() * 3) }, () => 1 << Math.floor(r() * 16)).reduce(
          (bits, bit) => bits | bit,
          0,
        ),
        ground: all[0],
        a,
        b: legible(
          r,
          all.slice(1).filter((color) => color !== a),
          all[0],
        ),
      }
    },
    paint: (pixels, p, t) => {
      const next = (cells: number[]) =>
        cells.map((cell, i) => (p.rule >> ((cells[(i + 15) % 16] << 2) | (cell << 1) | cells[(i + 1) % 16])) & 1)

      const first = Array.from({ length: 16 }, (_, i) => (p.first >> i) & 1)

      const rows = Array.from({ length: 15 + Math.floor(t * 6) }).reduce<number[][]>(
        (history) => [...history, next(history[history.length - 1])],
        [first],
      )

      const visible = rows.slice(-16)

      pixels.each((x, y) => (visible[y][x] ? (dither(y / 15, 2, x, y) ? p.b : p.a) : p.ground))
    },
  },
  {
    id: "arcs",
    name: "Arcs",
    family: "Geometry",
    label: "Smooth Truchet quarter-circles; tiles turn on hover",
    animated: true,
    resolve: (random) => {
      const r = random("arcs")
      const all = colors(palette(random("palette")))
      const ground = pick(r, all.slice(1))

      return {
        seed: seed(r),
        tiles: r() < 0.5 ? 2 : 3,
        weight: 0.2 + r() * 0.08,
        ground,
        ink: legible(
          r,
          all.filter((color) => color !== ground),
          ground,
        ),
      }
    },
    vector: (ctx, px, p, t) => {
      const size = px / p.tiles
      const rand = mulberry32(p.seed)
      ctx.fillStyle = css(p.ground)
      ctx.fillRect(0, 0, px, px)
      ctx.strokeStyle = css(p.ink)
      ctx.lineWidth = size * p.weight

      for (let i = 0; i < p.tiles; i++)
        for (let j = 0; j < p.tiles; j++) {
          const turn = rand() < 0.5 ? Math.PI / 2 : 0
          const delay = rand()
          ctx.save()
          ctx.translate((i + 0.5) * size, (j + 0.5) * size)
          ctx.rotate(turn + ease(t * 1.2 - delay * 0.8) * (Math.PI / 2))
          ctx.beginPath()
          ctx.arc(-size / 2, -size / 2, size / 2, 0, Math.PI / 2)
          ctx.moveTo(0, size / 2)
          ctx.arc(size / 2, size / 2, size / 2, Math.PI, Math.PI * 1.5)
          ctx.stroke()
          ctx.restore()
        }
    },
  },
  {
    id: "bauhaus",
    name: "Bauhaus",
    family: "Geometry",
    label: "Circles, halves and quarters on a 2×2 grid; forms turn on hover",
    animated: true,
    resolve: (random) => ({ seed: seed(random("bauhaus")), ...palette(random("palette")) }),
    vector: (ctx, px, p, t) => {
      const all = colors(p)
      const rand = mulberry32(p.seed)
      const size = px / 2

      const grounds = retry(
        () => Array.from({ length: 4 }, () => Math.floor(rand() * 5)),
        (list) => list[0] !== list[1] && list[0] !== list[2] && list[3] !== list[1] && list[3] !== list[2],
      )

      grounds.forEach((ground, index) => {
        const inks = all.filter((_, i) => i !== ground)
        const ink = inks[Math.floor(rand() * inks.length)]
        const form = Math.floor(rand() * 4)
        const turn = Math.floor(rand() * 4)
        const delay = rand()
        ctx.save()
        ctx.translate(((index % 2) + 0.5) * size, (Math.floor(index / 2) + 0.5) * size)
        ctx.fillStyle = css(all[ground])
        ctx.fillRect(-size / 2 - 0.5, -size / 2 - 0.5, size + 1, size + 1)
        ctx.rotate((turn + ease(t * 1.1 - delay * 0.6)) * (Math.PI / 2))
        ctx.fillStyle = css(ink)
        ctx.beginPath()

        const forms = [
          () => ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2),
          () => ctx.arc(0, size / 2, size / 2, Math.PI, Math.PI * 2),
          () => {
            ctx.moveTo(-size / 2, -size / 2)
            ctx.arc(-size / 2, -size / 2, size, 0, Math.PI / 2)
          },
          () => {
            ctx.moveTo(-size / 2, -size / 2)
            ctx.lineTo(size / 2, -size / 2)
            ctx.lineTo(-size / 2, size / 2)
          },
        ]

        forms[form]()
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      })
    },
  },
  {
    id: "sweep",
    name: "Sweep",
    family: "Gradients",
    label: "A conic sweep through three inks with a soft highlight; it turns on hover",
    animated: true,
    resolve: (random) => {
      const r = random("sweep")

      return {
        angle: r() * Math.PI * 2,
        cx: 0.25 + r() * 0.5,
        cy: 0.25 + r() * 0.5,
        ...prefixed("s", shuffle(r, colors(palette(random("palette"))).slice(1)).slice(0, 3)),
      }
    },
    vector: (ctx, px, p, t) => {
      const [a, b, c] = colors(p, "s", 3)
      const sweep = ctx.createConicGradient(p.angle + t * 0.8, p.cx * px, p.cy * px)
      sweep.addColorStop(0, css(a))
      sweep.addColorStop(1 / 3, css(b))
      sweep.addColorStop(2 / 3, css(c))
      sweep.addColorStop(1, css(a))
      ctx.fillStyle = sweep
      ctx.fillRect(0, 0, px, px)
      const light = ctx.createRadialGradient(px * 0.3, px * 0.2, 0, px * 0.3, px * 0.2, px * 0.8)
      light.addColorStop(0, "rgba(255, 255, 255, 0.28)")
      light.addColorStop(1, "rgba(255, 255, 255, 0)")
      ctx.fillStyle = light
      ctx.fillRect(0, 0, px, px)
    },
  },
]

const MESH: ProjectIconStyle = {
  id: "mesh",
  name: "Mesh",
  label: "The current default: James's mesh gradient with film grain",
  family: "Gradients",
  animated: true,
  generate: generateProjectIcon,
  draw: drawProjectIcon,
}

/** The gallery's groups, in order: the first set of styles, then the second set from the craft, world and machine files. */
export const PROJECT_ICON_FAMILIES = [
  "Gradients",
  "Pixel and dither",
  "Patterns",
  "Bits and symbols",
  "Characters",
  "Scenes",
  "Geometry",
  "Textiles",
  "Print",
  "Art movements",
  "Nature and materials",
  "Creatures",
  "Objects",
  "Emblems",
  "Retro tech",
  "Tiling and curves",
]

export const PROJECT_ICON_STYLES: readonly ProjectIconStyle[] = [
  MESH,
  ...[...DEFINITIONS, ...CRAFT, ...WORLD, ...MACHINE].map(define),
].toSorted((a, b) => PROJECT_ICON_FAMILIES.indexOf(a.family) - PROJECT_ICON_FAMILIES.indexOf(b.family))

export function projectIconStyle(id: string) {
  return PROJECT_ICON_STYLES.find((style) => style.id === id) ?? MESH
}

// A tetromino's cells after `turns` quarter turns, moved back to the origin.
function turned(cells: number[][], turns: number) {
  const rotated = Array.from({ length: turns }).reduce<number[][]>(
    (list) => list.map(([x, y]) => [-y, x]),
    cells,
  )
  const minX = Math.min(...rotated.map(([x]) => x))
  const minY = Math.min(...rotated.map(([, y]) => y))

  return rotated.map(([x, y]) => [x - minX, y - minY])
}

function define(definition: Definition): ProjectIconStyle {
  return {
    id: definition.id,
    name: definition.name,
    label: definition.label,
    family: definition.family,
    animated: definition.animated ?? false,
    generate: (key) => ({
      style: definition.id,
      version: 1,
      params: definition.resolve((tag) => mulberry32(cyrb53(`${key}|${definition.id}|${tag}`))),
    }),
    draw: (ctx, px, icon, seconds) => {
      if ("vector" in definition) {
        ctx.clearRect(0, 0, px, px)
        definition.vector(ctx, px, icon.params, seconds)
        clip(ctx, px)

        return
      }

      const pixels = new Pixels(icon.params.grid)
      definition.paint(pixels, icon.params, seconds)
      blit(ctx, px, pixels)
    },
  }
}

// Scales the grid up nearest-neighbour, so every cell stays a hard-edged block, and cuts the rounded tile.
function blit(ctx: CanvasRenderingContext2D, px: number, pixels: Pixels) {
  const image = ctx.createImageData(px, px)

  for (let row = 0; row < px; row++) {
    const y = Math.floor((row * pixels.n) / px)

    for (let column = 0; column < px; column++) {
      const mask = tileMask((column + 0.5) / px, (row + 0.5) / px, px)

      if (mask <= 0) continue
      const color = pixels.cells[y * pixels.n + Math.floor((column * pixels.n) / px)]
      const index = (row * px + column) * 4
      image.data[index] = (color >> 16) & 255
      image.data[index + 1] = (color >> 8) & 255
      image.data[index + 2] = color & 255
      image.data[index + 3] = mask * 255
    }
  }

  ctx.putImageData(image, 0, 0)
}

function clip(ctx: CanvasRenderingContext2D, px: number) {
  const image = ctx.getImageData(0, 0, px, px)

  for (let row = 0; row < px; row++)
    for (let column = 0; column < px; column++)
      image.data[(row * px + column) * 4 + 3] *= tileMask((column + 0.5) / px, (row + 0.5) / px, px)

  ctx.putImageData(image, 0, 0)
}
