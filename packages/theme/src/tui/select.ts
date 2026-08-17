import { expandTheme, mergeTheme } from "./expand.js"
import type {
  FileThemeDefinition,
  MergeModeDefinition,
  Mode,
  ModeDefinition,
  ThemeDefinition,
  ThemeDocument,
} from "./index.js"

export function selectTheme(
  document: ThemeDocument & { light: ThemeDefinition; dark: ThemeDefinition },
  mode?: Mode,
): ThemeDefinition
export function selectTheme(document: ThemeDocument, mode?: Mode): FileThemeDefinition
export function selectTheme(document: ThemeDocument, mode?: Mode) {
  return selectThemeMode(document, mode).theme
}

export function selectThemeMode(
  document: ThemeDocument,
  mode: Mode = "light",
): { theme: FileThemeDefinition; mode: Mode; expanded: boolean } {
  const modes = themeModes(document)
  const selectedMode = modes.includes(mode) ? mode : modes[0]
  const selected = document[selectedMode]
  if (!selected) throw new Error("Theme must provide at least one mode")
  if (merges(document.light) && merges(document.dark)) throw new Error("Light and dark themes cannot both merge modes")
  if (!merges(selected)) return { theme: selected, mode: selectedMode, expanded: false }

  const otherMode = selectedMode === "light" ? "dark" : "light"
  const other = document[otherMode]
  if (!other) throw new Error(`The ${selectedMode} theme cannot merge without a ${otherMode} theme`)
  const merged = mergeTheme(expandTheme(other), expandTheme(selected))
  if (!merged["hue"]) throw new Error(`The ${otherMode} theme must provide hues when ${selectedMode} merges modes`)
  return { theme: merged as FileThemeDefinition, mode: selectedMode, expanded: true }
}

export function themeModes(document: ThemeDocument): readonly Mode[] {
  if (merges(document.light) && !document.dark) throw new Error("The light theme cannot merge without a dark theme")
  if (merges(document.dark) && !document.light) throw new Error("The dark theme cannot merge without a light theme")
  return (["light", "dark"] as const).filter((mode) => document[mode] !== undefined)
}

export function supportsThemeMode(document: ThemeDocument, mode: Mode) {
  return themeModes(document).includes(mode)
}

function merges(definition: ModeDefinition | undefined): definition is MergeModeDefinition {
  return definition !== undefined && "mergeMode" in definition && definition.mergeMode === true
}
