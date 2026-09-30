import type { Platform } from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"
import { resetZoom, zoomIn, zoomOut } from "../window/zoom"
import type { MenuCommand } from "../../shared/menu-command"

let trigger: ((command: MenuCommand) => void) | null = null

export function startDesktopMenu(api: ElectronAPI) {
  api.onMenuCommand((id) => trigger?.(id))
}

export function bindDesktopMenu(next: (command: MenuCommand) => void) {
  trigger = next
}

export function createDesktopMenuAction(api: ElectronAPI): NonNullable<Platform["runDesktopMenuAction"]> {
  return (action) => {
    switch (action) {
      case "view.resetZoom":
        resetZoom()
        return
      case "view.zoomIn":
        zoomIn()
        return
      case "view.zoomOut":
        zoomOut()
        return
    }
    return api.runDesktopMenuAction(action)
  }
}
