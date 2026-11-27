/**
 * The one-time notice on the first quit that the background service outlives the app. `pending` until it is shown,
 * `showing` while its dialog is open, `done` once the user answered it or already stops the service on quit.
 */
export type State = { readonly status: "pending" } | { readonly status: "showing" } | { readonly status: "done" }

export type Choice = "quit" | "settings"

export type Event =
  /** A quit the user started; `keepRunning` is the setting as it stands. */
  | { readonly type: "quit.requested"; readonly keepRunning: boolean }
  | { readonly type: "dialog.closed"; readonly choice: Choice }

export type Command =
  | { readonly type: "show" }
  | { readonly type: "persist-shown" }
  | { readonly type: "quit" }
  | { readonly type: "open-settings" }

/** `holdsQuit`: the quit that raised the event waits; the app quits again through a `quit` command, if at all. */
export type Transition = { readonly state: State; readonly holdsQuit: boolean; readonly commands: readonly Command[] }

export function initialState(shown: boolean): State {
  return shown ? { status: "done" } : { status: "pending" }
}

export function transition(state: State, event: Event): Transition {
  if (event.type === "quit.requested") {
    if (state.status === "showing") return { state, holdsQuit: true, commands: [] }

    if (state.status === "done") return { state, holdsQuit: false, commands: [] }

    // Someone who already turned the service off has nothing to be told.
    if (!event.keepRunning)
      return { state: { status: "done" }, holdsQuit: false, commands: [{ type: "persist-shown" }] }

    return { state: { status: "showing" }, holdsQuit: true, commands: [{ type: "show" }] }
  }

  if (state.status !== "showing") return { state, holdsQuit: false, commands: [] }

  return {
    state: { status: "done" },
    holdsQuit: false,
    commands: [{ type: "persist-shown" }, { type: event.choice === "settings" ? "open-settings" : "quit" }],
  }
}
