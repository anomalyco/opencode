/** The theme colors draw commands name and the renderer styles with (`--pw-<token>` CSS variables). */
export interface ThemeTokens {
  text: string
  muted: string
  accent: string
  bg: string
  surface: string
  border: string
  success: string
  warning: string
  error: string
  /** Text on an `accent` fill (primary buttons). Defaults to black or white, whichever contrasts more. */
  accentText?: string
  /** CSS font-family for text; defaults to the system UI font. */
  font?: string
  /** CSS font-family for `code` text and `mono` draw text. */
  mono?: string
  /** Corner radius in px for cards, inputs and buttons. */
  radius?: number
  /** Whether this is a dark theme (`Frame.dark`); defaults to whether `bg` is dark. */
  dark?: boolean
}

/** `"dark"`, `"light"`, or tokens (missing ones come from the dark or light preset, by `dark` or `bg`). */
export type Theme = "dark" | "light" | (Partial<ThemeTokens> & { base?: "dark" | "light" })

export const DARK: ThemeTokens = {
  text: "#ededef",
  muted: "#9b9ba4",
  accent: "#5b9cff",
  bg: "#161618",
  surface: "#1f1f23",
  border: "#323238",
  success: "#3fb950",
  warning: "#d29922",
  error: "#f85149",
}

export const LIGHT: ThemeTokens = {
  text: "#1b1b1f",
  muted: "#6b6b76",
  accent: "#2563eb",
  bg: "#ffffff",
  surface: "#f5f5f7",
  border: "#dedee3",
  success: "#1a7f37",
  warning: "#9a6700",
  error: "#cf222e",
}

export const TOKENS = ["text", "muted", "accent", "bg", "surface", "border", "success", "warning", "error"] as const
export type Token = (typeof TOKENS)[number]

/** The resolved theme: every token, and whether it's dark. */
export interface Resolved extends ThemeTokens {
  accentText: string
  font: string
  mono: string
  radius: number
  dark: boolean
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

export function resolve(theme: Theme | undefined): Resolved {
  if (theme === undefined || theme === "dark") return finish(DARK, true)
  if (theme === "light") return finish(LIGHT, false)
  const dark = theme.dark ?? (theme.base ? theme.base === "dark" : theme.bg ? luminance(theme.bg) < 0.4 : true)
  return finish({ ...(dark ? DARK : LIGHT), ...defined(theme) }, dark)
}

function defined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

function finish(t: ThemeTokens, dark: boolean): Resolved {
  return {
    ...t,
    accentText: t.accentText ?? (luminance(t.accent) > 0.45 ? "#000000" : "#ffffff"),
    font: t.font ?? FONT,
    mono: t.mono ?? MONO,
    radius: t.radius ?? 8,
    dark: t.dark ?? dark,
  }
}

/** Relative luminance of a `#rgb`/`#rrggbb` color, 0..1; 0.5 for anything else. */
export function luminance(color: string): number {
  const rgb = parseHex(color)
  if (!rgb) return 0.5
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` to [r, g, b, a] (a 0..1). */
export function parseHex(color: string): [number, number, number, number] | undefined {
  if (color.charCodeAt(0) !== 35) return undefined
  const h = color.slice(1)
  if (!/^[0-9a-fA-F]+$/.test(h)) return undefined
  if (h.length === 3 || h.length === 4) {
    const v = [...h].map((c) => parseInt(c + c, 16))
    return [v[0]!, v[1]!, v[2]!, h.length === 4 ? v[3]! / 255 : 1]
  }
  if (h.length === 6 || h.length === 8) {
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  return undefined
}

/** Sets `--pw-*` on `el`. */
export function apply(el: HTMLElement, t: Resolved) {
  const s = el.style
  for (const k of TOKENS) s.setProperty(`--pw-${k}`, t[k])
  s.setProperty("--pw-accent-text", t.accentText)
  s.setProperty("--pw-font", t.font)
  s.setProperty("--pw-mono", t.mono)
  s.setProperty("--pw-radius", `${t.radius}px`)
  s.setProperty("color-scheme", t.dark ? "dark" : "light")
}
