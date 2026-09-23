import { mergeTheme } from "./expand.js"
import type { Mode, ThemeDefinition, ThemeDocument } from "./index.js"

export function selectTheme(document: ThemeDocument, mode?: Mode): ThemeDefinition {
  return selectThemeMode(document, mode).theme
}

export function selectThemeMode(
  document: ThemeDocument,
  mode: Mode = "light",
): { theme: ThemeDefinition; mode: Mode } {
  const modes = themeModes(document)
  const selectedMode = modes.includes(mode) ? mode : modes[0]
  const selected = document[selectedMode]
  if (!selected) throw new Error("Theme must provide at least one mode")
  return { theme: mergeTheme(document.base, selected) as ThemeDefinition, mode: selectedMode }
}

export function themeModes(document: ThemeDocument): readonly Mode[] {
  return (["light", "dark"] as const).filter((mode) => document[mode] !== undefined)
}

export function supportsThemeMode(document: ThemeDocument, mode: Mode) {
  return themeModes(document).includes(mode)
}
