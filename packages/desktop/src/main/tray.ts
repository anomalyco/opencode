/**
 * System tray support for tray mode (Windows/Linux).
 *
 * macOS does not get a tray: the app stays in the Dock, `activate` restores
 * the window, and closing a window keeps the app alive (see index.ts).
 *
 * The tray holds the app alive when every window is hidden and offers
 * "Show OpenCode" / "Quit". Quitting goes through `app.quit()` so the
 * `before-quit` 鈫?`setAppQuitting` path lets windows close normally.
 */
import { app, Menu, nativeImage, Tray } from "electron"

// Module-scope reference so the Tray is never garbage-collected; a collected
// tray drops its icon and stops responding for the rest of the session.
let tray: Tray | undefined

// E2E hooks (intentionally exposed on globalThis for testability, matching
// the __getIsQuitting pattern in index.ts).
declare global {
  var __getTrayInstance: (() => Tray | undefined) | undefined
  var __triggerTrayMenuAction: ((label: string) => void) | undefined
}

function buildTrayMenu(onShow: () => void) {
  return Menu.buildFromTemplate([
    { label: "Show OpenCode", click: onShow },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ])
}

export function createTray(iconPath: string, onShow: () => void): Tray | undefined {
  if (process.platform === "darwin") return undefined
  if (tray) return tray

  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip("OpenCode")
  tray.setContextMenu(buildTrayMenu(onShow))
  tray.on("click", onShow)
  tray.on("double-click", onShow)

  globalThis.__getTrayInstance = () => tray
  globalThis.__triggerTrayMenuAction = (label: string) => {
    const item = buildTrayMenu(onShow).items.find((entry) => entry.label === label)
    if (item?.click) item.click()
  }

  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = undefined
  globalThis.__getTrayInstance = undefined
  globalThis.__triggerTrayMenuAction = undefined
}
