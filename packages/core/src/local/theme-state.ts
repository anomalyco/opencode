// Mutable ref bridging the TUI theme layer to local provider HTTP clients.
// The TUI theme context calls set() on every theme change; the provider fetch
// wrapper reads get() per-request so the header reflects the live theme.

// Opencode theme name → llama-skein X-Loading-Theme value.
// Themes not in this map produce no header (null = omit header).
const THEME_MAP: Record<string, string> = {
  "pip-boy": "vault-boy",
  "knight-rider": "knight-rider",
}

let _current: string | null = null

export const ThemeState = {
  get(): string | null {
    return _current
  },
  /** Call with the active opencode theme name; translates to llama-skein theme. */
  set(opencodeThemeName: string | null): void {
    _current = opencodeThemeName ? (THEME_MAP[opencodeThemeName] ?? null) : null
  },
}
