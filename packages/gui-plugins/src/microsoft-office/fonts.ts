import type { BundledFontProvider } from "@betteroffice/docx/layout"
import {
  loadBundledFontBytes,
  resolveBundledFamilyFace,
  resolveLastResortFace,
  resolveMetricCompatFace,
  resolveScriptFallbackFace,
  type BundledFontFace,
  type BundledFontScript,
} from "@betteroffice/fonts"

// Every face loads from the app's own files, so no font request leaves the machine. The Chinese, Japanese and Korean
// faces are an add-on the app does not ship (see `fonts-cjk.ts`), yet the font package still maps East Asian families
// such as Microsoft YaHei or Yu Gothic Medium to them, so every lookup passes through `shippedFace`.
function shipped(script: BundledFontScript) {
  return !script.startsWith("cjk-")
}

/** The faces Word substitutes for a document's fonts: metric-compatible ones first, then Word's own fallbacks. */
export function wordFonts(): BundledFontProvider {
  const loader = (face: BundledFontFace | undefined) => (face ? () => loadFace(face) : undefined)

  return {
    resolve: (family, bold, italic) => loader(shippedFace(resolveMetricCompatFace(family, bold, italic))),
    resolveFamily: (family, bold, italic) => loader(shippedFace(resolveBundledFamilyFace(family, bold, italic))),
    resolveScriptFallback: (script, bold, italic) => loader(scriptFace(script, bold, italic)),
    resolveLastResort: (family, bold, italic) => () => loadFace(lastResortFace(family, bold, italic, "word")),
  }
}

/** The face PowerPoint draws a family with: its metric-compatible or bundled face, else PowerPoint's substitute. */
export function presentationFace(family: string, bold: boolean, italic: boolean): BundledFontFace {
  return (
    shippedFace(resolveMetricCompatFace(family, bold, italic)) ??
    shippedFace(resolveBundledFamilyFace(family, bold, italic)) ??
    lastResortFace(family, bold, italic, "powerpoint")
  )
}

function shippedFace(face: BundledFontFace | undefined) {
  return face && (!face.script || shipped(face.script)) ? face : undefined
}

/**
 * The substitute an application picks for a family it lacks. Only a weight variant of an East Asian family, such as
 * Yu Mincho Light, resolves to a face the app does not ship; its name without the weight still tells serif from sans.
 */
function lastResortFace(family: string, bold: boolean, italic: boolean, office: "word" | "powerpoint") {
  const face = resolveLastResortFace(family, bold, italic, office)

  if (shippedFace(face)) return face

  const base = family
    .trim()
    .split(/[\s-]+/)
    .slice(0, -1)
    .join(" ")

  return (
    shippedFace(resolveLastResortFace(base, bold, italic, office)) ?? resolveLastResortFace("", bold, italic, office)
  )
}

/** The face that covers a script the Latin faces lack, or undefined when the app ships none. */
export function scriptFace(script: BundledFontScript, bold: boolean, italic: boolean) {
  return shipped(script) ? resolveScriptFallbackFace(script, bold, italic) : undefined
}

/**
 * A bundled face's bytes. The font package caches them per worker, so a face loads once per open file; the browser's
 * caches, which every worker shares, serve the files to the next.
 */
export function loadFace(face: BundledFontFace) {
  return loadBundledFontBytes(face)
}
