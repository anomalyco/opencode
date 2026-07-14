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
  file: Omit<ThemeFile, "light" | "dark"> & { light: ThemeDefinition; dark: ThemeDefinition },
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
  if (merges(file.light) && merges(file.dark)) throw new Error("Light and dark themes cannot both merge modes")
  const selected = file[mode]
  if (!merges(selected)) return { theme: selected, mode, expanded: false }

  const otherMode = mode === "light" ? "dark" : "light"
  const other = file[otherMode]
  const merged = mergeTheme(expandTheme(other), expandTheme(selected))
  if (!merged["hue"]) throw new Error(`The ${otherMode} theme must provide hues when ${mode} merges modes`)
  return { theme: merged as FileThemeDefinition, mode, expanded: true }
}

function merges(definition: ModeDefinition): definition is MergeModeDefinition {
  return "mergeMode" in definition && definition.mergeMode === true
}
