// Copies the app build of OpenMono Nerd into the app. Run it from packages/app after each font build:
//
//   bun script/openmono.ts <app-nerd build folder>
//
// The app build has no ligatures and every character one cell wide. Each style has a `-text` WOFF2 file (every text
// character, box drawing, blocks and the terminal interface's symbols) and an `-icons` file (the Nerd Fonts icons).
// The icons are the same in every style, so the app bundles the Regular build's icons file once, for all styles.
// `ranges.json` gives the unicode-range of each part, which the @font-face rules in src/index.css repeat.
//
// The script checks the build against what the app declares and copies nothing when a check fails.
import path from "node:path"
import { brotliDecompressSync } from "node:zlib"

const source = process.argv[2]

if (!source) throw new Error("Usage: bun script/openmono.ts <app-nerd build folder>")

const app = path.resolve(import.meta.dir, "..")

const assets = path.join(app, "public/assets")

const fonts = path.join(source, "woff2")

// One icons file serves every style only while each style's file draws the same icons.
const icons = await Promise.all(
  [...new Bun.Glob("OpenMonoNerd-*-icons.woff2").scanSync(fonts)].sort().map(async (name) => ({
    name,
    glyphs: iconGlyphs(await Bun.file(path.join(fonts, name)).bytes()),
  })),
)

const regular = icons.find((file) => file.name === "OpenMonoNerd-Regular-icons.woff2")

if (!regular) throw new Error(`${fonts} has no OpenMonoNerd-Regular-icons.woff2`)

const different = icons.flatMap((file) =>
  file.glyphs.flatMap((part, index) =>
    part.bytes.equals(regular.glyphs[index]?.bytes ?? Buffer.alloc(0))
      ? []
      : [`${file.name}: ${part.name} differ from ${regular.name}`],
  ),
)

if (different.length)
  throw new Error(
    [
      "The icons files of this build are not the same in every style, so one file cannot serve all of them:",
      ...different,
      "Nothing was copied. Bundle an icons file per style (script/openmono.ts and src/index.css) to use this build.",
    ].join("\n"),
  )

// The files are only correct with the ranges and copyright lines the app already declares.
const compact = (text: string) => text.replaceAll(/\s/g, "")

const css = compact(await Bun.file(path.join(app, "src/index.css")).text())

const ranges: { all: Record<"text" | "icons", string> } = await Bun.file(path.join(source, "ranges.json")).json()

const notices = await Bun.file(path.join(app, "src/settings/about/notices/notices.ts")).text()

const license = await Bun.file(path.join(source, "LICENSE")).text()

const stale = [
  ...(["text", "icons"] as const).flatMap((part) =>
    css.includes(compact(`unicode-range: ${ranges.all[part]};`))
      ? []
      : [`src/index.css: the ${part} unicode-range is not ${ranges.all[part]}`],
  ),
  ...license
    .split("\n")
    .flatMap((line) =>
      line.startsWith("Copyright (c)") && !notices.includes(line)
        ? [`src/settings/about/notices/notices.ts: missing "${line}"`]
        : [],
    ),
]

if (stale.length) throw new Error(`Nothing was copied. Update these to match the new build:\n${stale.join("\n")}`)

const copied = await Promise.all(
  [
    ...["Regular", "Bold", "Italic"].map((style) => [
      `OpenMonoNerd-${style}-text.woff2`,
      `OpenMono-${style}-text.woff2`,
    ]),
    [regular.name, "OpenMono-icons.woff2"],
  ].map(
    async ([from = "", to = ""]) =>
      `${to} ${await Bun.write(path.join(assets, to), Bun.file(path.join(fonts, from)))} bytes`,
  ),
)

await Bun.write(path.join(assets, "OpenMono-OFL.txt"), license)

console.log([...copied, "OpenMono-OFL.txt", `${icons.length} icons files hold the same icons`].join("\n"))

/**
 * What an icons file draws: its code points, and the outline and horizontal metrics of every glyph but `.notdef`, the
 * first one, which each style draws its own way and no character uses.
 */
function iconGlyphs(file: Uint8Array) {
  const tables = woff2Tables(file)

  const table = (tag: string) => {
    const found = tables.get(tag)

    if (!found)
      throw new Error(`An icons file has no ${tag} table that this script can compare (it may be transformed)`)

    return found
  }

  const loca = table("loca")

  // head.indexToLocFormat: 1 for 32-bit glyph offsets, 0 for 16-bit halves.
  const second = table("head").readInt16BE(50) === 1 ? loca.readUInt32BE(4) : loca.readUInt16BE(2) * 2

  return [
    { name: "code points", bytes: table("cmap") },
    { name: "outlines", bytes: table("glyf").subarray(second) },
    { name: "horizontal metrics", bytes: table("hmtx").subarray(4) },
  ]
}

/** The tables of a WOFF2 file by tag, without the ones the format stores transformed. */
function woff2Tables(file: Uint8Array) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)

  // UIntBase128: seven bits a byte, the high bit set on all but the last.
  const number = (offset: number, value = 0): { value: number; offset: number } => {
    const byte = view.getUint8(offset)

    const next = value * 128 + (byte & 0x7f)

    return byte & 0x80 ? number(offset + 1, next) : { value: next, offset: offset + 1 }
  }

  const directory = Array.from({ length: view.getUint16(12) }).reduce<{
    offset: number
    entries: { tag: string; length: number; transformed: boolean }[]
  }>(
    (state) => {
      const flags = view.getUint8(state.offset)

      const index = flags & 0x3f

      // Index 63 spells the tag out; the others are positions in the format's list of known tags.
      const tag =
        index === 63
          ? new TextDecoder().decode(file.subarray(state.offset + 1, state.offset + 5))
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

  const data = brotliDecompressSync(file.subarray(directory.offset, directory.offset + view.getUint32(20)))

  return new Map(
    directory.entries.flatMap((entry, index) => {
      const start = directory.entries.slice(0, index).reduce((sum, earlier) => sum + earlier.length, 0)

      return entry.transformed ? [] : [[entry.tag, data.subarray(start, start + entry.length)] as const]
    }),
  )
}
