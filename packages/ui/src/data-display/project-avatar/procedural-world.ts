// Project icon styles of the world: landscapes and materials, creatures, small objects and emblems. See procedural.ts
// for the contract.

import { mulberry32 } from "./generated"
import {
  clamp01,
  colors,
  css,
  dither,
  fbm,
  grain,
  int,
  legible,
  luma,
  mix,
  palette,
  pick,
  Pixels,
  prefixed,
  range,
  retry,
  seed,
  shade,
  smoothstep,
  stars,
  tint,
  type Definition,
} from "./procedural-kit"

// Sky top, sky bottom, sun, far, mid, near, snow.
const RANGES = [
  [0x3b2c5a, 0xf2a7a0, 0xfff1c9, 0x9b7fa6, 0x6a5482, 0x3b2f52, 0xfde6e0],
  [0x4b9be0, 0xcde9f7, 0xfffbe0, 0x8fb3cf, 0x5d7f9b, 0x34505f, 0xffffff],
  [0x1f1d3d, 0xe2725b, 0xffd27a, 0x8a4a62, 0x55304f, 0x2a1b33, 0xf3d2c8],
  [0x0a1028, 0x24305e, 0xeeeedd, 0x2c3a66, 0x1d2850, 0x111833, 0xc9d3ea],
  [0x6fb7e9, 0xe3f3fb, 0xffffff, 0xa4c3d6, 0x5f8f74, 0x2f5a41, 0xffffff],
  [0xe9b872, 0xfbe3b8, 0xfff7e0, 0xd08c5b, 0xa65f3d, 0x6e3b2a, 0xf7d9b0],
]

// Sky, deep, mid, light, foam, sun.
const SEAS = [
  [0xf6e7c8, 0x0b3954, 0x087e8b, 0x5fb4c8, 0xf4f1ea, 0xe63946],
  [0x9aa5ad, 0x1f2d3a, 0x3d5566, 0x7d94a3, 0xe8eef2, 0xd9dde0],
  [0x9be3f0, 0x006d77, 0x1aa6b7, 0x83e3dc, 0xffffff, 0xffd166],
  [0x0b1030, 0x0a1a3a, 0x16336b, 0x3a62a8, 0xd6e4ff, 0xf0f0d0],
  [0xf6a26b, 0x2d1e4f, 0x5b4b8a, 0xb07cc6, 0xffe0c2, 0xffd166],
]

// Low edge, high edge of the curtains.
const AURORAS = [
  [0x5cffb0, 0xd36bff],
  [0x6dffa8, 0x3ad6ff],
  [0x7dff8a, 0xff5f8f],
  [0x6fe3ff, 0x8a7dff],
  [0xb6ff6e, 0x5cffd0],
]

const NIGHTS = [0x070b1c, 0x0b1026, 0x0d0a1f, 0x06141a]

// Base, vein, clouding.
const MARBLES = [
  [0xeceae6, 0x7d838b, 0xd2d4d8],
  [0x16171a, 0xe8e6e1, 0x34353a],
  [0x1f4a3a, 0xe3efe6, 0x2f6b55],
  [0x8c2a24, 0xf0d9c8, 0xa8473d],
  [0xf3efe6, 0xb08d57, 0xddd2bd],
  [0x24476b, 0xdbe7f2, 0x3d6a94],
  [0xe8c4c0, 0x7a4a4a, 0xd4a5a0],
]

// Early wood, late wood.
const WOODS = [
  [0xc89f6b, 0x8f6638],
  [0x6b4a32, 0x3a2618],
  [0xb8643f, 0x82391f],
  [0xe8cfa0, 0xc4a06a],
  [0x3a2e27, 0x14100c],
  [0xe6c48d, 0xb07e42],
  [0xbdb3a3, 0x7f7464],
]

// Liquid top, liquid bottom, wax.
const LAMPS = [
  [0x3a0ca3, 0xff006e, 0xffbe0b],
  [0x0b3954, 0x087e8b, 0xff5a5f],
  [0x10451d, 0x4c956c, 0xf77f00],
  [0x1d1d3a, 0x5b4b8a, 0x5cffb0],
  [0x5f0f40, 0x9a031e, 0xfff3b0],
  [0x111111, 0x3a3a3a, 0xff3b3b],
  [0x14213d, 0x2a9d8f, 0xffd6e0],
]

const METALS = [0xb8c2cc, 0x8f9ba8, 0xd9a441, 0x6c9ab8, 0xe07a5f, 0x81b29a, 0xf2cc8f]

const GLOWS = [0x6fe3ff, 0xff5f5f, 0x39ff7a, 0xffd166, 0xff6fd8]

const SLIMES = [0x7bd389, 0x5fa8ff, 0xff7eb6, 0xffd166, 0xb388ff, 0xff8a5c, 0x5ce1e6]

const PASTELS = [0xf6efe4, 0xe8f1f2, 0xf3e8f5, 0xfdf1d8, 0xe6f2e1, 0x2b2738, 0x1f2a36]

const SHEETS = [0xf4f4f8, 0xdff4ff, 0xffe3f1, 0xe8ffe0, 0xfff3c4]

const HAUNTS = [0x1b1830, 0x0f1b2d, 0x2a1b3d, 0x14231c, 0x241a14]

const FURS = [0xe8964a, 0x8d929b, 0x2b2b30, 0xf0e2c4, 0x8a5a3b, 0xf4f1ea, 0xc9a06a]

const IRISES = [0x8bc34a, 0xffc93c, 0x6fb7ff, 0xf28c28, 0x5ce1e6]

const POTIONS = [0xff4d6d, 0x5cffb0, 0x6fa8ff, 0xb388ff, 0xffd166, 0xff8c42, 0x5ce1e6]

const GEMS = [0xe0115f, 0x2457c5, 0x13a35a, 0x9b5de5, 0xffb627, 0x5ce1e6, 0xdfe9f5, 0xff6f91]

const VELVETS = [0x1a1a2e, 0x2a0f1a, 0x0f2a24, 0x241b0f, 0xf3eee6]

// Sky top, sky bottom, ground, light.
const DAYS = [
  [0x7ec8f2, 0xd9f1ff, 0x6aa84f, 0xfff3b0],
  [0x2b1b4a, 0xf28c5a, 0x3a5a40, 0xffe08a],
  [0x0b1030, 0x2a3a7a, 0x1e3a2b, 0xf0f0d0],
  [0xb8d8e8, 0xeef6fa, 0xf4f8fb, 0xffffff],
  [0xf2c6a0, 0xfde9d2, 0xd9b26f, 0xfff4dc],
]

const WALLS = [0xf4efe6, 0xe9c46a, 0xe07a5f, 0x81b29a, 0x9ec1e0, 0xc9ada7, 0xffffff, 0x3d405b]

const ROOFS = [0xb23a48, 0x3d405b, 0x6b4423, 0x264653, 0x2f2f2f, 0x8a3324, 0x2a9d8f]

// Pips on a 3 × 3 lattice for faces one to six.
const PIPS = [
  [4],
  [0, 8],
  [0, 4, 8],
  [0, 2, 6, 8],
  [0, 2, 4, 6, 8],
  [0, 2, 3, 5, 6, 8],
]

// Body, pip.
const DICE = [
  [0xf6f3ec, 0x1a1a1a],
  [0xc8102e, 0xffffff],
  [0x1a1a1a, 0xf6f3ec],
  [0x1d5fbf, 0xffffff],
  [0xf2e3c4, 0x8a1c1c],
  [0x2a9d8f, 0xffffff],
]

const FELTS = [0x1f6b45, 0x7a4a2a, 0x1d2b4f, 0x5c1f2b, 0x2b2b2b]

const METAL_TINCTURES = [0xf2c230, 0xeeeeee]

const COLOUR_TINCTURES = [0xc8102e, 0x1f4fa0, 0x1e7a46, 0x1a1a1a, 0x6b3fa0]

// Sky top, sky bottom, line, star.
const CHARTS = [
  [0x0b1030, 0x1f2a5a, 0x9fb3ff, 0xfff6e0],
  [0x10061f, 0x3a1550, 0xd5a6ff, 0xffffff],
  [0x04141c, 0x0d3b4a, 0x7fe0d6, 0xeaffff],
  [0xf1e6cc, 0xe3d3ad, 0x8a5a2b, 0x3a2410],
]

// Ground, dark half, light half, accent.
const ROSES = [
  [0xf1e6cc, 0x1d3557, 0xf4efe6, 0xc8102e],
  [0x14213d, 0xb08d57, 0xf2d9a0, 0xe63946],
  [0xf5f5f0, 0x1a1a1a, 0xffffff, 0x1a1a1a],
  [0x0f3d3e, 0x2a9d8f, 0xe9f5f2, 0xf4a261],
  [0x3d2b1f, 0x8a5a2b, 0xe9d3a8, 0xf2c230],
]

// Stone, mark, glows.
const TABLETS = [
  [0x3b4048, 0x1e2126, 0],
  [0xc2a27a, 0x6e5434, 0],
  [0x6b4a32, 0x2e1d12, 0],
  [0xe9dcc0, 0x8a3324, 0],
  [0x101420, 0x6fe3ff, 1],
  [0x1a1010, 0xff8c42, 1],
]

const NATURE: Definition[] = [
  {
    id: "mountains",
    name: "Mountains",
    family: "Nature and materials",
    label: "Three ranges of jagged peaks with snowcaps, a sun or moon, and sometimes a lake",
    resolve: (random) => {
      const r = random("mountains")

      const peaks = (prefix: string, count: number, low: number, high: number, slope: number) =>
        Object.fromEntries(
          Array.from({ length: count }, (_, i) => [
            [`${prefix}x${i}`, range(r, -2, 18)],
            [`${prefix}h${i}`, range(r, low, high)],
            [`${prefix}s${i}`, slope * range(r, 0.8, 1.3)],
          ]).flat(),
        )

      return {
        grid: 16,
        ...prefixed("m", pick(r, RANGES)),
        sunX: range(r, 2, 14),
        sunY: range(r, 2, 6),
        lake: r() < 0.35 ? 1 : 0,
        ...peaks("a", 3, 9, 14, 1.2),
        ...peaks("b", 3, 6, 9, 0.9),
        ...peaks("c", 2, 3, 5, 0.55),
      }
    },
    paint: (pixels, p) => {
      const [top, bottom, sun, far, middle, near, snow] = colors(p, "m", 7)
      const sky = [top, mix(top, bottom, 0.5), bottom]
      const base = p.lake ? 13 : 16

      const ridge = (prefix: string, count: number, x: number) =>
        Math.max(
          ...Array.from({ length: count }, (_, i) => p[`${prefix}h${i}`] - Math.abs(x + 0.5 - p[`${prefix}x${i}`]) * p[`${prefix}s${i}`]),
        ) - (16 - base)

      const scene = (x: number, y: number) => {
        const height = base - y
        const c = ridge("c", 2, x)

        if (height <= c) return near
        const b = ridge("b", 3, x)

        if (height <= b) return b - height < 1 ? tint(middle, 0.12) : middle
        const a = ridge("a", 3, x)

        if (height <= a) return a - height < 1.6 + ((x * 7) % 3) * 0.4 && a > 7 ? snow : far

        if (Math.hypot(x + 0.5 - p.sunX, y + 0.5 - p.sunY) < 2.1) return sun

        return sky[dither(y / 10, 3, x, y)]
      }

      pixels.each((x, y) => {
        if (y < base) return scene(x, y)
        const mirrored = scene(x, base * 2 - y - 1)

        return y % 2 && x % 4 === y % 4 ? tint(mirrored, 0.25) : shade(mix(mirrored, bottom, 0.25), 0.82)
      })
    },
  },
  {
    id: "waves",
    name: "Waves",
    family: "Nature and materials",
    label: "Stacked ocean swells with foam crests under a strip of sky; they roll on hover",
    animated: true,
    resolve: (random) => {
      const r = random("waves")

      return {
        grid: 16,
        ...prefixed("w", pick(r, SEAS)),
        horizon: int(r, 3, 6),
        bands: int(r, 3, 4),
        amplitude: range(r, 0.8, 2),
        frequency: range(r, 0.45, 0.9),
        phase: r() * 6.28,
        sun: r() < 0.6 ? 1 : 0,
        sunX: range(r, 3, 13),
      }
    },
    paint: (pixels, p, t) => {
      const [sky, deep, middle, light, foam, sun] = colors(p, "w", 6)
      const tones = [light, middle, mix(middle, deep, 0.5), deep]

      pixels.each((x, y) => {
        const crests = Array.from({ length: p.bands }, (_, k) => {
          const spacing = (16 - p.horizon) / p.bands
          const swell = p.amplitude * (0.6 + k * 0.25)
          const curve = p.horizon + k * spacing + swell * Math.sin(x * p.frequency + p.phase + k * 1.9 + t * (1.5 + k * 0.4))

          return curve
        })
        const band = crests.findLastIndex((curve) => y + 0.5 >= curve)

        if (band < 0) {
          if (p.sun && Math.hypot(x + 0.5 - p.sunX, y + 0.5 - (p.horizon - 0.5)) < 2.4) return sun

          return y === p.horizon - 1 ? mix(sky, light, 0.4) : sky
        }

        if (y + 0.5 - crests[band] < 1) return foam

        if (y + 0.5 - crests[band] < 2 && (x + band) % 3 === 0) return mix(foam, tones[band], 0.5)

        return tones[Math.min(3, band + (4 - p.bands))]
      })
    },
  },
  {
    id: "aurora",
    name: "Aurora",
    family: "Nature and materials",
    label: "Rayed aurora curtains over pines, snowy hills or a still lake; they ripple on hover",
    animated: true,
    resolve: (random) => {
      const r = random("aurora")
      const [low, high] = pick(r, AURORAS)

      return {
        grid: 16,
        seed: seed(r),
        night: pick(r, NIGHTS),
        low,
        high,
        ribbons: r() < 0.4 ? 2 : 1,
        base: range(r, 7, 10),
        amplitude: range(r, 1, 3),
        frequency: range(r, 0.25, 0.6),
        phase: r() * 6.28,
        length: range(r, 4, 7),
        ground: int(r, 0, 2),
      }
    },
    paint: (pixels, p, t) => {
      pixels.fill(p.night)
      stars(pixels, mulberry32(p.seed), p.night, 6)
      const rand = mulberry32(p.seed + 1)
      const pines = Array.from({ length: 5 }, () => ({ x: rand() * 16, h: 3 + rand() * 3 }))

      const glow = (x: number, y: number) =>
        Math.max(
          ...Array.from({ length: p.ribbons }, (_, k) => {
            const edge =
              p.base - k * 3 + p.amplitude * Math.sin(x * p.frequency + p.phase + k * 2.1 + t * 1.3)
            const above = edge - (y + 0.5)

            if (above < -0.5 || above > p.length) return 0
            const rays = 0.65 + 0.35 * Math.sin(x * 2.3 + p.phase * 3 + k + t * 4)

            return (1 - above / p.length) * rays
          }),
        )

      pixels.each((x, y) => {
        const ground = [
          () => pines.some((pine) => 13 - y < pine.h - Math.abs(x + 0.5 - pine.x) * 1.6) || y >= 14,
          () => y >= 13 - Math.sin(x * 0.5 + p.phase) * 1.2,
          () => y >= 13,
        ][p.ground]()

        if (ground && p.ground === 2) return mix(p.night, mix(p.low, p.high, 0.3), glow(x, 26 - y) * 0.35)

        if (ground) return p.ground === 1 ? mix(0xdfe9f5, p.night, 0.55) : mix(p.night, 0x000000, 0.4)
        const k = glow(x, y)

        if (k <= 0) return undefined
        const level = dither(k * 1.35, 4, x, y)

        return level ? mix(p.night, mix(p.low, p.high, clamp01((p.base - y) / p.length)), level / 3) : undefined
      })
    },
  },
  {
    id: "marble",
    name: "Marble",
    family: "Nature and materials",
    label: "Domain-warped veins through Carrara, Nero, Verde, Rosso, Calacatta and other stones",
    resolve: (random) => {
      const r = random("marble")

      return {
        grid: 32,
        ...prefixed("m", pick(r, MARBLES)),
        angle: r() * Math.PI,
        frequency: range(r, 0.15, 0.32),
        warp: range(r, 2.5, 5.5),
        width: range(r, 0.06, 0.16),
        seedX: r() * 40,
        seedY: r() * 40,
      }
    },
    paint: (pixels, p) => {
      const [base, vein, cloud] = colors(p, "m", 3)

      pixels.each((x, y) => {
        const qx = fbm(x * 0.07 + p.seedX, y * 0.07 + p.seedY)
        const qy = fbm(x * 0.07 + p.seedY + 3.1, y * 0.07 + p.seedX + 1.7)
        const w = fbm(x * 0.06 + qx * 2.5 + p.seedX, y * 0.06 + qy * 2.5 + p.seedY)
        const along = (x * Math.cos(p.angle) + y * Math.sin(p.angle)) * p.frequency
        const main = Math.abs(Math.sin(along + w * p.warp))
        const fine = Math.abs(Math.sin(along * 2.7 + w * p.warp * 1.8 + 1.3))
        const stone = mix(base, cloud, smoothstep(0.35, 0.75, qx))
        const veined = mix(stone, vein, 1 - smoothstep(0, p.width, main))

        return mix(veined, vein, (1 - smoothstep(0, p.width * 0.35, fine)) * 0.45)
      })
    },
  },
  {
    id: "wood",
    name: "Wood grain",
    family: "Nature and materials",
    label: "End grain, flat-sawn cathedrals or quartersawn stripes in oak, walnut, cherry and more",
    resolve: (random) => {
      const r = random("wood")

      return {
        grid: 32,
        ...prefixed("w", pick(r, WOODS)),
        cut: int(r, 0, 2),
        cx: range(r, -8, 40),
        cy: range(r, -8, 40),
        density: range(r, 0.18, 0.4),
        knot: r() < 0.4 ? 1 : 0,
        kx: range(r, 8, 24),
        ky: range(r, 8, 24),
        seedX: r() * 40,
        seedY: r() * 40,
      }
    },
    paint: (pixels, p) => {
      const [early, late] = colors(p, "w", 2)

      pixels.each((x, y) => {
        const n = fbm(x * 0.08 + p.seedX, y * 0.08 + p.seedY)
        const knot = p.knot && p.cut === 1 ? 6 / (1 + Math.hypot(x - p.kx, (y - p.ky) * 0.6)) : 0

        const distance = [
          Math.hypot(x - p.cx, y - p.cy),
          Math.hypot((x - 16) * 0.22, y - p.cy - 40) + knot * 3,
          x + n * 4,
        ][p.cut]

        const ring = (((distance * p.density + n * 0.9) % 1) + 1) % 1
        const wood = mix(early, late, smoothstep(0.55, 0.95, ring))
        const ray = p.cut === 2 && grain(Math.floor(x / 3), y, 3) > 0.93 ? 0.35 : 0
        const check = p.cut === 0 && Math.abs(Math.sin(Math.atan2(y - p.cy, x - p.cx) * 3 + p.seedX)) < 0.03

        return check ? shade(late, 0.6) : shade(mix(wood, tint(early, 0.3), ray), grain(x, y, 1) < 0.15 ? 0.92 : 1)
      })
    },
  },
  {
    id: "lava",
    name: "Lava lamp",
    family: "Nature and materials",
    label: "A tapered lamp of metaball wax in a dithered liquid, on a chrome, brass or black base; the wax rises on hover",
    animated: true,
    resolve: (random) => {
      const r = random("lava")
      const all = colors(palette(random("palette")))

      return {
        grid: 16,
        seed: seed(r),
        count: int(r, 3, 4),
        ...prefixed("l", pick(r, LAMPS)),
        metal: pick(r, [0xb8bec6, 0xd4af37, 0x2e2e33, 0xc8743a]),
        ground: r() < 0.65 ? pick(r, [0x14121f, 0x0f1418, 0x1c1414, 0x101a1a]) : all[0],
        belly: range(r, 3.2, 4.2),
      }
    },
    paint: (pixels, p, t) => {
      const [top, bottom, wax] = colors(p, "l", 3)
      const rand = mulberry32(p.seed)
      const half = (y: number) => (y < 2 || y > 11 ? 0 : 1.2 + (p.belly - 1.2) * Math.sin((Math.PI * (y - 1.5)) / 11) ** 0.8)
      const glass = (x: number, y: number) => Math.abs(x + 0.5 - 8) < half(y)
      const dark = luma(p.ground) < 0.3

      const blobs = Array.from({ length: p.count }, () => {
        const speed = 0.6 + rand() * 1
        const phase = rand() * 6.28

        return { x: 7 + rand() * 2, y: 7 + Math.sin(phase + t * speed) * 3.5, r: 0.9 + rand() * 0.8 }
      })

      pixels.each((x, y) => {
        if (glass(x, y)) {
          const field = blobs.reduce((sum, blob) => sum + (blob.r * blob.r) / ((x + 0.5 - blob.x) ** 2 + (y + 0.5 - blob.y) ** 2 + 0.01), 0)

          if (field > 1) return field > 3 ? tint(wax, 0.3) : wax

          return [top, mix(top, bottom, 0.5), bottom][dither((y - 2) / 9, 3, x, y)]
        }

        if (y <= 1 && y >= 0 && Math.abs(x + 0.5 - 8) < 1.6 + y * 0.4) return y === 0 ? shade(p.metal, 0.8) : p.metal

        if (y >= 12 && y <= 14 && Math.abs(x + 0.5 - 8) < 1.6 + (y - 12) * 0.9) return y === 12 ? tint(p.metal, 0.25) : y === 14 ? shade(p.metal, 0.7) : p.metal

        const near = [-1, 1].some((d) => glass(x + d, y) || glass(x + d * 2, y))

        return dark && near ? mix(p.ground, wax, 0.18) : p.ground
      })
    },
  },
]

const CREATURES: Definition[] = [
  {
    id: "robot",
    name: "Robot",
    family: "Creatures",
    label: "A boxy robot head with its own eyes, mouth and antenna; it blinks and beeps on hover",
    animated: true,
    resolve: (random) => {
      const r = random("robot")
      const all = colors(palette(random("palette")))
      const body = r() < 0.6 ? pick(r, METALS) : pick(r, all.slice(1))

      return {
        grid: 16,
        body,
        ground: luma(body) > 0.5 ? mix(0x1a1c22, body, 0.12) : mix(all[0], body, 0.1),
        glow: pick(r, GLOWS),
        width: pick(r, [8, 10, 10, 12]),
        height: int(r, 6, 8),
        round: r() < 0.5 ? 1 : 0,
        eyes: int(r, 0, 3),
        mouth: int(r, 0, 3),
        antenna: int(r, 0, 3),
        ears: r() < 0.5 ? 1 : 0,
      }
    },
    paint: (pixels, p, t) => {
      const x0 = (16 - p.width) / 2
      const y0 = 13 - p.height - 2
      const dark = shade(p.body, 0.55)
      const blink = t % 1.8 > 1.6
      const beep = t > 0 && Math.floor(t * 3) % 2 === 0
      pixels.fill(p.ground)
      pixels.rect(5, y0 + p.height, 6, 1, dark)
      pixels.rect(2, y0 + p.height + 1, 12, 4, shade(p.body, 0.8))
      pixels.rect(2, y0 + p.height + 1, 12, 1, p.body)
      pixels.rect(x0, y0, p.width, p.height, p.body)
      pixels.rect(x0, y0 + p.height - 1, p.width, 1, shade(p.body, 0.8))
      pixels.rect(x0, y0, p.width, 1, tint(p.body, 0.3))

      if (p.round) {
        ;[
          [x0, y0],
          [x0 + p.width - 1, y0],
          [x0, y0 + p.height - 1],
          [x0 + p.width - 1, y0 + p.height - 1],
        ].forEach(([x, y]) => pixels.set(x, y, p.ground))
      }

      if (p.ears) {
        pixels.rect(x0 - 1, y0 + 2, 1, 2, dark)
        pixels.rect(x0 + p.width, y0 + 2, 1, 2, dark)
      }

      const eye = blink ? dark : p.glow
      const eyeY = y0 + 2
      const eyes = [
        () => {
          pixels.rect(x0 + 1, eyeY, 2, 2, eye)
          pixels.rect(x0 + p.width - 3, eyeY, 2, 2, eye)
        },
        () => {
          pixels.rect(x0 + 1, eyeY, p.width - 2, 2, shade(p.body, 0.3))
          pixels.rect(x0 + 2 + (beep ? 1 : 0), eyeY, 2, 1, eye)
          pixels.rect(x0 + p.width - 4 - (beep ? 1 : 0), eyeY, 2, 1, eye)
        },
        () => {
          pixels.rect(7, eyeY - 1, 2, 3, eye)
          pixels.rect(6, eyeY, 4, 1, eye)
        },
        () => {
          pixels.set(x0 + 2, eyeY, eye)
          pixels.set(x0 + p.width - 3, eyeY, eye)
          pixels.set(x0 + 1, eyeY + 1, eye)
          pixels.set(x0 + 3, eyeY + 1, eye)
          pixels.set(x0 + p.width - 4, eyeY + 1, eye)
          pixels.set(x0 + p.width - 2, eyeY + 1, eye)
        },
      ]

      eyes[p.eyes]()
      const mouthY = y0 + p.height - 2
      const mouths = [
        () => Array.from({ length: p.width - 4 }, (_, i) => i % 2 === 0 && pixels.set(x0 + 2 + i, mouthY, dark)),
        () => pixels.rect(x0 + 3, mouthY, p.width - 6, 1, dark),
        () => {
          pixels.rect(x0 + 2, mouthY, p.width - 4, 1, 0xf4f1ea)
          Array.from({ length: p.width - 4 }, (_, i) => i % 2 && pixels.set(x0 + 2 + i, mouthY, dark))
        },
        () => pixels.rect(7, mouthY, 2, 1, beep ? p.glow : dark),
      ]

      mouths[p.mouth]()
      const tip = beep ? tint(p.glow, 0.5) : p.glow
      const antennas = [
        () => pixels.rect(x0 + 1, y0 - 1, p.width - 2, 1, dark),
        () => {
          pixels.rect(7, y0 - 2, 1, 2, dark)
          pixels.rect(7, y0 - 3, 2, 1, tip)
        },
        () => {
          pixels.rect(x0 + 1, y0 - 2, 1, 2, dark)
          pixels.rect(x0 + p.width - 2, y0 - 2, 1, 2, dark)
          pixels.set(x0 + 1, y0 - 3, tip)
          pixels.set(x0 + p.width - 2, y0 - 3, tip)
        },
        () => {
          pixels.set(8, y0 - 1, dark)
          pixels.set(7, y0 - 2, dark)
          pixels.set(8, y0 - 3, tip)
        },
      ]

      antennas[p.antenna]()
    },
  },
  {
    id: "slime",
    name: "Slime",
    family: "Creatures",
    label: "A glossy dome of slime with a face and a sprout, crown or bubble; it squashes on hover",
    animated: true,
    resolve: (random) => {
      const r = random("slime")

      return {
        grid: 16,
        body: pick(r, SLIMES),
        ground: pick(r, PASTELS),
        width: range(r, 10, 14),
        height: range(r, 7, 10),
        eyes: int(r, 0, 2),
        mouth: int(r, 0, 2),
        hat: int(r, 0, 3),
        drip: int(r, 3, 12),
      }
    },
    paint: (pixels, p, t) => {
      const squash = Math.sin(t * 6) * 0.12 * Math.min(1, t * 3)
      const w = p.width * (1 + squash) * 0.5
      const h = p.height * (1 - squash)
      const base = 13
      const top = Math.round(base - h)
      const inside = (x: number, y: number) => y < base && ((x + 0.5 - 8) / w) ** 2 + ((y + 0.5 - base) / h) ** 2 < 1
      const outline = shade(p.body, 0.6)
      pixels.fill(p.ground)
      pixels.rect(Math.round(8 - w), base, Math.round(w * 2), 1, mix(p.ground, 0x000000, 0.18))
      pixels.each((x, y) => {
        if (inside(x, y)) return inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) ? p.body : outline

        return undefined
      })
      pixels.set(p.drip, base, outline)
      pixels.set(Math.round(8 - w * 0.55), top + 2, tint(p.body, 0.75))
      pixels.set(Math.round(8 - w * 0.55) + 1, top + 1, tint(p.body, 0.6))
      const eyeY = Math.round(base - h * 0.45)
      const ink = 0x1a1a24
      const faces = [
        () => {
          pixels.rect(5, eyeY, 1, 2, ink)
          pixels.rect(10, eyeY, 1, 2, ink)
        },
        () => {
          pixels.rect(4, eyeY, 2, 2, ink)
          pixels.rect(10, eyeY, 2, 2, ink)
          pixels.set(4, eyeY, 0xffffff)
          pixels.set(10, eyeY, 0xffffff)
        },
        () => {
          ;[4, 10].forEach((x) => {
            pixels.set(x, eyeY + 1, ink)
            pixels.set(x + 1, eyeY, ink)
            pixels.set(x + 2, eyeY + 1, ink)
          })
        },
      ]

      faces[p.eyes]()
      const mouths = [
        () => {
          pixels.set(7, eyeY + 2, ink)
          pixels.set(8, eyeY + 2, ink)
        },
        () => {
          pixels.set(6, eyeY + 2, ink)
          pixels.set(7, eyeY + 3, ink)
          pixels.set(8, eyeY + 2, ink)
          pixels.set(9, eyeY + 3, ink)
        },
        () => {
          pixels.set(3, eyeY + 2, 0xff8fab)
          pixels.set(12, eyeY + 2, 0xff8fab)
        },
      ]

      mouths[p.mouth]()
      const hats = [
        () => undefined,
        () => {
          pixels.set(8, top - 1, 0x4c956c)
          pixels.set(9, top - 2, 0x6fcf6f)
          pixels.set(7, top - 2, 0x6fcf6f)
        },
        () => {
          pixels.rect(6, top - 1, 4, 1, 0xf2c230)
          pixels.set(6, top - 2, 0xf2c230)
          pixels.set(8, top - 2, 0xf2c230)
          pixels.set(9, top - 2, 0xf2c230)
        },
        () => {
          pixels.set(11, base - 3, tint(p.body, 0.5))
          pixels.set(10, base - 2, tint(p.body, 0.3))
        },
      ]

      hats[p.hat]()
    },
  },
  {
    id: "ghost",
    name: "Ghost",
    family: "Creatures",
    label: "A sheet ghost with a wavy hem and a mood of its own; it floats on hover",
    animated: true,
    resolve: (random) => {
      const r = random("ghost")

      return {
        grid: 16,
        sheet: pick(r, SHEETS),
        ground: pick(r, HAUNTS),
        width: pick(r, [5, 5.5, 6]),
        period: pick(r, [3, 4]),
        eyes: int(r, 0, 3),
        mouth: int(r, 0, 2),
        arms: r() < 0.5 ? 1 : 0,
        lean: range(r, -0.15, 0.15),
        blush: r() < 0.4 ? 1 : 0,
      }
    },
    paint: (pixels, p, t) => {
      const bob = Math.round(Math.sin(t * 3) * 1)
      const cy = 6.5 + bob
      const hem = 13 + bob
      const shadowed = shade(p.sheet, 0.78)

      const inside = (x: number, y: number) => {
        const X = x + 0.5 - 8 - (y - 8) * p.lean
        const Y = y + 0.5
        const wave = Math.abs((((x + Math.floor(t * 6)) % p.period) + p.period) % p.period - p.period / 2) * 0.8

        if (Y < cy) return Math.hypot(X, Y - cy) < p.width

        return Math.abs(X) < p.width && Y < hem + 1 - wave
      }

      pixels.fill(p.ground)
      pixels.each((x, y) => {
        if (y === 14 && Math.abs(x + 0.5 - 8) < p.width - 1) return mix(p.ground, 0x000000, 0.3)

        if (!inside(x, y)) return undefined

        return inside(x + 1, y) ? p.sheet : shadowed
      })

      if (p.arms) {
        pixels.set(Math.round(8 - p.width) - 1, 9 + bob, p.sheet)
        pixels.set(Math.round(8 + p.width), 9 + bob, shadowed)
      }

      const ink = 0x1a1626
      const ey = 5 + bob
      const eyes = [
        () => {
          pixels.rect(5, ey, 2, 3, ink)
          pixels.rect(9, ey, 2, 3, ink)
        },
        () => {
          pixels.set(6, ey + 1, ink)
          pixels.set(9, ey + 1, ink)
        },
        () => {
          ;[5, 9].forEach((x) => {
            pixels.set(x, ey + 1, ink)
            pixels.set(x + 1, ey, ink)
            pixels.set(x + 2, ey + 1, ink)
          })
        },
        () => {
          pixels.rect(5, ey, 2, 2, p.ground)
          pixels.rect(9, ey, 2, 2, p.ground)
        },
      ]

      eyes[p.eyes]()
      const mouths = [
        () => undefined,
        () => pixels.rect(7, ey + 4, 2, 2, ink),
        () => {
          pixels.set(6, ey + 4, ink)
          pixels.set(7, ey + 5, ink)
          pixels.set(8, ey + 4, ink)
          pixels.set(9, ey + 5, ink)
        },
      ]

      mouths[p.mouth]()

      if (p.blush) {
        pixels.set(4, ey + 3, 0xff9eb5)
        pixels.set(11, ey + 3, 0xff9eb5)
      }
    },
  },
  {
    id: "cat",
    name: "Cat",
    family: "Creatures",
    label: "A cat's face in solid, tabby, tuxedo, calico or point coats, with slit eyes; it blinks on hover",
    animated: true,
    resolve: (random) => {
      const r = random("cat")
      const all = colors(palette(random("palette")))
      const fur = pick(r, FURS)

      return {
        grid: 16,
        fur,
        ground: legible(r, all, fur),
        coat: int(r, 0, 4),
        iris: pick(r, IRISES),
        ears: int(r, 3, 4),
        width: pick(r, [6, 6.5, 7]),
      }
    },
    paint: (pixels, p, t) => {
      const dark = luma(p.fur) < 0.25 ? tint(p.fur, 0.25) : shade(p.fur, 0.62)
      const white = 0xf6f3ec
      const blink = t % 2.4 > 2.2
      const inHead = (x: number, y: number) => ((x + 0.5 - 8) / p.width) ** 2 + ((y + 0.5 - 10) / 5) ** 2 < 1

      const inEar = (x: number, y: number) =>
        [3.5, 12.5].some((ex) => y >= 6 - p.ears && y <= 6 && Math.abs(x + 0.5 - ex) <= ((y - (6 - p.ears)) / p.ears) * 2.2)

      const coat = (x: number, y: number) => {
        const coats = [
          () => p.fur,
          () => ((y === 6 || y === 8) && x >= 6 && x <= 9 && x % 2 === 0) || ((x <= 3 || x >= 12) && y % 2 === 1) ? dark : p.fur,
          () => (y >= 11 && x >= 5 && x <= 10) || (y >= 9 && x >= 7 && x <= 8) ? white : p.fur,
          () => (x < 7 && y < 9 ? 0xe8964a : x > 9 && y > 9 ? 0x2b2b30 : white),
          () => (Math.hypot(x + 0.5 - 8, y + 0.5 - 11) < 3 ? shade(0x5a4030, 1) : 0xf0e2c4),
        ]

        return coats[p.coat]()
      }

      pixels.fill(p.ground)
      pixels.each((x, y) => {
        if (inEar(x, y)) {
          const pink = Math.abs(x + 0.5 - (x < 8 ? 3.5 : 12.5)) < 0.8 && y > 6 - p.ears + 1

          return pink ? 0xf2a7b8 : p.coat === 4 ? 0x5a4030 : coat(x, 7)
        }

        return inHead(x, y) ? coat(x, y) : undefined
      })

      const eyeY = 9
      ;[5, 9].forEach((x) => {
        if (blink) return pixels.rect(x, eyeY + 1, 2, 1, shade(p.fur, 0.4))
        pixels.rect(x, eyeY, 2, 2, p.iris)
        pixels.rect(x + (x < 8 ? 1 : 0), eyeY, 1, 2, 0x161616)
      })
      pixels.rect(7, 12, 2, 1, 0xf28fa3)
      pixels.set(7, 13, shade(coat(7, 13), 0.6))
      pixels.set(8, 13, shade(coat(8, 13), 0.6))
      const whisker = luma(p.ground) > 0.5 ? shade(p.ground, 0.55) : tint(p.ground, 0.55)
      ;[0, 1, 14, 15].forEach((x) => {
        if (!inHead(x, 12)) pixels.set(x, 12, whisker)

        if (!inHead(x, 13) && (x === 1 || x === 14)) pixels.set(x, 13, whisker)
      })
    },
  },
]

const OBJECTS: Definition[] = [
  {
    id: "potion",
    name: "Potion",
    family: "Objects",
    label: "A round, conical, vial or square flask of glowing liquid with a cork; it bubbles on hover",
    animated: true,
    resolve: (random) => {
      const r = random("potion")
      const all = colors(palette(random("palette")))

      return {
        grid: 16,
        flask: int(r, 0, 3),
        liquid: pick(r, POTIONS),
        level: range(r, 0.35, 0.8),
        ground: r() < 0.6 ? pick(r, [0x1a1626, 0x14231f, 0x231a14, 0x161c2a]) : all[0],
        seed: seed(r),
      }
    },
    paint: (pixels, p, t) => {
      const flasks = [
        (x: number, y: number) => Math.hypot(x + 0.5 - 8, y + 0.5 - 10) < 4.6 || (y >= 2 && y <= 6 && x >= 7 && x <= 8),
        (x: number, y: number) => (y >= 2 && y <= 6 && x >= 7 && x <= 8) || (y > 6 && y <= 13 && Math.abs(x + 0.5 - 8) < 1 + (y - 6) * 0.75),
        (x: number, y: number) => y >= 2 && y <= 13 && x >= 6 && x <= 9 && !(y === 13 && (x === 6 || x === 9)),
        (x: number, y: number) =>
          (y >= 2 && y <= 4 && x >= 7 && x <= 8) || (y === 5 && x >= 5 && x <= 10) || (y >= 6 && y <= 13 && x >= 4 && x <= 11),
      ]

      const inside = flasks[p.flask]
      const rows = Array.from({ length: 16 }, (_, y) => y).filter((y) => Array.from({ length: 16 }, (_, x) => x).some((x) => inside(x, y)))
      const top = rows[0]
      const bottom = rows[rows.length - 1]
      const surface = Math.round(bottom - (bottom - top - 2) * p.level)
      const dark = luma(p.ground) < 0.3
      const glass = dark ? mix(p.ground, 0xffffff, 0.16) : mix(p.ground, 0x6a7a8a, 0.18)
      const rim = dark ? mix(p.ground, 0xffffff, 0.5) : shade(p.ground, 0.45)

      pixels.each((x, y) => {
        if (inside(x, y)) {
          if (y <= top) return 0x9c6b3e

          if (y < surface) return x === 6 || x === 7 ? mix(glass, 0xffffff, 0.2) : glass

          return y === surface ? tint(p.liquid, 0.35) : x <= 6 && y === surface + 1 ? tint(p.liquid, 0.2) : p.liquid
        }

        const edge = inside(x - 1, y) || inside(x + 1, y) || inside(x, y + 1)

        if (edge) return rim

        const near = [-2, -1, 1, 2].some((d) => inside(x + d, y) || inside(x, y + d))

        return dark && near && dither(0.4, 2, x, y) ? mix(p.ground, p.liquid, 0.22) : p.ground
      })

      const rand = mulberry32(p.seed)
      Array.from({ length: 3 }, () => {
        const x = 6 + Math.floor(rand() * 4)
        const span = bottom - surface - 1
        const y = bottom - 1 - Math.floor(((rand() * span + t * 6) % Math.max(1, span)))

        if (inside(x, y) && y > surface) pixels.set(x, y, tint(p.liquid, 0.6))
      })
    },
  },
  {
    id: "gem",
    name: "Gem",
    family: "Objects",
    label: "A faceted brilliant, emerald, cushion, trillion or marquise cut, lit from the top left",
    animated: true,
    resolve: (random) => {
      const r = random("gem")

      return {
        grid: 16,
        cut: int(r, 0, 4),
        stone: pick(r, GEMS),
        ground: pick(r, VELVETS),
        facets: pick(r, [6, 8, 8, 10]),
        turn: r() * Math.PI,
      }
    },
    paint: (pixels, p, t) => {
      const cuts = [
        (dx: number, dy: number) => Math.max(Math.abs(dx), Math.abs(dy), (Math.abs(dx) + Math.abs(dy)) / 1.35) < 6,
        (dx: number, dy: number) => Math.abs(dx) < 6.2 && Math.abs(dy) < 4.6 && Math.abs(dx) + Math.abs(dy) < 9,
        (dx: number, dy: number) => (dx / 6) ** 4 + (dy / 6) ** 4 < 1,
        (dx: number, dy: number) => dy > -4.5 && dy < 6 - Math.abs(dx) * 1.7 - 0.5 && Math.abs(dx) < 6.5,
        (dx: number, dy: number) => Math.hypot(dx - 4.5, dy) < 7.8 && Math.hypot(dx + 4.5, dy) < 7.8 && Math.abs(dy) < 6.4,
      ]

      const cut = cuts[p.cut]
      const flip = p.cut === 3 ? -1 : 1
      const [lx, ly] = [-0.6, -0.8]
      const dark = luma(p.ground) < 0.4

      pixels.each((x, y) => {
        const dx = x + 0.5 - 8
        const dy = (y + 0.5 - 8) * flip
        const rotated = p.cut === 4 ? [dx * Math.cos(p.turn * 0.3) - dy * Math.sin(p.turn * 0.3), dx * Math.sin(p.turn * 0.3) + dy * Math.cos(p.turn * 0.3)] : [dx, dy]

        if (!cut(rotated[0], rotated[1])) {
          const halo = dark && cut(rotated[0] * 0.8, rotated[1] * 0.8)

          return halo ? mix(p.ground, p.stone, 0.15) : p.ground
        }

        if (!cut(rotated[0] * 1.2, rotated[1] * 1.2)) return shade(p.stone, 0.45)

        if (cut(rotated[0] * 2.1, rotated[1] * 2.1)) return dx + dy < -1 ? tint(p.stone, 0.45) : tint(p.stone, 0.22)
        const sector = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * p.facets)
        const middle = ((sector + 0.5) / p.facets) * Math.PI * 2 - Math.PI
        const lit = Math.cos(middle) * lx + Math.sin(middle) * ly

        return lit > 0.35 ? tint(p.stone, 0.3) : lit > -0.3 ? p.stone : shade(p.stone, 0.68)
      })

      const glint = Math.floor(t * 2.5) % 3
      const spots = [
        [5, 5],
        [10, 6],
        [6, 10],
      ]
      const [sx, sy] = spots[t > 0 ? glint : 0]
      pixels.set(sx, sy, 0xffffff)
      pixels.set(sx - 1, sy, tint(p.stone, 0.7))
      pixels.set(sx + 1, sy, tint(p.stone, 0.7))
      pixels.set(sx, sy - 1, tint(p.stone, 0.7))
      pixels.set(sx, sy + 1, tint(p.stone, 0.7))
    },
  },
  {
    id: "house",
    name: "Tiny house",
    family: "Objects",
    label: "A little house with a gable, A-frame, flat, mansard or dome roof; its chimney smokes on hover",
    animated: true,
    resolve: (random) => {
      const r = random("house")
      const wall = pick(r, WALLS)

      return {
        grid: 16,
        ...prefixed("d", pick(r, DAYS)),
        wall,
        roofColor: pick(
          r,
          ROOFS.filter((roof) => Math.abs(luma(roof) - luma(wall)) > 0.15),
        ),
        width: pick(r, [8, 9, 10, 11]),
        height: int(r, 4, 5),
        x: int(r, 2, 4),
        roof: int(r, 0, 4),
        door: r(),
        chimney: r() < 0.6 ? 1 : 0,
        tree: r() < 0.5 ? 1 : 0,
        moonX: int(r, 2, 13),
      }
    },
    paint: (pixels, p, t) => {
      const [top, bottom, ground, light] = colors(p, "d", 4)
      const night = luma(top) < 0.2
      const sky = [top, mix(top, bottom, 0.5), bottom]
      const base = 13
      const x0 = Math.min(p.x, 15 - p.width)
      const x1 = x0 + p.width - 1
      const y0 = base - p.height
      const center = (x0 + x1) / 2
      const roofShade = shade(p.roofColor, 0.75)

      pixels.each((x, y) => (y >= base ? (y === base ? tint(ground, 0.12) : ground) : sky[dither(y / 12, 3, x, y)]))
      pixels.disc(p.moonX + 0.5, 2.5, 1.5, light)

      if (p.tree) {
        const tx = x1 + 2 < 15 ? x1 + 2 : x0 - 2
        pixels.rect(tx, base - 2, 1, 2, 0x6b4423)
        pixels.disc(tx + 0.5, base - 3.5, 1.8, night ? 0x1f3b2c : 0x3f7d3a)
      }

      const roofs = [
        () => {
          const peak = Math.ceil(p.width / 2)
          Array.from({ length: peak }, (_, k) => pixels.rect(x0 - 1 + k, y0 - 1 - k, p.width + 2 - k * 2, 1, k % 2 ? roofShade : p.roofColor))

          return y0 - peak
        },
        () => {
          pixels.each((x, y) => (y < base && y >= base - p.height - 5 && Math.abs(x + 0.5 - (center + 0.5)) < (y - (base - p.height - 6)) * 0.62 ? p.roofColor : undefined))

          return base - p.height - 5
        },
        () => {
          pixels.rect(x0 - 1, y0 - 1, p.width + 2, 1, p.roofColor)
          pixels.rect(x0, y0 - 2, 1, 1, p.roofColor)
          pixels.rect(x1, y0 - 2, 1, 1, p.roofColor)

          return y0 - 2
        },
        () => {
          pixels.rect(x0 - 1, y0 - 1, p.width + 2, 1, roofShade)
          pixels.rect(x0, y0 - 2, p.width, 1, p.roofColor)
          pixels.rect(x0 + 1, y0 - 3, p.width - 2, 1, p.roofColor)

          return y0 - 3
        },
        () => {
          pixels.disc(center + 0.5, y0, p.width / 2, p.roofColor)

          return y0 - Math.floor(p.width / 2)
        },
      ]

      if (p.roof !== 1) pixels.rect(x0, y0, p.width, p.height, p.wall)
      const roofTop = roofs[p.roof]()

      if (p.roof === 1) pixels.rect(Math.round(center) - 1, base - 3, 3, 3, p.wall)

      const window = night ? light : mix(top, 0xffffff, 0.5)
      const doorX = p.roof === 1 ? Math.round(center) : x0 + 1 + Math.floor(p.door * (p.width - 3))
      pixels.rect(doorX, base - 3, p.roof === 1 ? 1 : 2, 3, shade(p.roofColor, 0.6))

      if (p.roof !== 1) {
        ;[x0 + 1, x1 - 2].forEach((wx) => {
          if (Math.abs(wx - doorX) < 3) return
          pixels.rect(wx, y0 + 1, 2, 2, window)
        })
      }

      if (!p.chimney || p.roof === 1 || p.roof === 4) return
      const cx = x1 - 2
      pixels.rect(cx, roofTop, 1, Math.max(1, y0 - roofTop), shade(p.roofColor, 0.55))
      const puff = Math.floor(t * 3)
      ;[0, 1, 2].forEach((k) => pixels.set(cx + ((k + puff) % 2), roofTop - 1 - k - (t > 0 ? puff % 2 : 0), mix(sky[0], 0xffffff, 0.6 - k * 0.15)))
    },
  },
  {
    id: "lighthouse",
    name: "Lighthouse",
    family: "Objects",
    label: "A banded or spiral tower on a rock in the sea, by day or with a beam at night; the beam turns on hover",
    animated: true,
    resolve: (random) => {
      const r = random("lighthouse")

      return {
        grid: 16,
        ...prefixed("s", pick(r, SEAS)),
        x: int(r, 5, 10),
        bands: int(r, 0, 3),
        tower: pick(r, [0xc8102e, 0x1a1a1a, 0x1f4fa0, 0x2a9d8f]),
        beam: r() < 0.5 ? 1 : -1,
        rock: pick(r, [0x5c5c66, 0x6b4a32, 0x3d3d48]),
        birds: r() < 0.4 ? 1 : 0,
      }
    },
    paint: (pixels, p, t) => {
      const [sky, deep, middle, light, foam, sun] = colors(p, "s", 6)
      const night = luma(sky) < 0.25
      const white = 0xf4f1ea
      const lamp = 3

      pixels.each((x, y) => {
        if (y >= 12) return (x + y * 3) % 7 === 0 ? foam : y === 12 ? light : y > 13 ? deep : middle

        return sky
      })

      const sweep = Math.sin(t * 1.6) * 0.5
      const reach = p.beam + (t > 0 ? sweep : 0)

      if (night || t > 0) {
        pixels.each((x, y) => {
          const dx = (x + 0.5 - (p.x + 0.5)) * Math.sign(reach)

          if (dx < 1 || y >= 12) return undefined
          const spread = Math.abs(y + 0.5 - (lamp + 0.5)) / dx

          return spread < 0.28 ? mix(pixels.get(x, y), sun, 0.55 * (1 - dx / 16) * Math.min(1, Math.abs(reach))) : undefined
        })
      }

      pixels.each((x, y) => (y >= 11 && y <= 13 && Math.abs(x + 0.5 - (p.x + 0.5)) < 4 - (y - 11) * -0.6 - (y === 11 ? 1.4 : 0) ? p.rock : undefined))

      for (let y = 4; y <= 10; y++) {
        const half = 1 + (y >= 8 ? 1 : 0)

        for (let x = p.x - half + 1; x <= p.x + half; x++) {
          const stripes = [y % 4 < 2, (x + y) % 4 < 2, y >= 8 || y === 4, Math.floor((y - 4) / 3) % 2 === 0]
          pixels.set(x, y, stripes[p.bands] ? p.tower : white)
        }
      }

      pixels.rect(p.x - 1, 3, 3, 1, 0x2b2b2b)
      pixels.rect(p.x, 2, 2, 2, sun)
      pixels.rect(p.x, lamp, 1, 1, tint(sun, 0.5))
      pixels.rect(p.x - 1, 1, 4, 1, shade(p.tower, 0.7))

      if (p.birds && !night) {
        ;[
          [3, 3],
          [12, 2],
        ].forEach(([bx, by]) => {
          pixels.set(bx, by, shade(sky, 0.4))
          pixels.set(bx + 2, by, shade(sky, 0.4))
          pixels.set(bx + 1, by + 1, shade(sky, 0.4))
        })
      }
    },
  },
  {
    id: "dice",
    name: "Dice",
    family: "Objects",
    label: "One big die or an overlapping pair in six finishes on felt, wood or leather; they roll on hover",
    animated: true,
    resolve: (random) => {
      const r = random("dice")
      const [body, pip] = pick(r, DICE)

      return {
        grid: 16,
        layout: int(r, 0, 1),
        body,
        pip,
        felt: pick(r, FELTS),
        a: int(r, 1, 6),
        b: int(r, 1, 6),
      }
    },
    paint: (pixels, p, t) => {
      const roll = Math.floor(t * 6)
      const face = (n: number) => ((n - 1 + roll) % 6) + 1
      pixels.fill(p.felt)
      pixels.each((x, y) => (grain(x, y, 2) < 0.12 ? shade(p.felt, 0.88) : undefined))

      const die = (x0: number, y0: number, size: number, value: number, pipSize: number) => {
        pixels.rect(x0 + 1, y0 + size, size, 1, shade(p.felt, 0.6))
        pixels.rect(x0 + size, y0 + 1, 1, size, shade(p.felt, 0.6))
        pixels.rect(x0, y0, size, size, p.body)
        pixels.rect(x0, y0 + size - 1, size, 1, shade(p.body, 0.8))
        pixels.rect(x0 + size - 1, y0, 1, size, shade(p.body, 0.8))
        pixels.set(x0, y0, p.felt)
        pixels.set(x0 + size - 1, y0, p.felt)
        pixels.set(x0, y0 + size - 1, p.felt)
        pixels.set(x0 + size - 1, y0 + size - 1, p.felt)
        const step = (size - pipSize) / 2
        PIPS[value - 1].forEach((spot) => {
          const color = value === 1 && p.pip === 0x1a1a1a ? 0xc8102e : p.pip
          pixels.rect(Math.round(x0 + (spot % 3) * step * 0.78 + step * 0.22), Math.round(y0 + Math.floor(spot / 3) * step * 0.78 + step * 0.22), pipSize, pipSize, color)
        })
      }

      const layouts = [
        () => die(2, 2, 12, face(p.a), 2),
        () => {
          die(1, 2, 8, face(p.a), 1)
          die(7, 6, 8, face(p.b), 1)
        },
      ]

      layouts[p.layout]()
    },
  },
]

const EMBLEMS: Definition[] = [
  {
    id: "shield",
    name: "Shield",
    family: "Emblems",
    label: "A heater shield with one of thirteen heraldic divisions and ordinaries, by the rule of tincture",
    resolve: (random) => {
      const r = random("shield")
      const metal = pick(r, METAL_TINCTURES)
      const colour = pick(r, COLOUR_TINCTURES)
      const metalFirst = r() < 0.5
      const all = colors(palette(random("palette")))

      return {
        grid: 16,
        field: metalFirst ? metal : colour,
        charge: metalFirst ? colour : metal,
        third: pick(
          r,
          [...METAL_TINCTURES, ...COLOUR_TINCTURES].filter((c) => c !== metal && c !== colour),
        ),
        ordinary: int(r, 0, 12),
        roundel: r() < 0.4 ? 1 : 0,
        ground: r() < 0.5 ? all[0] : 0x1f2228,
      }
    },
    paint: (pixels, p) => {
      const inside = (x: number, y: number) => {
        if (y < 1 || y > 14 || x < 2 || x > 13) return false

        if (y <= 7) return true

        return Math.abs(x + 0.5 - 8) < 6 * Math.sqrt(Math.max(0, 1 - ((y + 0.5 - 7.5) / 7.2) ** 2))
      }

      const ordinaries = [
        (x: number) => x >= 6 && x <= 9,
        (_: number, y: number) => y >= 6 && y <= 9,
        (x: number, y: number) => Math.abs(x - y) <= 1.5,
        (x: number, y: number) => Math.abs(y - (12 - Math.abs(x + 0.5 - 8) * 1)) <= 1.2,
        (x: number, y: number) => (x >= 7 && x <= 8) || (y >= 6 && y <= 7),
        (x: number, y: number) => Math.abs(x - y) <= 0.8 || Math.abs(x + y - 15) <= 0.8,
        (_: number, y: number) => y <= 4,
        (x: number) => x >= 8,
        (x: number, y: number) => x >= 8 !== y >= 8,
        (x: number, y: number) => x < y,
        (x: number, y: number) => !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y + 1) || y <= 2,
        (x: number) => Math.floor((x - 2) / 2) % 2 === 1,
        (x: number, y: number) => (Math.floor((x - 2) / 3) + Math.floor((y - 1) / 3)) % 2 === 1,
      ]

      pixels.fill(p.ground)
      pixels.each((x, y) => {
        if (!inside(x, y)) return inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) ? 0x2a2a2a : undefined

        return ordinaries[p.ordinary](x, y) ? p.charge : p.field
      })

      if (!p.roundel) return
      const spot = p.ordinary === 6 ? [8, 2.6] : [8, 10]
      pixels.disc(spot[0], spot[1], 1.6, p.third)
    },
  },
  {
    id: "constellation",
    name: "Constellation",
    family: "Emblems",
    label: "Four to seven stars joined by their shortest links, on a night sky or a parchment chart; they twinkle on hover",
    animated: true,
    resolve: (random) => {
      const r = random("constellation")
      const count = int(r, 4, 7)

      const points = retry(
        () => Array.from({ length: count }, () => [range(r, 0.14, 0.86), range(r, 0.14, 0.86)]),
        (list) => list.every(([x, y], i) => list.every(([u, v], j) => i === j || Math.hypot(x - u, y - v) > 0.2)),
      )

      return {
        count,
        seed: seed(r),
        ...prefixed("k", pick(r, CHARTS)),
        ...prefixed(
          "x",
          points.map(([x]) => x),
        ),
        ...prefixed(
          "y",
          points.map(([, y]) => y),
        ),
        ...prefixed(
          "m",
          points.map(() => r()),
        ),
      }
    },
    vector: (ctx, px, p, t) => {
      const [top, bottom, line, star] = colors(p, "k", 4)
      const xs = colors(p, "x", p.count)
      const ys = colors(p, "y", p.count)
      const sizes = colors(p, "m", p.count)
      const gradient = ctx.createLinearGradient(0, 0, 0, px)
      gradient.addColorStop(0, css(top))
      gradient.addColorStop(1, css(bottom))
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, px, px)
      const rand = mulberry32(p.seed)
      ctx.fillStyle = css(star, 0.35)
      Array.from({ length: 18 }, () => ctx.fillRect(rand() * px, rand() * px, px / 64 + 0.5, px / 64 + 0.5))

      const linked = [0]
      ctx.strokeStyle = css(line, 0.75)
      ctx.lineWidth = Math.max(1, px * 0.025)

      while (linked.length < p.count) {
        const [a, b] = linked
          .flatMap((i) => xs.map((_, j) => [i, j]))
          .filter(([, j]) => !linked.includes(j))
          .toSorted(([i, j], [k, l]) => Math.hypot(xs[i] - xs[j], ys[i] - ys[j]) - Math.hypot(xs[k] - xs[l], ys[k] - ys[l]))[0]
        ctx.beginPath()
        ctx.moveTo(xs[a] * px, ys[a] * px)
        ctx.lineTo(xs[b] * px, ys[b] * px)
        ctx.stroke()
        linked.push(b)
      }

      xs.forEach((x, i) => {
        const twinkle = 1 - 0.35 * (1 - Math.cos(t * (3 + sizes[i] * 4)))
        const radius = px * (0.03 + sizes[i] * 0.035) * twinkle
        ctx.fillStyle = css(star, 0.25)
        ctx.beginPath()
        ctx.arc(x * px, ys[i] * px, radius * 2.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = css(star)
        ctx.beginPath()
        ctx.arc(x * px, ys[i] * px, radius, 0, Math.PI * 2)
        ctx.fill()
      })
    },
  },
  {
    id: "compass",
    name: "Compass rose",
    family: "Emblems",
    label: "A four-, eight- or sixteen-point rose with split points, a ring and ticks; the needle swings on hover",
    animated: true,
    resolve: (random) => {
      const r = random("compass")

      return {
        ...prefixed("k", pick(r, ROSES)),
        points: pick(r, [4, 8, 8, 16]),
        ring: r() < 0.7 ? 1 : 0,
        ticks: pick(r, [0, 16, 32]),
        turn: pick(r, [0, 0, 0, Math.PI / 8, Math.PI / 4]),
        north: r() < 0.6 ? 1 : 0,
      }
    },
    vector: (ctx, px, p, t) => {
      const [ground, dark, light, accent] = colors(p, "k", 4)
      const c = px / 2
      ctx.fillStyle = css(ground)
      ctx.fillRect(0, 0, px, px)
      ctx.save()
      ctx.translate(c, c)
      ctx.rotate(p.turn + Math.sin(t * 3) * 0.25 * Math.exp(-t * 0.4))

      if (p.ring) {
        ctx.strokeStyle = css(dark)
        ctx.lineWidth = px * 0.03
        ctx.beginPath()
        ctx.arc(0, 0, px * 0.36, 0, Math.PI * 2)
        ctx.stroke()
      }

      Array.from({ length: p.ticks }, (_, k) => {
        const angle = (k / p.ticks) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(Math.cos(angle) * px * 0.4, Math.sin(angle) * px * 0.4)
        ctx.lineTo(Math.cos(angle) * px * 0.45, Math.sin(angle) * px * 0.45)
        ctx.strokeStyle = css(dark)
        ctx.lineWidth = px * 0.02
        ctx.stroke()
      })

      const order = Array.from({ length: p.points }, (_, k) => k).toSorted((a, b) => (b % 2) - (a % 2) || (b % 4) - (a % 4))
      order.forEach((k) => {
        const angle = (k / p.points) * Math.PI * 2 - Math.PI / 2
        const level = k % 4 === 0 ? 1 : k % 2 === 0 ? 0.68 : 0.46
        const length = px * 0.46 * (p.points === 4 ? 1 : level)
        const width = px * (p.points === 4 ? 0.14 : 0.1) * (level < 1 ? 0.8 : 1)
        const tip = [Math.cos(angle) * length, Math.sin(angle) * length]
        const side = [Math.cos(angle + Math.PI / 2) * width, Math.sin(angle + Math.PI / 2) * width]
        ;[1, -1].forEach((s) => {
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.lineTo(tip[0], tip[1])
          ctx.lineTo(side[0] * s, side[1] * s)
          ctx.closePath()
          ctx.fillStyle = css(k === 0 && p.north ? (s > 0 ? accent : shade(accent, 0.7)) : s > 0 ? dark : light)
          ctx.fill()
          ctx.strokeStyle = css(dark)
          ctx.lineWidth = px * 0.012
          ctx.stroke()
        })
      })
      ctx.fillStyle = css(light)
      ctx.beginPath()
      ctx.arc(0, 0, px * 0.035, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    },
  },
  {
    id: "sigil",
    name: "Sigil",
    family: "Emblems",
    label: "A bind-rune of staves and branches cut into slate, sandstone, wood or vellum, or glowing; the glow pulses on hover",
    animated: true,
    resolve: (random) => {
      const r = random("sigil")
      const [stone, mark, glows] = pick(r, TABLETS)
      const lattice = Array.from({ length: 15 }, (_, i) => i)
      const branches = int(r, 2, 4)

      const segments = Array.from({ length: branches }, () => {
        const a = pick(r, lattice)
        const options = lattice.filter((b) => {
          const dx = Math.abs((b % 3) - (a % 3))
          const dy = Math.abs(Math.floor(b / 3) - Math.floor(a / 3))

          return b !== a && dx <= 1 && dy <= 1
        })

        return [a, pick(r, options)]
      })

      return {
        grid: 16,
        stone,
        mark,
        glows,
        staves: r() < 0.7 ? 1 : 2,
        mirror: r() < 0.5 ? 1 : 0,
        branches,
        ...prefixed(
          "a",
          segments.map(([a]) => a),
        ),
        ...prefixed(
          "b",
          segments.map(([, b]) => b),
        ),
        salt: r() * 50,
      }
    },
    paint: (pixels, p, t) => {
      const point = (i: number) => [3 + (i % 3) * 4.5, 1.5 + Math.floor(i / 3) * 3.2].map(Math.round)
      const marks = new Pixels(16)
      marks.fill(-1)

      const stroke = (a: number, b: number) => {
        const [x0, y0] = point(a)
        const [x1, y1] = point(b)
        marks.line(x0, y0, x1, y1, 1)
        marks.line(x0 + 1, y0, x1 + 1, y1, 1)

        if (!p.mirror) return
        marks.line(15 - x0, y0, 15 - x1, y1, 1)
        marks.line(14 - x0, y0, 14 - x1, y1, 1)
      }

      if (p.staves === 1) stroke(1, 13)

      if (p.staves === 2) {
        stroke(0, 12)
        stroke(2, 14)
      }

      Array.from({ length: p.branches }, (_, i) => stroke(p[`a${i}`], p[`b${i}`]))
      const pulse = p.glows ? 0.5 + 0.5 * Math.sin(t * 4) * Math.min(1, t * 2) : 0

      pixels.each((x, y) => {
        const textured = shade(p.stone, 0.9 + grain(x, y, p.salt) * 0.2)

        if (marks.cells[y * 16 + x] === 1) return p.glows ? tint(p.mark, pulse * 0.4) : p.mark

        if (!p.glows) return marks.get(x - 1, y - 1) === 1 ? tint(p.stone, 0.2) : textured
        const near = [-1, 1].some((d) => marks.get(x + d, y) === 1 || marks.get(x, y + d) === 1)

        return near ? mix(textured, p.mark, 0.3 + pulse * 0.2) : textured
      })
    },
  },
]

export const WORLD: Definition[] = [...NATURE, ...CREATURES, ...OBJECTS, ...EMBLEMS]
