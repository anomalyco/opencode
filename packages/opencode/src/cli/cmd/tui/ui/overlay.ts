import { RGBA } from "@opentui/core"

type OverlayTheme = {
  background: RGBA
  backgroundPanel: RGBA
  backgroundMenu: RGBA
}

export function overlayColor(theme: OverlayTheme, alpha = 150 / 255) {
  const base =
    theme.backgroundMenu.a > 0
      ? theme.backgroundMenu
      : theme.backgroundPanel.a > 0
        ? theme.backgroundPanel
        : theme.background
  return RGBA.fromValues(base.r, base.g, base.b, alpha)
}
