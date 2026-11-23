import type { BrowserWindow } from "electron"
import type { TaskbarProgressMode } from "../../shared/ipc-contract"

export type TaskbarProgressWindow = Pick<BrowserWindow, "isDestroyed" | "setProgressBar">

// The mode each window last applied, so a repeat makes no shell call and an idle launch makes none at all.
const applied = new WeakMap<TaskbarProgressWindow, TaskbarProgressMode>()

// `paused` and `error` fill the bar, `indeterminate` animates it, `none` removes it.
const progress = { none: -1, indeterminate: 2, paused: 1, error: 1 } satisfies Record<TaskbarProgressMode, number>

export function setTaskbarProgress(win: TaskbarProgressWindow | null | undefined, mode: TaskbarProgressMode) {
  if (process.platform !== "win32" || !win || win.isDestroyed()) return

  if ((applied.get(win) ?? "none") === mode) return
  applied.set(win, mode)
  win.setProgressBar(progress[mode], { mode })
}
