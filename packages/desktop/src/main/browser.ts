import { BrowserWindow, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"

function targetWindow(event: IpcMainInvokeEvent) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (owner && !owner.isDestroyed()) return owner

  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused

  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null
}

export function registerBrowserIpcHandlers() {
  ipcMain.handle("browser-open", (event: IpcMainInvokeEvent, url?: string) => {
    const win = targetWindow(event)
    if (!win) return false
    win.show()
    win.focus()
    win.webContents.send("activate-browser-tab", { url })
    return true
  })

  ipcMain.handle("browser-close", () => {
    return false
  })
}
