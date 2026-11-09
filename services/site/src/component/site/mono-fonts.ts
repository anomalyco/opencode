import regularLatin from "../../asset/fonts/opentui-mono-regular-latin.woff2"
import regularRest from "../../asset/fonts/opentui-mono-regular-rest.woff2"
import boldLatin from "../../asset/fonts/opentui-mono-bold-latin.woff2"
import boldRest from "../../asset/fonts/opentui-mono-bold-rest.woff2"
import italicLatin from "../../asset/fonts/opentui-mono-italic-latin.woff2"
import italicRest from "../../asset/fonts/opentui-mono-italic-rest.woff2"
import boldItalicLatin from "../../asset/fonts/opentui-mono-bold-italic-latin.woff2"
import boldItalicRest from "../../asset/fonts/opentui-mono-bold-italic-rest.woff2"
import plexMonoLatin from "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-Regular-Latin1.woff2"
import ranges from "../../asset/fonts/opentui-mono.json"

// OpenTUI Mono, Anomaly's font (SIL OFL 1.1, src/asset/fonts/OpenTUIMono-OFL.txt), is the site's
// monospace face for every visitor (--font-mono in site.css). script/opentui-mono.py builds two
// files per style from the docs' copies: "latin" (Latin, punctuation, arrows, shapes, box drawing)
// and "rest" (the font's other characters, fetched only when a page uses one). Every character
// advances 0.6 em; the script points the two-cell arrows, dashes and shapes at their one-cell forms.
export const monoFontLatin = regularLatin

// Settings › Mono font (development only): the family ahead of the stack. IBM Plex Mono loads from
// ibm-plex-mono.css once picked; an installed font is used by name. The pre-paint script
// (preload-settings.ts) preloads the picked font's regular file.
export const monoFontDefault = "OpenTUI Mono"
export const monoFontsBuiltIn = [monoFontDefault, "IBM Plex Mono"] as const

export const monoFontPreloads: Partial<Record<string, string>> = { "IBM Plex Mono": plexMonoLatin }

/**
 * OpenTUI Mono's faces (font-display: swap), and its stand-ins while it loads: the system's
 * monospace font scaled to OpenTUI Mono's advance (600/1000 em) with its line metrics, so the swap
 * changes letter shapes only, never a line's length or height (no layout shift). macOS reads the
 * hhea metrics (ascent 965, descent 220, line gap 65) and Windows the typo ones (965, 285, no gap;
 * the font sets USE_TYPO_METRICS), so Menlo takes the first and Consolas and Courier New the second.
 * The overrides are divided by size-adjust, which scales them too. DejaVu Sans Mono (Linux) shares
 * Menlo's metrics. local() matches a face's full or PostScript name, not its family ("Menlo
 * Regular", not "Menlo"). The stand-ins have no unicode-range, so characters OpenTUI Mono lacks
 * (Cyrillic, Greek) set in the scaled system font, at the same advance.
 */
export const monoFontFaces = [
  ...[
    [regularLatin, regularRest, 400, "normal"],
    [boldLatin, boldRest, 700, "normal"],
    [italicLatin, italicRest, 400, "italic"],
    [boldItalicLatin, boldItalicRest, 700, "italic"],
  ].flatMap(([latin, rest, weight, style]) =>
    [
      [latin, ranges.latin],
      [rest, ranges.rest],
    ].map(
      ([url, range]) =>
        `@font-face { font-family: "OpenTUI Mono"; src: url(${url}) format("woff2"); font-weight: ${weight}; font-style: ${style}; font-display: swap; unicode-range: ${range}; }`,
    ),
  ),
  ...[
    [
      "Menlo",
      'local("Menlo Regular"), local("Menlo-Regular"), local("DejaVu Sans Mono")',
      1233 / 2048,
      [96.5, 22, 6.5],
      "Menlo Bold",
      "DejaVu Sans Mono Bold",
    ],
    ["Consolas", 'local("Consolas")', 1126 / 2048, [96.5, 28.5, 0], "Consolas Bold"],
    ["Courier", 'local("Courier New")', 1229 / 2048, [96.5, 28.5, 0], "Courier New Bold"],
  ].flatMap(([name, src, width, lines, ...bold]) => {
    const adjust = 0.6 / Number(width)
    const [ascent, descent, gap] = (lines as number[]).map((value) => (value / adjust).toFixed(2))
    const metrics = `size-adjust: ${(adjust * 100).toFixed(2)}%; ascent-override: ${ascent}%; descent-override: ${descent}%; line-gap-override: ${gap}%;`
    return [
      `@font-face { font-family: "OpenTUI Mono ${name}"; src: ${src}; font-weight: 100 500; ${metrics} }`,
      `@font-face { font-family: "OpenTUI Mono ${name}"; src: ${bold.map((face) => `local("${face}")`).join(", ")}; font-weight: 600 900; ${metrics} }`,
    ]
  }),
].join("\n")

/**
 * The --mono-choice value for a family: its quoted name and a comma, so site.css can put it ahead
 * of the stack (`var(--mono-choice,) "OpenTUI Mono", …`); nothing for the default. The pre-paint
 * script repeats this.
 */
export function monoFontChoice(family: string) {
  if (family === monoFontDefault) return undefined
  return `"${family.replace(/["\\]/g, "")}",`
}
