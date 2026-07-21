import { expandTheme, mergeTheme } from "./expand"
import type {
  FileThemeDefinition,
  MergeModeDefinition,
  Mode,
  ModeDefinition,
  ThemeDefinition,
  ThemeFile,
} from "./index"

export function selectTheme(
  file: ThemeFile & { light: ThemeDefinition; dark: ThemeDefinition },
  mode?: Mode,
): ThemeDefinition
export function selectTheme(file: ThemeFile, mode?: Mode): FileThemeDefinition
export function selectTheme(file: ThemeFile, mode?: Mode) {
  return selectThemeMode(file, mode).theme
}

export function selectThemeMode(
  file: ThemeFile,
  mode: Mode = "light",
): { theme: FileThemeDefinition; mode: Mode; expanded: boolean } {
  const modes = themeModes(file)
  const selectedMode = modes.includes(mode) ? mode : modes[0]
  const selected = file[selectedMode]
  if (!selected) throw new Error("Theme must provide at least one mode")
  if (merges(file.light) && merges(file.dark)) throw new Error("Light and dark themes cannot both merge modes")
  if (!merges(selected)) return { theme: selected, mode: selectedMode, expanded: false }

  const otherMode = selectedMode === "light" ? "dark" : "light"
  const other = file[otherMode]
  if (!other) throw new Error(`The ${selectedMode} theme cannot merge without a ${otherMode} theme`)
  const merged = mergeTheme(expandTheme(other), expandTheme(selected))
  if (!merged["hue"]) throw new Error(`The ${otherMode} theme must provide hues when ${selectedMode} merges modes`)
  return { theme: merged as FileThemeDefinition, mode: selectedMode, expanded: true }
}

export function themeModes(file: ThemeFile): readonly Mode[] {
  if (merges(file.light) && !file.dark) throw new Error("The light theme cannot merge without a dark theme")
  if (merges(file.dark) && !file.light) throw new Error("The dark theme cannot merge without a light theme")
  return (["light", "dark"] as const).filter((mode) => file[mode] !== undefined)
}

export function supportsThemeMode(file: ThemeFile, mode: Mode) {
  return themeModes(file).includes(mode)
}

function merges(definition: ModeDefinition | undefined): definition is MergeModeDefinition {
  return definition !== undefined && "mergeMode" in definition && definition.mergeMode === true
}
