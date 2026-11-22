import { nativeImage, screen, type BrowserWindow, type NativeImage } from "electron"
import { renderTaskbarBadgeBitmap } from "./taskbar-badge-icon"

export type TaskbarBadgeWindow = Pick<BrowserWindow, "isDestroyed" | "getBounds" | "setOverlayIcon">

type Badge = { readonly count: number; readonly description: string; readonly scale: number }

// What each window's overlay shows, so a repeat makes no shell call and an idle launch makes none at all.
const shown = new WeakMap<TaskbarBadgeWindow, Badge>()

const icons = new Map<string, NativeImage>()

/** Shows `count` over the window's taskbar button (1 to 9, then "9+"), drawn for its display's scale; 0 clears it. */
export function setTaskbarBadge(win: TaskbarBadgeWindow | null | undefined, count: number, description: string) {
  if (process.platform !== "win32" || !win || win.isDestroyed()) return
  const last = shown.get(win)

  if (count <= 0) {
    if (!last) return
    shown.delete(win)
    win.setOverlayIcon(null, "")

    return
  }

  const scale = Math.max(1, screen.getDisplayMatching(win.getBounds()).scaleFactor)

  if (last?.count === count && last.description === description && last.scale === scale) return
  shown.set(win, { count, description, scale })
  win.setOverlayIcon(badgeIcon(Math.min(count, 10), Math.round(16 * scale)), description)
}

/** Draws a window's badge again after it moved, in case its new display has another scale. */
export function refreshTaskbarBadge(win: TaskbarBadgeWindow) {
  const last = shown.get(win)

  if (last) setTaskbarBadge(win, last.count, last.description)
}

function badgeIcon(glyph: number, size: number) {
  const key = `${glyph}@${size}`
  const cached = icons.get(key)

  if (cached) return cached
  const bitmap = renderTaskbarBadgeBitmap(glyph, size)
  const icon = nativeImage.createFromBitmap(bitmap.buffer, { width: size, height: size, scaleFactor: size / 16 })
  icons.set(key, icon)

  return icon
}
