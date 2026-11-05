#!/usr/bin/env bun
// Lists the monospaced font families installed on this Mac (the post table's isFixedPitch, read with
// fontkit) and writes their names to src/lib/local-mono-fonts.json, for Settings › Mono font's
// "Installed on this Mac" group. Only the names are kept; the fonts are never copied. fontkit
// installs into a temporary folder, so the app takes no dependency on it.
// Run from packages/console/app: bun script/local-mono-fonts.ts
import { mkdtemp, readdir, rm } from "fs/promises"
import { homedir, tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const tmp = await mkdtemp(join(tmpdir(), "fontkit-"))
await Bun.$`bun add fontkit@2.0.4`.cwd(tmp).quiet()
type Face = {
  familyName?: string
  name?: { records?: { preferredFamily?: Record<string, string> } }
  post?: { isFixedPitch?: number }
  glyphsForString?: (text: string) => ({ id: number; advanceWidth: number } | null)[]
}
const fontkit: { openSync: (path: string) => Face & { fonts?: Face[] } } = await import(
  join(tmp, "node_modules/fontkit/dist/main.cjs")
)
// The families the site offers on their own, and Apple's hidden UI faces.
const skipped = ["IBM Plex Mono", "OpenTUI Mono", "Apple Color Emoji", "LastResort", "GB18030 Bitmap"]
const ascii = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join("")
const folders = [join(homedir(), "Library/Fonts"), "/Library/Fonts", "/System/Library/Fonts"]
const files = (
  await Promise.all(
    folders.map((folder) =>
      readdir(folder, { recursive: true })
        .then((names) => names.map((name) => join(folder, name)))
        .catch(() => []),
    ),
  )
)
  .flat()
  .filter((file) => /\.(otf|ttf|ttc|otc|dfont)$/i.test(file))
const faces = files.flatMap((file) => {
  const font = (() => {
    try {
      return fontkit.openSync(file)
    } catch {
      return undefined
    }
  })()
  if (!font) return []
  return (font.fonts ?? [font]).flatMap((face) => {
    const legacy = face.familyName?.trim()
    if (!legacy) return []
    // The typographic family ("Geist Mono"), not the legacy one per weight ("Geist Mono Light").
    const family = face.name?.records?.preferredFamily?.en?.trim() ?? legacy
    return [{ family, legacy, mono: monospaced(face) }]
  })
})
await rm(tmp, { recursive: true, force: true })
// A mono face in a family with proportional faces (Apercu Pro's Mono) goes by its legacy name, which
// CSS also matches, so the name never picks the proportional faces.
const mixed = new Set(faces.filter((face) => !face.mono).map((face) => face.family))
const list = [
  ...new Set(faces.filter((face) => face.mono).map((face) => (mixed.has(face.family) ? face.legacy : face.family))),
]
  .filter((name) => !name.startsWith(".") && !skipped.includes(name))
  .toSorted((a, b) => a.localeCompare(b))
await Bun.write(join(root, "src/lib/local-mono-fonts.json"), JSON.stringify(list, null, 2) + "\n")
console.log(`${list.length} monospaced families\n${list.join("\n")}`)

// Some monospaced fonts leave isFixedPitch unset (Monaco, Monaspace): every printable ASCII
// character then has the same advance. Fonts without Latin (Braille, STIX, Kailasa) map those
// characters to the missing glyph, so each needs a glyph of its own either way.
function monospaced(face: Face) {
  const glyphs = (() => {
    try {
      return face.glyphsForString?.(ascii) ?? []
    } catch {
      return []
    }
  })()
  if (glyphs.length !== ascii.length || glyphs.some((glyph) => !glyph || glyph.id === 0)) return false
  return !!face.post?.isFixedPitch || glyphs.every((glyph) => glyph?.advanceWidth === glyphs[0]?.advanceWidth)
}
