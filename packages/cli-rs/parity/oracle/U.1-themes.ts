// P-ORACLE for U.1: resolves every built-in theme in every mode it supports, the generated `system` theme over a few
// terminal palettes, and a few broken custom themes, through the TypeScript TUI's own functions. Writes
// parity/fixtures/U.1/tokens.json; crates/ui/tests/theme_oracle.rs resolves the same inputs in Rust and compares.
//
// Colors are packed as 8 hex digits (rrggbbaa) in the order of `paths` (tokens) and `hues` (one 9-step scale per
// named hue), so the fixture stays small. The Rust test unpacks them and reports mismatches by path.
import { resolveThemeDocument, themeModes, type ResolvedTheme } from "../../../theme/src/tui/index.ts"
import { allThemes, getOpenCode2Theme, parseTheme, type ThemeDocumentSource } from "../../../tui/src/theme/index.ts"
import { generateSystem, terminalMode } from "../../../tui/src/theme/system.ts"

const output = new URL("../fixtures/U.1/tokens.json", import.meta.url).pathname
const sections = ["text", "background", "border", "scrollbar", "diff", "syntax", "markdown"] as const

type Color = { toInts(): [number, number, number, number] }
type TerminalColors = Parameters<typeof generateSystem>[0]

const pack = (color: Color) =>
  color
    .toInts()
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")

function flatten(value: unknown, prefix: string): [string, Color][] {
  if (isColor(value)) return [[prefix, value]]
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, item]) => flatten(item, `${prefix}.${key}`))
}

function isColor(value: unknown): value is Color {
  return typeof value === "object" && value !== null && typeof (value as Color).toInts === "function"
}

// Key order differs between documents, so tokens are listed by sorted path.
const paths = sections
  .flatMap((section) =>
    flatten(resolveThemeDocument(parseTheme(allThemes().opencode, "opencode"), "dark")[section], section),
  )
  .map(([path]) => path)
  .sort()

function tokens(theme: ResolvedTheme): [string, Color][] {
  const found = new Map(sections.flatMap((section) => flatten(theme[section], section)))
  if (found.size !== paths.length) throw new Error(`theme has ${found.size} tokens, expected ${paths.length}`)
  return paths.map((path) => {
    const color = found.get(path)
    if (!color) throw new Error(`theme is missing token ${path}`)
    return [path, color]
  })
}

function entry(theme: ResolvedTheme, modes: readonly string[]) {
  const packed = (view: ResolvedTheme) =>
    tokens(view)
      .map(([, color]) => pack(color))
      .join("")
  return {
    modes,
    hues: Object.keys(theme.hue),
    hue: Object.values(theme.hue)
      .flatMap((scale) => Object.values(scale).map(pack))
      .join(""),
    categorical: theme.categorical.flatMap((scale) => Object.values(scale).map(pack)).join(""),
    base: packed(theme),
    dialog: packed(theme.surface("dialog")),
    footer: packed(theme.surface("dialog.footer")),
    // Results of decrease() and increase() for each token, the hue-step shifts components use.
    decrease: tokens(theme)
      .map(([, color]) => pack(theme.decrease(color as never)))
      .join(""),
    increase: tokens(theme)
      .map(([, color]) => pack(theme.increase(color as never, 2)))
      .join(""),
  }
}

// The Rust client implements the TUI under the `new-designs` experiment only, so every theme parses that way.
const parse = (source: ThemeDocumentSource, name: string) => parseTheme(source, name, { newDesigns: true })

function load(source: ThemeDocumentSource, name: string, mode: "dark" | "light") {
  const document = parse(source, name)
  const modes = themeModes(document)
  return entry(resolveThemeDocument(document, mode), modes)
}

const builtins: Record<string, ReturnType<typeof entry>> = {}
const sources = [
  ["opencode2", getOpenCode2Theme()] as const,
  ...Object.entries(allThemes()).filter(([name]) => name !== "system"),
]
for (const [name, source] of sources) {
  for (const mode of themeModes(parse(source, name))) builtins[`${name}/${mode}`] = load(source, name, mode)
}

// Palettes for the generated system theme: dark and light defaults, pure black and white (the gray-scale special
// cases), a palette without default colors, and one with missing entries that fall back to ANSI colors.
const ansi = ["#1d1f21", "#cc6666", "#b5bd68", "#f0c674", "#81a2be", "#b294bb", "#8abeb7", "#c5c8c6"]
const bright = ["#666666", "#d54e53", "#b9ca4a", "#e7c547", "#7aa6da", "#c397d8", "#70c0b1", "#eaeaea"]
const palettes: Record<string, Partial<TerminalColors> & { palette: (string | null)[] }> = {
  dark: { palette: [...ansi, ...bright], defaultBackground: "#1d1f21", defaultForeground: "#c5c8c6" },
  light: { palette: [...ansi, ...bright], defaultBackground: "#fdf6e3", defaultForeground: "#586e75" },
  black: { palette: [...ansi, ...bright], defaultBackground: "#000000", defaultForeground: "#ffffff" },
  white: { palette: [...ansi, ...bright], defaultBackground: "#ffffff", defaultForeground: "#000000" },
  palette: { palette: [...ansi, ...bright], defaultBackground: null, defaultForeground: null },
  sparse: { palette: ["#202020", null, "#40a040", null, null, null, "#40a0a0", "#d0d0d0"], defaultBackground: "#202020" },
}
const system: Record<string, ReturnType<typeof entry> & { terminal: string | null }> = {}
for (const [name, palette] of Object.entries(palettes)) {
  const colors = palette as TerminalColors
  for (const mode of ["dark", "light"] as const) {
    system[`${name}/${mode}`] = { ...load(generateSystem(colors, mode), "system", mode), terminal: terminalMode(colors) ?? null }
  }
}

// Custom themes that fail to load, with the message the theme-error toast shows.
const valid = allThemes().opencode as Record<string, unknown>
const broken: Record<string, unknown> = {
  "v1-missing-reference": { theme: { ...(allThemes().aura as { theme: object }).theme, primary: "nope" } },
  "v1-circular": { defs: { a: "b", b: "a" }, theme: { ...(allThemes().aura as { theme: object }).theme, primary: "a" } },
  "v2-bad-color": { ...valid, base: { ...(valid.base as object), border: { base: "red" } } },
  "v2-number-color": { ...valid, base: { ...(valid.base as object), border: { base: 5 } } },
  "v2-object-color": { ...valid, base: { ...(valid.base as object), border: { base: { a: 1 } } } },
  "v2-syntax-reference": {
    ...valid,
    base: { ...(valid.base as object), syntax: { ...(valid.base as { syntax: object }).syntax, comment: "$text.base" } },
  },
  "v2-bad-step": { ...valid, dark: { hue: { accent: "$hue.gray", interactive: "$hue.gray", neutral: { 150: "#000" } } } },
  "v2-missing-border": { ...valid, base: { ...(valid.base as object), border: undefined } },
  "v2-empty-categorical": { ...valid, base: { ...(valid.base as object), categorical: [] } },
  "v2-unknown-categorical": { ...valid, base: { ...(valid.base as object), categorical: ["nope"] } },
  "v2-circular": { ...valid, base: { ...(valid.base as object), border: { base: "$scrollbar.base" }, scrollbar: { base: "$border.base" } } },
  "v2-extra-key": { ...valid, base: { ...(valid.base as object), border: { base: "$text.extra" }, text: { ...(valid.base as { text: object }).text, extra: "#ffffff" } } },
  "v2-missing-reference": { ...valid, base: { ...(valid.base as object), border: { base: "$text.nope" } } },
  "v2-no-modes": { base: valid.base },
  "v2-missing-hue": { ...valid, dark: { hue: { accent: "$hue.gray", interactive: "$hue.gray" } } },
}
const errors = Object.fromEntries(
  Object.entries(broken).map(([name, source]) => {
    try {
      const document = parse(source as ThemeDocumentSource, name)
      themeModes(document).forEach((mode) => resolveThemeDocument(document, mode))
      return [name, { source, message: null }]
    } catch (error) {
      return [name, { source, message: error instanceof Error ? error.message : String(error) }]
    }
  }),
)

await Bun.write(output, JSON.stringify({ paths, builtins, system, palettes, errors }, null, 1) + "\n")
console.log(`oracle U.1: ${Object.keys(builtins).length} built-in views, ${Object.keys(system).length} system views`)
