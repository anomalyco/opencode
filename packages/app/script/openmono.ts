// Copies the app build of OpenMono Nerd into the app. Run it from packages/app after each font build:
//
//   bun script/openmono.ts <app-nerd build folder>
//
// The app build has no ligatures and every character one cell wide. Each style has a `-text` WOFF2 file (every text
// character, box drawing, blocks and the terminal interface's symbols) and an `-icons` file (the Nerd Fonts icons).
// The icons are the same in every style, so the app bundles the Regular build's icons file once, for all styles.
//
// The script reads every input first and checks the build against the @font-face rules in src/index.css and the
// third-party notices. It writes the new files to a staging folder and moves them into place only when every check
// passed, so a build that is incomplete or does not match leaves the checkout as it was.
import { mkdtemp, rename, rm } from "node:fs/promises"
import path from "node:path"
import { brotliDecompressSync } from "node:zlib"

const source = process.argv[2]

if (!source) throw new Error("Usage: bun script/openmono.ts <app-nerd build folder>")

const app = path.resolve(import.meta.dir, "..")

const styles = ["Regular", "Bold", "Italic"]

const present = [...new Bun.Glob("woff2/OpenMonoNerd-*-icons.woff2").scanSync(source)]

// The bundled styles' text and icons files, the icons of any other style the build has, and the license.
const names = [
  ...new Set([
    ...styles.flatMap((style) => [`woff2/OpenMonoNerd-${style}-text.woff2`, `woff2/OpenMonoNerd-${style}-icons.woff2`]),
    ...present,
    "LICENSE",
  ]),
].sort()

const inputs = new Map(
  await Promise.all(
    names.map(async (name) => {
      const file = Bun.file(path.join(source, name))

      return [name, (await file.exists()) ? Buffer.from(await file.bytes()) : undefined] as const
    }),
  ),
)

const input = (name: string) => {
  const bytes = inputs.get(name)

  if (!bytes) throw new Error(`${name} was not read`)

  return bytes
}

const missing = names.filter((name) => !inputs.get(name))

if (missing.length) fail(`${source} is not a complete build. It has no`, missing)

// One icons file serves every style only while each style's file draws the same icons.
const regular = iconGlyphs(input("woff2/OpenMonoNerd-Regular-icons.woff2"))

const different = names
  .filter((name) => name.endsWith("-icons.woff2"))
  .flatMap((name) =>
    iconGlyphs(input(name)).flatMap((part, index) =>
      part.bytes.equals(regular[index]?.bytes ?? Buffer.alloc(0))
        ? []
        : [`${name}: ${part.name} differ from the Regular icons file`],
    ),
  )

if (different.length)
  fail("The icons files of this build are not the same in every style, so one file cannot serve all of them.", [
    ...different,
    "Bundle an icons file per style (script/openmono.ts and src/index.css) to use this build.",
  ])

// Each @font-face rule of the family in src/index.css: the file it names, its style, and the ranges it covers.
const rules = [...(await Bun.file(path.join(app, "src/index.css")).text()).matchAll(/@font-face\s*{([^}]*)}/g)].flatMap(
  ([, body = ""]) => {
    const value = (property: string) =>
      (body.match(new RegExp(`${property}:([^;]*);`))?.[1] ?? "").replaceAll(/\s+/g, " ").trim()

    const file = value("src").match(/OpenMono-[\w-]+\.woff2/)?.[0]

    return file
      ? [
          {
            file,
            style: `font-weight: ${value("font-weight")}; font-style: ${value("font-style")}`,
            ranges: value("unicode-range")
              .split(",")
              .map((range) => range.trim().replace(/^U\+/i, "").split("-"))
              .map(([first = "", last = first]) => ({ first: parseInt(first, 16), last: parseInt(last, 16) })),
          },
        ]
      : []
  },
)

const covers = (rule: (typeof rules)[number], point: number) =>
  rule.ranges.some((range) => range.first <= point && point <= range.last)

const hex = (points: number[]) =>
  `${points
    .slice(0, 8)
    .map((point) => `U+${point.toString(16).toUpperCase()}`)
    .join(", ")}${points.length > 8 ? `, and ${points.length - 8} more` : ""}`

const icons = codePoints(input("woff2/OpenMonoNerd-Regular-icons.woff2"))

// A character must be in the range of the rule that names its file, and in no other rule of the same style: the
// browser asks only the rules whose range holds the character.
const uncovered = styles.flatMap((style) => {
  const name = `OpenMono-${style}-text.woff2`

  const text = rules.find((rule) => rule.file === name)

  if (!text) return [`src/index.css has no @font-face rule for ${name}`]

  const shared = rules.find((rule) => rule.file === "OpenMono-icons.woff2" && rule.style === text.style)

  if (!shared) return [`src/index.css has no @font-face rule for OpenMono-icons.woff2 with ${text.style}`]

  const points = codePoints(input(`woff2/OpenMonoNerd-${style}-text.woff2`))

  return [
    ...misplaced(name, points, text, shared),
    ...misplaced(`OpenMono-icons.woff2 with ${text.style}`, icons, shared, text),
  ]
})

if (uncovered.length)
  fail("The @font-face rules in src/index.css do not match the characters of this build.", uncovered)

const license = input("LICENSE").toString()

const notices = await Bun.file(path.join(app, "src/settings/about/notices/notices.ts")).text()

const uncredited = license.split("\n").filter((line) => line.startsWith("Copyright (c)") && !notices.includes(line))

if (uncredited.length)
  fail("src/settings/about/notices/notices.ts does not have these copyright lines of the build's license.", uncredited)

const outputs = [
  ...styles.map((style) => ({
    to: path.join(app, "src/assets/fonts", `OpenMono-${style}-text.woff2`),
    bytes: input(`woff2/OpenMonoNerd-${style}-text.woff2`),
  })),
  {
    to: path.join(app, "src/assets/fonts/OpenMono-icons.woff2"),
    bytes: input("woff2/OpenMonoNerd-Regular-icons.woff2"),
  },
  { to: path.join(app, "public/assets/OpenMono-OFL.txt"), bytes: input("LICENSE") },
]

// Staged beside the checkout's files, so each move is a rename on one volume.
const staging = await mkdtemp(path.join(app, "node_modules/.openmono-"))

await Promise.all(outputs.map((output) => Bun.write(path.join(staging, path.basename(output.to)), output.bytes)))
  .then(() => Promise.all(outputs.map((output) => rename(path.join(staging, path.basename(output.to)), output.to))))
  .finally(() => rm(staging, { recursive: true, force: true }))

console.log(
  [
    ...outputs.map((output) => `${path.relative(app, output.to)} ${output.bytes.length} bytes`),
    `${present.length} icons files hold the same ${icons.length} icons; every character is in its own rule's range`,
  ].join("\n"),
)

/** The characters of a file that its own rule does not cover, or that the style's other rule covers too. */
function misplaced(file: string, points: number[], own: (typeof rules)[number], other: (typeof rules)[number]) {
  return [
    { points: points.filter((point) => !covers(own, point)), problem: "are not in the unicode-range of its rule" },
    { points: points.filter((point) => covers(other, point)), problem: `are also in the rule for ${other.file}` },
  ].flatMap((check) => (check.points.length ? [`${file}: ${hex(check.points)} ${check.problem}`] : []))
}

function fail(reason: string, details: string[]): never {
  throw new Error([reason, ...details, "Nothing was copied."].join("\n"))
}

/**
 * What an icons file draws: its code points, and the outline and horizontal metrics of every glyph but `.notdef`, the
 * first one, which each style draws its own way and no character uses.
 */
function iconGlyphs(file: Buffer) {
  const tables = woff2Tables(file)

  const loca = table(tables, "loca")

  // head.indexToLocFormat: 1 for 32-bit glyph offsets, 0 for 16-bit halves.
  const second = table(tables, "head").readInt16BE(50) === 1 ? loca.readUInt32BE(4) : loca.readUInt16BE(2) * 2

  return [
    { name: "code points", bytes: table(tables, "cmap") },
    { name: "outlines", bytes: table(tables, "glyf").subarray(second) },
    { name: "horizontal metrics", bytes: table(tables, "hmtx").subarray(4) },
  ]
}

/** Every code point a font file maps to a glyph, from the cmap subtable that holds all of them (format 12). */
function codePoints(file: Buffer) {
  const cmap = table(woff2Tables(file), "cmap")

  const subtable = Array.from({ length: cmap.readUInt16BE(2) }, (_, index) => cmap.readUInt32BE(8 + index * 8)).find(
    (offset) => cmap.readUInt16BE(offset) === 12,
  )

  if (subtable === undefined) throw new Error("A font file has no format 12 cmap subtable for this script to read")

  // Groups of 12 bytes after a 16-byte header: first code point, last code point, first glyph.
  return Array.from({ length: cmap.readUInt32BE(subtable + 12) }, (_, index) => subtable + 16 + index * 12).flatMap(
    (group) =>
      Array.from(
        { length: cmap.readUInt32BE(group + 4) - cmap.readUInt32BE(group) + 1 },
        (_, index) => cmap.readUInt32BE(group) + index,
      ),
  )
}

function table(tables: Map<string, Buffer>, tag: string) {
  const found = tables.get(tag)

  if (!found) throw new Error(`A font file has no ${tag} table that this script can read (it may be transformed)`)

  return found
}

/** The tables of a WOFF2 file by tag, without the ones the format stores transformed. */
function woff2Tables(file: Buffer) {
  // UIntBase128: seven bits a byte, the high bit set on all but the last.
  const number = (offset: number, value = 0): { value: number; offset: number } => {
    const byte = file.readUInt8(offset)

    const next = value * 128 + (byte & 0x7f)

    return byte & 0x80 ? number(offset + 1, next) : { value: next, offset: offset + 1 }
  }

  const directory = Array.from({ length: file.readUInt16BE(12) }).reduce<{
    offset: number
    entries: { tag: string; length: number; transformed: boolean }[]
  }>(
    (state) => {
      const flags = file.readUInt8(state.offset)

      const index = flags & 0x3f

      // Index 63 spells the tag out; the others are positions in the format's list of known tags.
      const tag =
        index === 63
          ? file.toString("latin1", state.offset + 1, state.offset + 5)
          : (["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca"][index] ??
            `#${index}`)

      // glyf and loca are transformed unless the version is 3; every other table only when it is not 0.
      const transformed = tag === "glyf" || tag === "loca" ? flags >> 6 !== 3 : flags >> 6 !== 0

      const original = number(state.offset + (index === 63 ? 5 : 1))

      const stored = transformed ? number(original.offset) : original

      return { offset: stored.offset, entries: [...state.entries, { tag, length: stored.value, transformed }] }
    },
    { offset: 48, entries: [] },
  )

  const data = brotliDecompressSync(file.subarray(directory.offset, directory.offset + file.readUInt32BE(20)))

  return new Map(
    directory.entries.flatMap((entry, index) => {
      const start = directory.entries.slice(0, index).reduce((sum, earlier) => sum + earlier.length, 0)

      return entry.transformed ? [] : [[entry.tag, data.subarray(start, start + entry.length)] as const]
    }),
  )
}
