import type { BrowserWindow } from "electron"
import type { TaskbarProgressMode } from "../../shared/ipc-contract"
import {
  INITIAL_TASKBAR_PROGRESS_STATE,
  transitionTaskbarProgress,
  type TaskbarProgressState,
} from "./taskbar-progress-machine"

export type TaskbarProgressWindow = Pick<BrowserWindow, "isDestroyed" | "setProgressBar">

const states = new WeakMap<TaskbarProgressWindow, TaskbarProgressState>()

export function setTaskbarProgress(win: TaskbarProgressWindow | null | undefined, mode: TaskbarProgressMode) {
  if (process.platform !== "win32" || !win || win.isDestroyed()) return
  const current = states.get(win) ?? INITIAL_TASKBAR_PROGRESS_STATE
  const next = transitionTaskbarProgress(current, { type: "mode.reported", mode })
  states.set(win, next.state)
  next.commands.forEach((command) => {
    if (command.type === "apply" && !win.isDestroyed()) {
      win.setProgressBar(command.progress, { mode: command.mode })
    }
  })
}

export function clearTaskbarProgress(win: TaskbarProgressWindow | null | undefined) {
  if (!win) return
  const current = states.get(win)

  if (!current) return
  states.set(win, transitionTaskbarProgress(current, { type: "window.closed" }).state)
}
