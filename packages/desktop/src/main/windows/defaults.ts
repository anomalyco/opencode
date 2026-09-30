import { resolveThemeVariant } from "@opencode/ui/theme/resolve"
import type { DesktopTheme } from "@opencode/ui/theme/types"
import { nativeTheme } from "electron"
import oc2ThemeJson from "../../../../ui/src/theme/themes/oc-2.json"
import { BACKGROUND_COLOR_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

const oc2Theme = oc2ThemeJson as DesktopTheme

export function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

// The colour the renderer reported on its last run, or the default theme's for the system tone, so
// a window shown before the renderer paints already has the right background. Resolving a palette
// costs tens of milliseconds before the first window, so it only happens when nothing is stored.
export function storedBackgroundColor() {
  const stored = getStore().get(BACKGROUND_COLOR_KEY)
  if (typeof stored === "string") return stored
  const dark = tone() === "dark"
  return resolveThemeVariant(dark ? oc2Theme.dark : oc2Theme.light, dark)["background-base"]
}
