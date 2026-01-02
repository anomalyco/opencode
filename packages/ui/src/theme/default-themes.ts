import type { DesktopTheme } from "./types"
import { tuiToDesktop, type TuiTheme } from "./tui-adapter"

const tuiThemes = import.meta.glob("../../../../opencode/src/cli/cmd/tui/context/theme/*.json", {
  eager: true,
  import: "default",
}) as Record<string, TuiTheme>

export const DEFAULT_THEMES: Record<string, DesktopTheme> = Object.fromEntries(
  Object.entries(tuiThemes).map(([path, json]) => {
    const id = path.split("/").pop()!.replace(".json", "")
    return [id, tuiToDesktop(json, id)]
  }),
)

export const oc1Theme = DEFAULT_THEMES["opencode"]
export const tokyonightTheme = DEFAULT_THEMES["tokyonight"]
export const draculaTheme = DEFAULT_THEMES["dracula"]
export const monokaiTheme = DEFAULT_THEMES["monokai"]
export const solarizedTheme = DEFAULT_THEMES["solarized"]
export const nordTheme = DEFAULT_THEMES["nord"]
export const catppuccinTheme = DEFAULT_THEMES["catppuccin"]
export const ayuTheme = DEFAULT_THEMES["ayu"]
export const oneDarkProTheme = DEFAULT_THEMES["one-dark"]
export const shadesOfPurpleTheme = DEFAULT_THEMES["aura"]
