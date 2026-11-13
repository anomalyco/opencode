import { blocks } from "~/lib/markdown"

/**
 * The OpenCode font: the six letters of the wordmark, cut on a 24 × 42 cell from the official SVG
 * logo. `ink` is the letter, `shadow` the lighter shade in its counter. The same outlines live in
 * public/font/glyphs.mjs, which the font download and the GIF worker load at runtime.
 */
export const glyphs = {
  o: { shadow: "M18 30H6V18H18V30Z", ink: "M18 12H6V30H18V12ZM24 36H0V6H24V36Z" },
  p: { shadow: "M18 30H6V18H18V30Z", ink: "M6 30H18V12H6V30ZM24 36H6V42H0V6H24V36Z" },
  e: { shadow: "M24 24V30H6V24H24Z", ink: "M24 24H6V30H24V36H0V6H24V24ZM6 18H18V12H6V18Z" },
  n: { shadow: "M18 36H6V18H18V36Z", ink: "M18 12H6V36H0V6H18V12ZM24 36H18V12H24V36Z" },
  c: { shadow: "M24 30H6V18H24V30Z", ink: "M24 12H6V30H24V36H0V6H24V12Z" },
  d: { shadow: "M18 30H6V18H18V30Z", ink: "M18 12H6V30H18V12ZM24 36H0V6H18V0H24V36Z" },
} as const

export type Letter = keyof typeof glyphs
export const letters = Object.keys(glyphs) as Letter[]
export const isLetter = (value: string): value is Letter => Object.hasOwn(glyphs, value)

/**
 * Each glyph on its 4 × 7 grid of 6-unit modules, top row first: "#" ink, "+" shade, "." empty.
 * Row 0 is the ascender, rows 1–5 the x-height, row 6 the descender.
 */
export const modules: Record<Letter, string[]> = {
  o: ["....", "####", "#..#", "#++#", "#++#", "####", "...."],
  p: ["....", "####", "#..#", "#++#", "#++#", "####", "#..."],
  e: ["....", "####", "#..#", "####", "#+++", "####", "...."],
  n: ["....", "###.", "#..#", "#++#", "#++#", "#++#", "...."],
  c: ["....", "####", "#...", "#+++", "#+++", "####", "...."],
  d: ["...#", "####", "#..#", "#++#", "#++#", "####", "...."],
}

export const glyphNames: Record<Letter, string> = {
  o: "Latin small letter o",
  p: "Latin small letter p",
  e: "Latin small letter e",
  n: "Latin small letter n",
  c: "Latin small letter c",
  d: "Latin small letter d",
}

/** How many modules of each tone a glyph uses. */
export function moduleCount(letter: Letter, tone: "#" | "+") {
  return modules[letter].join("").split(tone).length - 1
}

/** The corners of a glyph's ink outline, in cell units. The outlines only use M, H, V and Z. */
export function anchors(letter: Letter) {
  const points: [number, number][] = []
  const tokens = glyphs[letter].ink.match(/[MHVZ]|-?\d+/g) ?? []
  let x = 0
  let y = 0
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === "Z") continue
    if (token === "M") {
      x = Number(tokens[++index])
      y = Number(tokens[++index])
    }
    if (token === "H") x = Number(tokens[++index])
    if (token === "V") y = Number(tokens[++index])
    points.push([x, y])
  }
  return points.filter((point, index) => points.findIndex((p) => p[0] === point[0] && p[1] === point[1]) === index)
}

/**
 * English words spelled with only c, d, e, n, o and p, picked from a dictionary filtered to those
 * letters. Longest first.
 */
export const words = [
  "dependence",
  "deepened",
  "depended",
  "conceded",
  "condoned",
  "opencode",
  "encoded",
  "decoded",
  "condone",
  "concede",
  "cocoon",
  "opened",
  "penned",
  "deepen",
  "depend",
  "decode",
  "encode",
  "coded",
  "ended",
  "nonce",
  "codon",
  "pence",
  "code",
  "open",
  "node",
  "done",
  "cone",
  "deep",
  "need",
  "noon",
  "neon",
  "pond",
  "once",
  "none",
  "coop",
  "cope",
  "dope",
  "nope",
  "deed",
  "peep",
  "pen",
  "pod",
  "den",
  "end",
  "one",
  "nod",
  "doc",
  "cod",
  "eon",
  "pop",
]

/* Analysis. Everything below is derived from the outlines and the module maps above. */

/** One module is 6 cell units, and one cell unit is 20 font units: a module is 120 of 1,000. */
export const unitsPerModule = 120
export const cellToFont = (x: number, y: number) => [60 + x * 20, (36 - y) * 20] as const
export const unicode = (letter: Letter) => `U+${letter.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`

/** The ink outline's contours: one list of corner points per closed path. */
export function contours(letter: Letter) {
  return glyphs[letter].ink
    .split("M")
    .filter(Boolean)
    .map((part) => {
      const tokens = `M${part}`.match(/[MHVZ]|-?\d+/g) ?? []
      const points: [number, number][] = []
      let x = 0
      let y = 0
      for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]
        if (token === "M") {
          x = Number(tokens[++index])
          y = Number(tokens[++index])
        }
        if (token === "H") x = Number(tokens[++index])
        if (token === "V") y = Number(tokens[++index])
        if (token !== "Z") points.push([x, y])
      }
      // A closing segment back to the start repeats the first point.
      const last = points.at(-1)
      if (last && points.length > 1 && last[0] === points[0][0] && last[1] === points[0][1]) points.pop()
      return points
    })
}

/** Ink and shade cells, each as [column, row]. */
export function cells(letter: Letter, tone: "#" | "+") {
  return modules[letter].flatMap((row, y) =>
    [...row].flatMap((cell, x) => (cell === tone ? [[x, y] as [number, number]] : [])),
  )
}

/**
 * The order the construction places a glyph's ink modules: a flood from the lowest-left module,
 * so the letter grows along its strokes the way a pen would draw it.
 */
export function buildOrder(letter: Letter) {
  const ink = cells(letter, "#")
  const key = (cell: [number, number]) => `${cell[0]},${cell[1]}`
  const remaining = new Map(ink.map((cell) => [key(cell), cell]))
  const order: [number, number][] = []
  const queue: [number, number][] = []
  while (remaining.size || queue.length) {
    // A new stroke (the n's right stem only touches the rest at a corner) starts lowest-left.
    if (!queue.length) {
      const start = [...remaining.values()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
      remaining.delete(key(start))
      queue.push(start)
    }
    const cell = queue.shift()!
    order.push(cell)
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const next = remaining.get(`${cell[0] + dx},${cell[1] + dy}`)
      if (!next) continue
      remaining.delete(key(next))
      queue.push(next)
    }
  }
  return order
}

/** Share of the 28-module cell covered by ink. */
export const coverage = (letter: Letter) => moduleCount(letter, "#") / 28

/** White modules inside the x-height box (rows 1–5): the counters, shaded or not. */
export const counterModules = (letter: Letter) => modules[letter].slice(1, 6).join("").replace(/#/g, "").length

/** How closely the ink matches its own mirror image, 0–1. */
export function symmetry(letter: Letter, axis: "vertical" | "horizontal") {
  const rows = modules[letter].slice(1, 6).map((row) => [...row].map((cell) => cell === "#"))
  const mirrored = axis === "vertical" ? rows.map((row) => [...row].reverse()) : [...rows].reverse()
  const total = rows.length * 4
  const same = rows.flatMap((row, y) => row.map((cell, x) => cell === mirrored[y][x])).filter(Boolean).length
  return same / total
}

/** For each of the 28 positions, how many of the six glyphs put ink there. */
export const heatmap = Array.from({ length: 7 }, (_, y) =>
  Array.from({ length: 4 }, (_, x) => letters.filter((letter) => modules[letter][y][x] === "#").length),
)

/** Letter frequency across the word list. */
export const letterFrequency = Object.fromEntries(
  letters.map((letter) => [letter, words.join("").split(letter).length - 1]),
) as Record<Letter, number>

/** How often each ordered pair of letters appears side by side in the word list. */
export const bigrams = Object.fromEntries(
  letters.flatMap((a) =>
    letters.map((b) => [`${a}${b}`, words.reduce((sum, word) => sum + (word.split(`${a}${b}`).length - 1), 0)]),
  ),
) as Record<string, number>

/** Words that fit inside the letters of "opencode". */
export const subAnagrams = words.filter((word) => {
  const pool = [..."opencode"]
  return [...word].every((char) => {
    const index = pool.indexOf(char)
    if (index === -1) return false
    pool.splice(index, 1)
    return true
  })
})

/** 8! / (2! × 2!): the o and the e appear twice. */
export const arrangements = 10080

/**
 * The construction of one glyph, in milliseconds: the same numbers drive the animations and the
 * timeline chart. Module placement takes longer for glyphs with more modules.
 */
export function constructionPhases(letter: Letter) {
  const ink = moduleCount(letter, "#")
  const phases = [
    { id: "grid", label: "Grid", duration: 700 },
    { id: "metrics", label: "Metrics", duration: 500 },
    { id: "modules", label: "Modules", duration: ink * 90 + 200 },
    { id: "shade", label: "Shade", duration: 450 },
    { id: "outline", label: "Outline", duration: 800 },
    { id: "callouts", label: "Callouts", duration: 900 },
  ]
  let start = 0
  return phases.map((phase) => {
    const result = { ...phase, start, end: start + phase.duration }
    start = result.end - (phase.id === "grid" ? 250 : 80)
    return result
  })
}

/** Measured with opentype.js and zlib (gzip level 9, brotli default) on the default substitution map. */
export const performance = {
  otf: 49208,
  gzip: 19832,
  brotli: 11091,
  glyphs: 9,
  codePoints: 4149,
}

/** From the git history of packages/ui/src/components/logo.tsx and public/font/font.mjs. */
export const versions = [
  { version: "0.1", date: "2025-11-14", note: "The wordmark's outlines land in logo.tsx" },
  { version: "0.2", date: "2026-01-17", note: "The splash logo is redrawn on the same grid" },
  { version: "1.000", date: "—", note: "The typewriter at opencode.ai/font" },
  { version: "1.001", date: "—", note: "Installable OTF with a per-visit substitution map" },
]

/** The page copy, shared by the page, its Markdown version and the ⌘K search. */
export const fontContent = {
  title: "OpenCode Font",
  metaTitle: "OpenCode | Font, a typeface cut from the wordmark",
  description:
    "A six-letter typeface cut from the OpenCode wordmark on a 4 × 7 grid. Type with it, see how every letter is built, then download your own installable font.",
  combinations: { base: "6", exponent: "3,591" },
  download: "Download",
  plates: [
    { id: "cover", title: "Specimen" },
    { id: "construction", title: "Construction" },
    { id: "timeline", title: "Timeline" },
    { id: "exploded", title: "Exploded view" },
    { id: "passports", title: "Glyph passports" },
    { id: "analysis", title: "Analysis" },
    { id: "kerning", title: "Kerning" },
    { id: "performance", title: "Performance" },
    { id: "poster", title: "Poster" },
    { id: "waterfall", title: "Waterfall" },
    { id: "anagrams", title: "Anagrams" },
    { id: "field", title: "Field" },
    { id: "loupe", title: "Loupe" },
    { id: "tester", title: "Tester" },
    { id: "universe", title: "How big is 6³⁵⁹¹" },
    { id: "colophon", title: "Colophon" },
  ],
  cover: {
    lead: "Six letters cut from the OpenCode wordmark. No curves, no diagonals, no exceptions: every edge falls on a grid of 120-unit modules.",
  },
  construction: {
    lead: "Each letter, rebuilt from nothing: the grid, the metrics, one module at a time, the shade, the outline, and the measurements that prove it.",
  },
  timeline: {
    lead: "The same construction as a schedule. Letters with more modules take longer to place; nothing else changes.",
  },
  exploded: {
    lead: "Every module lifts by a stated rule: the order it was placed, its row, or its distance from the centre. Equal steps stay equal.",
  },
  passports: {
    lead: "One page per letter: identity, measurements and every point of its outline in font units.",
  },
  analysis: {
    lead: "Ink, counters, symmetry and the 28 positions of the grid, counted across all six letters.",
  },
  kerning: {
    lead: "Thirty-six pairs. Every one of them spaced by the same 120 units. The kerning table is empty, and that is the point.",
  },
  performance: {
    lead: "A font small enough to read in one sitting.",
  },
  anagrams: {
    lead: "The letters of opencode can be arranged 10,080 ways. Try them all.",
  },
  field: {
    lead: "A field of the six letters.",
  },
  loupe: {
    lead: "Look closer. Every module of every letter is a grid of 144 smaller squares.",
    label: "opencode, set large in the OpenCode font. Hover or press and hold to look through a loupe.",
  },
  tester: {
    lead: "Type with the six letters. Other characters stay empty.",
    label: "Text to preview in the OpenCode font",
    initial: "open code node done",
  },
  colophon: {
    lead: "Download the font, install it, then choose OpenCode in any app. Every copy carries its own substitution map.",
  },
}

/** The page's Markdown version: the specimen's plates that have a lead, and what each shows. */
export function fontMarkdown() {
  const c = fontContent
  return blocks(
    `# ${c.title}`,
    c.description,
    ...[
      ["Specimen", c.cover.lead],
      ["Construction", c.construction.lead],
      ["Timeline", c.timeline.lead],
      ["Exploded view", c.exploded.lead],
      ["Glyph passports", c.passports.lead],
      ["Analysis", c.analysis.lead],
      ["Kerning", c.kerning.lead],
      ["Performance", c.performance.lead],
      ["Anagrams", c.anagrams.lead],
      ["Field", c.field.lead],
      ["Loupe", c.loupe.lead],
      ["Tester", c.tester.lead],
      ["Colophon", c.colophon.lead],
    ].flatMap(([title, lead]) => [`## ${title}`, lead]),
  )
}
