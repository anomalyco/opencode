type Scheme = "light" | "dark"

export type ThemeSource = "system" | Scheme

export type Retry = {
  quickExits: number
  delayMs: number | null
}

// The portal reports 1 for prefer-dark and 2 for prefer-light; 0 is "no preference".
export function parsePortalColorScheme(output: string): Scheme | null {
  const match = output.match(/uint32\s+(\d+)/)

  if (!match) return null

  const value = Number(match[1])

  if (value === 1) return "dark"

  if (value === 2) return "light"

  return null
}

// gdbus monitor also forwards GNOME settings; only the appearance color-scheme drives this.
export function isColorSchemeSignal(line: string) {
  return line.includes("org.freedesktop.appearance") && line.includes("color-scheme")
}

// A session without a session bus or portal makes the monitor exit immediately. Back off and give
// up instead of respawning forever; a run of at least 10s counts as healthy and resets.
export function nextRetry(quickExits: number, livedMs: number): Retry {
  if (livedMs >= 10_000) return { quickExits: 0, delayMs: 0 }

  const next = quickExits + 1

  if (next >= 3) return { quickExits: next, delayMs: null }

  return { quickExits: next, delayMs: next * 10_000 }
}

// An explicit app scheme always wins; otherwise the portal decides, falling back to "system".
export function resolveThemeSource(scheme: "system" | Scheme | undefined, portal: Scheme | null): ThemeSource {
  if (scheme === "light" || scheme === "dark") return scheme

  return portal ?? "system"
}
