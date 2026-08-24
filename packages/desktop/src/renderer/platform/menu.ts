import type { Platform } from "@opencode-ai/app/desktop"
import type { ElectronAPI } from "../api-types"
import { resetZoom, zoomIn, zoomOut } from "../window/zoom"

let trigger: ((id: string) => void) | null = null

export function startDesktopMenu(api: ElectronAPI) {
  api.onMenuCommand((id) => trigger?.(id))
}

export function bindDesktopMenu(next: (id: string) => void) {
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
