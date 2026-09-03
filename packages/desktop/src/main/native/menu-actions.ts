import { BrowserWindow } from "electron"
import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import { setZoomFactor } from "../windows"

export type DesktopMenuActionHandlers = Partial<{
  checkForUpdates: () => void
  installCli: () => void
  createWindow: () => void
  relaunch: () => void
}>

export function runDesktopMenuAction(
  win: BrowserWindow | null,
  action: DesktopMenuAction,
  handlers: DesktopMenuActionHandlers = {},
) {
  switch (action) {
    case "app.checkForUpdates":
      handlers.checkForUpdates?.()
      return
    case "app.installCli":
      handlers.installCli?.()
      return
    case "app.relaunch":
      handlers.relaunch?.()
      return
    case "window.new":
      handlers.createWindow?.()
      return
    case "window.close":
      win?.close()
      return
    case "window.minimize":
      win?.minimize()
      return
    case "window.toggleMaximize":
      if (win?.isMaximized()) {
        win.unmaximize()
        return
      }
      win?.maximize()
      return
    case "view.reload":
      win?.reload()
      return
    case "view.toggleDevTools":
      win?.webContents.toggleDevTools()
      return
    case "view.resetZoom":
      if (win) setZoomFactor(win, 1)
      return
    case "view.zoomIn":
      if (win) setZoomFactor(win, win.webContents.getZoomFactor() + 0.2)
      return
    case "view.zoomOut":
      if (win) setZoomFactor(win, win.webContents.getZoomFactor() - 0.2)
      return
    case "view.toggleFullscreen":
      win?.setFullScreen(!win.isFullScreen())
      return
    case "edit.undo":
      win?.webContents.undo()
      return
    case "edit.redo":
      win?.webContents.redo()
      return
    case "edit.cut":
      win?.webContents.cut()
      return
    case "edit.copy":
      win?.webContents.copy()
      return
    case "edit.paste":
      win?.webContents.paste()
      return
    case "edit.delete":
      win?.webContents.delete()
      return
    case "edit.selectAll":
      win?.webContents.selectAll()
      return
  }
}
