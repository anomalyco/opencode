// Renders the link preview card (1200×630 PNG) for every public page into public/og/ and writes
// src/lib/og-images.json, which maps each page's path to its card (src/lib/og.ts, ShareMeta).
// Runs before `vite dev` and `vite build`. A card's file name ends in a hash of its PNG, so a new
// title, image or template gives it a new URL and link previews refresh. Cards are English at
// every locale.
//
// OG Studio (a local design tool) can replace any card. For each page it makes an English PNG, an
// optional MP4 for og:video and an optional PNG for each locale, and writes a manifest to
// src/asset/og-studio/manifest.json. Pages in that manifest use its files; every other page renders
// here. A version 2 manifest has a `base` (/files/site/og): OG Studio uploads the files to the
// files bucket there (MEDIA.md) and only the manifest is in git, so pages link `${base}/<file>`
// and nothing is copied. A manifest without `base` (version 1) keeps its files beside it, and they
// are copied into public/og/.
//
// This file is the cards' source of truth. The layout is David's template frame in Paper (the
// "OG images" file, frame "/ — dark"): a grid of #2e2e2e lines at x 72, 900 and 1128 and y 72,
// 557 and 629, the logo icon in the top-left cell, the title and a description of at most two
// lines centred in the band between the lines, and a 300 × 630 image on the right. The image is a
// real still (a product card cover, a clip frame or a page rendered headless by
// script/og-stills.ts) projected onto a tilted plane, like the site's angled card cuts.
import { createHash } from "node:crypto"
import { mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import satori from "satori"
import sharp from "sharp"
import { decompress } from "wawoff2"

const root = path.resolve(import.meta.dir, "..")
const out = path.join(root, "public/og")
const STUDIO = "src/asset/og-studio"

const W = 1200
const H = 630
const IMAGE = { left: 900, width: 300 }
const INK = "#f2f2f2"
const RULE = "#2e2e2e"
// The site's LogoIcon (component/site/marks.tsx) in the template's foreground colour.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300" viewBox="0 0 240 300"><path d="M180 240H60V120H180V240Z" fill="#4b4b4b"/><path fill-rule="evenodd" d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="#f2f2f2"/></svg>`
const TEXT = { left: 137, width: 699, title: 112, description: 32, line: 48, gap: 28 }

/** Where a still sits: its crop in source pixels and the tilted plane it's projected onto. */
type Shot = {
  file: string
  crop: [left: number, top: number, width: number, height: number]
  /** The plane's height in card pixels before perspective, and where its near edge sits in the image area. */
  height: number
  left: number
  /** Degrees: yaw (negative turns the right side away), pitch and roll. */
  turn: [y: number, x: number, z: number]
}

type Card = { path: string; title: string; description: string; shows: string; shot: Shot | "orb" }

const covers = "public/product-videos/card-loops"
const stills = "src/asset/og"
// The near edge shows a little inside the grid line and the plane runs off the right, as the
// angled card cuts do, so a crop puts what the card should show at its left.
const angled = (file: string, crop: Shot["crop"], height: number): Shot => ({
  file,
  crop,
  height,
  left: 34,
  turn: [-28, 8, -3],
})

const cards: Card[] = [
  {
    path: "/",
    title: "OpenCode",
    description: "The open source coding agent for your desktop, the terminal, your phone and your own code.",
    shows: "the home page with the desktop, terminal, mobile and SDK product cards, at an angle",
    shot: angled(`${stills}/home.jpg`, [290, 20, 1150, 860], 470),
  },
  {
    path: "/product",
    title: "Product",
    description: "One agent on your desktop, the terminal, your phone and in your own code.",
    shows: "the product page's grid of product cards, at an angle",
    shot: angled(`${stills}/product.jpg`, [290, 40, 1150, 860], 470),
  },
  {
    path: "/desktop",
    title: "Desktop",
    description: "Run several agents at once, review every change as a diff and preview it.",
    shows: "the desktop app's start screen with Claude Opus 5.5 selected, at an angle",
    shot: angled(`${covers}/desktop.webp`, [20, 340, 1024, 600], 330),
  },
  {
    path: "/mobile",
    title: "Mobile",
    description: "Start and steer your coding sessions from your phone.",
    shows: "the mobile app's dotted voice orb",
    shot: "orb",
  },
  {
    path: "/terminal",
    title: "Terminal",
    description: "A fast terminal UI that works in any shell, editor or remote server.",
    shows: "the terminal UI's blue themes dialog, at an angle",
    shot: angled(`${stills}/terminal.jpg`, [40, 170, 1500, 680], 360),
  },
  {
    path: "/sdk",
    title: "SDK",
    description: "Drive OpenCode from your own scripts, CI jobs and tools in TypeScript.",
    shows: "TypeScript code that creates an OpenCode client with the SDK, at an angle",
    shot: angled(`${covers}/sdk.webp`, [100, 420, 964, 440], 300),
  },
  {
    path: "/mini",
    title: "Mini",
    description: "A minimal terminal interface. Replies print into your own scrollback.",
    shows: "OpenCode Mini in a terminal with Claude Opus 5.5, at an angle",
    shot: angled(`${covers}/mini.webp`, [250, 540, 680, 260], 150),
  },
  {
    path: "/product/browse",
    title: "Browse",
    description: "Let your agents use your real browser, with your tabs and logins.",
    shows: "the desktop app setting up the Browse extension, at an angle",
    shot: angled("public/product-videos/features/desktop-3.jpg", [812, 60, 788, 900], 470),
  },
  {
    path: "/docs",
    title: "Docs",
    description: "Install OpenCode, connect a provider and find your way around.",
    shows: "the docs intro page with its sidebar and install commands, at an angle",
    shot: angled(`${stills}/docs.jpg`, [0, 0, 1100, 900], 470),
  },
  {
    path: "/press",
    title: "Press",
    description: "Facts, brand assets and contacts for writing about OpenCode.",
    shows: "the press kit's media section with stills of each app, at an angle",
    shot: angled(`${stills}/press.jpg`, [290, 0, 1000, 900], 470),
  },
  {
    path: "/brand",
    title: "Brand",
    description: "Logos, wordmarks, colors and the rules for using the OpenCode brand.",
    shows: "the brand page's light and dark logo files, at an angle",
    shot: angled(`${stills}/brand.jpg`, [290, 20, 820, 700], 470),
  },
  {
    path: "/font",
    title: "OpenCode Font",
    description: "A typeface cut from the OpenCode wordmark, on a grid of modules.",
    shows: "the OpenCode Font specimen, the wordmark set large, at an angle",
    shot: angled(`${stills}/font.jpg`, [250, 250, 1000, 400], 300),
  },
  {
    path: "/changelog",
    title: "Changelog",
    description: "New features and fixes in every OpenCode release.",
    shows: "the changelog timeline with the latest release and its video, at an angle",
    shot: angled(`${stills}/changelog.jpg`, [540, 60, 900, 840], 470),
  },
  // Releases come from GitHub at request time, after the build, so they share one card.
  {
    path: "/changelog/[tag]",
    title: "Release notes",
    description: "What changed in each OpenCode release, with notes and videos.",
    shows: "a changelog release page with its notes and video, at an angle",
    shot: angled(`${stills}/release.jpg`, [540, 120, 900, 780], 470),
  },
  {
    path: "/legal",
    title: "Legal",
    description: "The privacy policy, terms of use and updates to OpenCode's legal documents.",
    shows: "the legal page listing the privacy policy and terms, at an angle",
    shot: angled(`${stills}/legal.jpg`, [290, 40, 1000, 800], 470),
  },
  {
    path: "/legal/privacy-policy",
    title: "Privacy Policy",
    description: "How OpenCode collects, uses, shares and protects your personal data.",
    shows: "the Privacy Policy document with its summary, at an angle",
    shot: angled(`${stills}/privacy-policy.jpg`, [290, 0, 1000, 900], 470),
  },
  {
    path: "/legal/terms-of-service",
    title: "Terms of Use",
    description: "The rules for using the OpenCode website and hosted services.",
    shows: "the Terms of Use document with its summary, at an angle",
    shot: angled(`${stills}/terms-of-service.jpg`, [290, 0, 1000, 900], 470),
  },
]

const fonts = [
  // The site's files (script/opentui-mono.py): Latin first, the rest for anything it lacks.
  ...(await Promise.all(
    ["latin", "rest"].map(async (group) => ({
      name: "OpenTUI Mono",
      data: exact(await decompress(await read(`src/asset/fonts/opentui-mono-regular-${group}.woff2`))),
      weight: 400 as const,
    })),
  )),
  // The site's Inter (src/asset/fonts/inter-latin.woff2) at the optical size a browser picks for
  // 32 px, as a static file: Satori can't set variable axes. Made with fontTools:
  //   uvx --from 'fonttools[woff]==4.60.1' python -c "from fontTools.ttLib import TTFont; from fontTools.varLib
  //   import instancer; f = instancer.instantiateVariableFont(TTFont('src/asset/fonts/inter-latin.woff2'),
  //   {'opsz': 32, 'wght': 400}); f.flavor = 'woff'; f.save('src/asset/og/inter-display-regular.woff')"
  { name: "Inter", data: exact(await read("src/asset/og/inter-display-regular.woff")), weight: 400 as const },
]

await mkdir(out, { recursive: true })
const manifest: Record<string, OgEntry> = {}
const studio = await readStudio()
const studioBase = studio?.base?.replace(/\/+$/, "") ?? "/og"
for (const [page, entry] of Object.entries(studio?.cards ?? {})) {
  if (!studio?.base) {
    const files = [entry.image, entry.video, ...Object.values(entry.locales ?? {}).map((l) => l.image)].filter(
      (file): file is string => Boolean(file),
    )
    await Promise.all(files.map((file) => Bun.write(path.join(out, file), Bun.file(path.join(root, STUDIO, file)))))
  }
  manifest[page] = {
    src: `${studioBase}/${entry.image}`,
    alt: entry.alt,
    ...(entry.video ? { video: `${studioBase}/${entry.video}` } : {}),
    ...(entry.locales
      ? {
          locales: Object.fromEntries(
            Object.entries(entry.locales).map(([locale, l]) => [
              locale,
              { src: `${studioBase}/${l.image}`, alt: l.alt },
            ]),
          ),
        }
      : {}),
  }
}
for (const card of cards.filter((card) => !manifest[card.path])) {
  await checkDescription(card)
  const image = card.shot === "orb" ? await orb() : await project(card.shot)
  const svg = await satori(plate(card, image), { width: W, height: H, fonts })
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9, effort: 10 }).toBuffer()
  if (png.length > 1_000_000) throw new Error(`${card.path}: the card is ${png.length} bytes, over the 1 MB budget`)
  const file = `${slug(card.path)}-${createHash("sha256").update(png).digest("hex").slice(0, 10)}.png`
  await Bun.write(path.join(out, file), png)
  manifest[card.path] = {
    src: `/og/${file}`,
    alt: `OpenCode link card: “${card.title}” and “${card.description}” beside ${card.shows}.`,
  }
}
const keep = new Set(
  Object.values(manifest).flatMap((card) =>
    [card.src, card.video, ...Object.values(card.locales ?? {}).map((l) => l.src)]
      .filter((src): src is string => Boolean(src))
      .map((src) => path.basename(src)),
  ),
)
await Promise.all(
  (await readdir(out)).filter((file) => !keep.has(file)).map((file) => rm(path.join(out, file), { force: true })),
)
await Bun.write(path.join(root, "src/lib/og-images.json"), JSON.stringify(manifest, null, 2) + "\n")
console.log(
  `og: ${Object.keys(manifest).length} cards (${Object.keys(studio?.cards ?? {}).length} from OG Studio${studio?.base ? ` at ${studioBase}` : ""})`,
)

type OgEntry = { src: string; alt: string; video?: string; locales?: Record<string, { src: string; alt: string }> }

type Studio = {
  /** Version 2: where the files are served (the files bucket's /files/site/og). */
  base?: string
  cards: Record<string, { image: string; alt: string; video?: string; locales?: Record<string, { image: string; alt: string }> }>
}

async function readStudio() {
  const file = Bun.file(path.join(root, STUDIO, "manifest.json"))
  if (!(await file.exists())) return undefined
  return (await file.json()) as Studio
}

function plate(card: Card, image: string) {
  const size = titleSize(card.title)
  const line = (style: Record<string, number>) => el("div", { position: "absolute", backgroundColor: RULE, ...style })
  return el(
    "div",
    { display: "flex", position: "relative", width: W, height: H, backgroundColor: "#0c0c0c" },
    img({ left: IMAGE.left, top: 0 }, image, IMAGE.width, H),
    line({ left: 0, top: 72, width: W, height: 1 }),
    line({ left: 0, top: 557, width: W, height: 1 }),
    line({ left: 0, top: 629, width: W, height: 1 }),
    line({ left: 72, top: 0, width: 1, height: H }),
    line({ left: 900, top: 0, width: 1, height: H }),
    line({ left: 1128, top: 0, width: 1, height: H }),
    // The site's LogoIcon (component/site/marks.tsx) at its own 24 × 30, centred in the 72 px cell.
    img({ left: 24, top: 21 }, svgUri(icon), 24, 30),
    el(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        position: "absolute",
        left: TEXT.left,
        top: 73,
        width: TEXT.width,
        height: 484,
        gap: TEXT.gap,
      },
      el(
        "div",
        { fontFamily: "OpenTUI Mono", fontSize: size, lineHeight: 1, letterSpacing: -0.035 * size, color: INK },
        card.title,
      ),
      description(card.description),
    ),
  )
}

function description(text: string) {
  return el(
    "div",
    {
      fontFamily: "Inter",
      fontSize: TEXT.description,
      lineHeight: `${TEXT.line}px`,
      letterSpacing: -0.01 * TEXT.description,
      color: "#a3a3a3",
      width: TEXT.width,
    },
    text,
  )
}

/** Fails the build when a description sets on more than two lines at the template's size. */
async function checkDescription(card: Card) {
  const svg = await satori(el("div", { display: "flex", width: TEXT.width }, description(card.description)), {
    width: TEXT.width,
    fonts,
  })
  const height = Number(svg.match(/height="(\d+)"/)?.[1])
  if (height > TEXT.line * 2) throw new Error(`${card.path}: the description takes ${height / TEXT.line} lines`)
}

// The title fills one line at up to the template's 112 px; a longer one sets smaller to fit.
function titleSize(title: string) {
  return Math.min(TEXT.title, Math.floor(TEXT.width / (title.length * 0.6 * 0.965)))
}

/**
 * A still projected onto a tilted plane and cut to the image area: rendered at twice the size with
 * an inverse homography and bilinear sampling, then scaled down so the edges are smooth.
 */
async function project(shot: Shot) {
  const scale = 2
  const w = IMAGE.width * scale
  const h = H * scale
  const [cl, ct, cw, ch] = shot.crop
  const source = await sharp(path.join(root, shot.file))
    .extract({ left: cl, top: ct, width: cw, height: ch })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const sw = source.info.width
  const sh = source.info.height
  const quad = corners(shot, cw / ch).map(([x, y]) => [x * scale, y * scale] as const)
  const inverse = invert(squareToQuad(quad))
  const pixels = Buffer.alloc(w * h * 3)
  const edge = 1.4 / (shot.height * scale)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [u, v] = apply(inverse, x + 0.5, y + 0.5)
      const at = (y * w + x) * 3
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        pixels[at] = pixels[at + 1] = pixels[at + 2] = 12
        continue
      }
      const sx = Math.min(u * sw, sw - 1.001)
      const sy = Math.min(v * sh, sh - 1.001)
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      // A faint rim of light on the plane's edges.
      const rim = u < edge || u > 1 - edge || v < edge * (cw / ch) || v > 1 - edge * (cw / ch) ? 0.18 : 0
      for (let c = 0; c < 3; c++) {
        const p = (yy: number, xx: number) => source.data[(yy * sw + xx) * 3 + c]!
        const value =
          p(y0, x0) * (1 - fx) * (1 - fy) +
          p(y0, x0 + 1) * fx * (1 - fy) +
          p(y0 + 1, x0) * (1 - fx) * fy +
          p(y0 + 1, x0 + 1) * fx * fy
        pixels[at + c] = Math.round(value + (255 - value) * rim)
      }
    }
  }
  const data = await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
    .resize(IMAGE.width, H)
    .png()
    .toBuffer()
  return `data:image/png;base64,${data.toString("base64")}`
}

/** The plane's corners in the image area: turned in 3D, then seen through a 900 px lens. */
function corners(shot: Shot, aspect: number) {
  const focal = 900
  const [ry, rx, rz] = shot.turn.map((deg) => (deg * Math.PI) / 180) as [number, number, number]
  const hw = (shot.height * aspect) / 2
  const hh = shot.height / 2
  const points = (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const
  ).map(([px, py]) => {
    // Yaw, then pitch, then roll.
    const x1 = px * Math.cos(ry)
    const z1 = -px * Math.sin(ry)
    const y2 = py * Math.cos(rx) - z1 * Math.sin(rx)
    const z2 = py * Math.sin(rx) + z1 * Math.cos(rx)
    const x3 = x1 * Math.cos(rz) - y2 * Math.sin(rz)
    const y3 = x1 * Math.sin(rz) + y2 * Math.cos(rz)
    const depth = focal + z2
    return [(focal * x3) / depth, (focal * y3) / depth] as const
  })
  const near = Math.min(...points.map(([x]) => x))
  return points.map(([x, y]) => [x - near + shot.left, y + H / 2] as const)
}

type Matrix = [number, number, number, number, number, number, number, number, number]

// Heckbert's projective map from the unit square to a quad (top-left, top-right, bottom-right, bottom-left).
function squareToQuad(q: (readonly [number, number])[]): Matrix {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q as [[number, number], [number, number], [number, number], [number, number]]
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const den = dx1 * dy2 - dx2 * dy1
  const g = (sx * dy2 - dx2 * sy) / den
  const hh = (dx1 * sy - sx * dy1) / den
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1]
}

function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = c * h - b * i
  const C = b * f - c * e
  const D = f * g - d * i
  const E = a * i - c * g
  const F = c * d - a * f
  const G = d * h - e * g
  const H2 = b * g - a * h
  const I = a * e - b * d
  return [A, B, C, D, E, F, G, H2, I]
}

function apply(m: Matrix, x: number, y: number) {
  const w = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w] as const
}

/** Mobile's card: the voice orb from the mobile card cover, large and cut by the image area. */
async function orb() {
  const sphere = await sharp(path.join(root, `${covers}/mobile-orb-100.webp`))
    .extract({ left: 182, top: 308, width: 700, height: 700 })
    .resize(560, 560)
    .toBuffer()
  const data = await sharp({ create: { width: IMAGE.width, height: H, channels: 3, background: "#0c0c0c" } })
    .composite([{ input: await sharp(sphere).extract({ left: 40, top: 0, width: 300, height: 560 }).toBuffer(), left: 0, top: 35 }])
    .png()
    .toBuffer()
  return `data:image/png;base64,${data.toString("base64")}`
}

function slug(page: string) {
  if (page === "/") return "home"
  return page.slice(1).replace("[tag]", "release").replaceAll("/", "-")
}

async function read(file: string) {
  return new Uint8Array(await Bun.file(path.join(root, file)).arrayBuffer())
}

function exact(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function svgUri(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}

// Satori takes React-shaped elements; these plain objects are that shape.
type Node = Parameters<typeof satori>[0]

function el(type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node {
  return { type, props: { style, children: children.length === 1 ? children[0] : children } } as unknown as Node
}

function img(style: Record<string, unknown>, src: string, width: number, height: number): Node {
  return {
    type: "img",
    props: { style: { position: "absolute", ...style, width, height }, src, width, height },
  } as unknown as Node
}

