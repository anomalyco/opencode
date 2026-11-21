import type { BrowserWindow, NativeImage, Rectangle } from "electron"
import { renderTaskbarBadgeBitmap } from "./taskbar-badge-icon"
import {
  INITIAL_TASKBAR_BADGE_STATE,
  selectTaskbarBadgeGlyph,
  transitionTaskbarBadge,
  type TaskbarBadgeState,
} from "./taskbar-badge-machine"

export type TaskbarBadgeWindow = Pick<BrowserWindow, "isDestroyed" | "getBounds" | "setOverlayIcon">

export type TaskbarBadgeDeps<Icon = NativeImage> = {
  readonly scaleFactor: (bounds: Rectangle) => number
  readonly createImage: (buffer: Buffer, options: { width: number; height: number; scaleFactor: number }) => Icon
}

/** Manages cached DPI-scaled overlay badge icons and per-window taskbar badge state on Windows. */
export function createTaskbarBadgeController<Icon extends NativeImage | null = NativeImage>(
  deps: TaskbarBadgeDeps<Icon>,
) {
  const states = new WeakMap<TaskbarBadgeWindow, TaskbarBadgeState>()
  const icons = new Map<string, Icon>()

  const iconFor = (win: TaskbarBadgeWindow, count: number) => {
    const glyph = selectTaskbarBadgeGlyph(count)
    const scaleFactor = Math.max(1, deps.scaleFactor(win.getBounds()))
    const size = Math.max(16, Math.round(16 * scaleFactor))
    const key = `${glyph}@${size}`

    if (icons.has(key)) return icons.get(key) ?? null
    const bitmap = renderTaskbarBadgeBitmap(glyph, size)

    const created = deps.createImage(bitmap.buffer, {
      width: bitmap.width,
      height: bitmap.height,
      scaleFactor: size / 16,
    })

    icons.set(key, created)

    return created
  }

  return {
    set(win: TaskbarBadgeWindow | null | undefined, count: number, description: string) {
      if (process.platform !== "win32" || !win || win.isDestroyed()) return
      const current = states.get(win) ?? INITIAL_TASKBAR_BADGE_STATE
      const next = transitionTaskbarBadge(current, { type: "badge.reported", count, description })
      states.set(win, next.state)
      next.commands.forEach((command) => {
        if (win.isDestroyed()) return

        if (command.type === "clear") {
          win.setOverlayIcon(null, "")

          return
        }

        win.setOverlayIcon(iconFor(win, command.count), command.description)
      })
    },
    clear(win: TaskbarBadgeWindow | null | undefined) {
      if (!win) return
      const current = states.get(win)

      if (!current) return
      states.set(win, transitionTaskbarBadge(current, { type: "window.closed" }).state)
    },
  }
}
