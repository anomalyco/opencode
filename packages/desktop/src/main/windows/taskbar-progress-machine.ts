import type { TaskbarProgressMode } from "../../shared/ipc-contract"

export type TaskbarProgressState =
  | { readonly status: "blank" }
  | { readonly status: "showing"; readonly mode: TaskbarProgressMode }

export type TaskbarProgressEvent =
  | { readonly type: "mode.reported"; readonly mode: TaskbarProgressMode }
  | { readonly type: "window.closed" }

export type TaskbarProgressCommand = {
  readonly type: "apply"
  readonly progress: number
  readonly mode: TaskbarProgressMode
}

export type TaskbarProgressTransition = {
  readonly state: TaskbarProgressState
  readonly commands: readonly TaskbarProgressCommand[]
}

export const INITIAL_TASKBAR_PROGRESS_STATE: TaskbarProgressState = Object.freeze({ status: "blank" })

export function transitionTaskbarProgress(
  state: TaskbarProgressState,
  event: TaskbarProgressEvent,
): TaskbarProgressTransition {
  if (event.type === "window.closed") {
    return state.status === "blank"
      ? { state, commands: [] }
      : { state: INITIAL_TASKBAR_PROGRESS_STATE, commands: [] }
  }

  // A fresh idle window never touches ITaskbarList3 until a session shows activity.
  if (state.status === "blank") {
    if (event.mode === "none") return { state, commands: [] }

    return {
      state: { status: "showing", mode: event.mode },
      commands: [applyCommand(event.mode)],
    }
  }

  if (state.mode === event.mode) return { state, commands: [] }

  return {
    state: { status: "showing", mode: event.mode },
    commands: [applyCommand(event.mode)],
  }
}

function applyCommand(mode: TaskbarProgressMode): TaskbarProgressCommand {
  if (mode === "paused" || mode === "error") return { type: "apply", progress: 1, mode }

  if (mode === "indeterminate") return { type: "apply", progress: 2, mode }

  return { type: "apply", progress: -1, mode: "none" }
}
