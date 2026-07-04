import { app, Menu, nativeImage, Tray } from "electron"

import { iconPath, showMainWindow } from "./windows"

// Hold the tray at module scope so it is not garbage-collected; a collected
// Tray drops its icon and breaks tray interactions for the rest of the session.
let tray: Tray | undefined

export function setupTrayAndLifecycle() {
  // Hidden windows are restored from the Dock on macOS and from the tray
  // everywhere else, so closing a window keeps background work running.
  app.on("activate", () => showMainWindow())

  // macOS keeps the app in the Dock after the window is hidden, so no tray.
  if (process.platform === "darwin") return

  tray = new Tray(nativeImage.createFromPath(iconPath()))
  tray.setToolTip("OpenCode")
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show OpenCode", click: () => showMainWindow() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]),
  )
  tray.on("click", () => showMainWindow())
}
