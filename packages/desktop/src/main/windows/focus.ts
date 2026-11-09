import type { App, BrowserWindow } from "electron"

export type FocusableWindow = Pick<BrowserWindow, "isMinimized" | "restore" | "show" | "focus">

export function showWindow(win: Pick<FocusableWindow, "isMinimized" | "restore" | "show"> | null | undefined) {
  if (!win) return

  if (win.isMinimized()) win.restore()
  win.show()
}

export function focusWindow(
  win: Pick<FocusableWindow, "isMinimized" | "restore" | "focus"> | null | undefined,
  app: Pick<App, "focus">,
) {
  if (!win) return

  if (win.isMinimized()) win.restore()

  if (process.platform === "darwin") app.focus({ steal: true })
  win.focus()
}
