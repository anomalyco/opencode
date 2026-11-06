import { createSignal } from "solid-js"
import { monoFontsBuiltIn } from "./mono-fonts"
import { siteSettings } from "./settings"
import localMonoFonts from "~/lib/local-mono-fonts.json"

// Settings › Mono font's choices: the site's fonts, then the monospaced fonts installed on this Mac.
// Those come from src/lib/local-mono-fonts.json (bun script/local-mono-fonts.ts), and in Chrome also
// from the Local Font Access API once Settings asks for it, so the list follows what is installed
// now. They're used by name only and render only where installed.

const [liveFonts, setLiveFonts] = createSignal<string[]>([])

/** The installed families, with the saved one even if this computer doesn't list it. */
export function installedMonoFonts() {
  const builtIn: readonly string[] = monoFontsBuiltIn
  return [...new Set([...localMonoFonts, ...liveFonts(), siteSettings.monoFont])]
    .filter((family) => !builtIn.includes(family))
    .toSorted((a, b) => a.localeCompare(b))
}

/** Every choice, the site's fonts first: what Design mode cycles through. */
export const monoFontOptions = () => [...monoFontsBuiltIn, ...installedMonoFonts()]

export const monoFontLabel = (family: string) =>
  (monoFontsBuiltIn as readonly string[]).includes(family) ? family : `Local: ${family}`

type FontData = { family: string; blob: () => Promise<Blob> }

/** Chrome's Local Font Access API, which asks for permission the first time. */
export const canQueryLocalFonts = () => typeof window !== "undefined" && "queryLocalFonts" in window

/**
 * Adds the monospaced families from Chrome's Local Font Access API: one face per family, checked by
 * its post table's isFixedPitch flag (read from the font's header and that table only).
 */
export async function queryLocalMonoFonts() {
  const fonts = (await window.queryLocalFonts?.()) ?? []
  const first = [...new Map(fonts.filter((font) => !font.family.startsWith(".")).map((font) => [font.family, font]))]
  const checked = await Promise.all(
    first.map(async ([family, font]) => {
      // A font that can't be read, or isn't an sfnt, is left out.
      const fixed = await font
        .blob()
        .then(fixedPitch)
        .catch(() => false)
      return fixed ? [family] : []
    }),
  )
  setLiveFonts(checked.flat())
  return liveFonts().length
}

async function fixedPitch(blob: Blob) {
  const header = new DataView(await blob.slice(0, 16).arrayBuffer())
  if (header.byteLength < 16) return false
  // A collection ("ttcf") starts with its fonts' offsets; the first font's tables are enough.
  const base = header.getUint32(0) === 0x74746366 ? header.getUint32(12) : 0
  const table = new DataView(await blob.slice(base, base + 12).arrayBuffer())
  const count = table.getUint16(4)
  const records = new DataView(await blob.slice(base + 12, base + 12 + count * 16).arrayBuffer())
  const post = Array.from({ length: count }, (_, index) => index * 16).find(
    (at) => records.getUint32(at) === 0x706f7374,
  )
  if (post === undefined) return false
  const offset = records.getUint32(post + 8)
  return new DataView(await blob.slice(offset + 12, offset + 16).arrayBuffer()).getUint32(0) !== 0
}

// Chrome's Local Font Access API is not in the DOM types yet; canQueryLocalFonts() checks it exists.
declare global {
  interface Window {
    queryLocalFonts?: () => Promise<FontData[]>
  }
}
