export type InstallCliOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string }

/**
 * The macOS `Install CLI…` menu action. One installer runs at a time, and a click while it runs or while its result
 * dialog is open does nothing: two installers would write the same `~/.opencode/bin/opencode` and shell profiles.
 */
export type InstallCliState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "installing"; readonly attempt: number }
  | { readonly status: "presenting"; readonly attempt: number; readonly outcome: InstallCliOutcome }
  | { readonly status: "disposed" }

export type InstallCliEvent =
  | { readonly type: "install.requested" }
  | { readonly type: "install.succeeded"; readonly attempt: number; readonly path: string }
  /** Any failure, timeout or defect of the install. */
  | { readonly type: "install.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "dialog.dismissed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type InstallCliCommand =
  | { readonly type: "run-install"; readonly attempt: number }
  | { readonly type: "show-dialog"; readonly attempt: number; readonly outcome: InstallCliOutcome }

export type InstallCliTransition = { readonly state: InstallCliState; readonly commands: readonly InstallCliCommand[] }

export function initialInstallCliState(): InstallCliState {
  return { status: "idle", attempt: 0 }
}

export function transitionInstallCli(state: InstallCliState, event: InstallCliEvent): InstallCliTransition {
  if (state.status === "disposed") return unchanged(state)

  // Closing the owner's scope interrupts the install and its dialog.
  if (event.type === "disposed") return { state: { status: "disposed" }, commands: [] }

  if (event.type === "install.requested") {
    if (state.status !== "idle") return unchanged(state)

    const attempt = state.attempt + 1

    return { state: { status: "installing", attempt }, commands: [{ type: "run-install", attempt }] }
  }

  if (event.attempt !== state.attempt) return unchanged(state)

  if (state.status === "installing" && event.type !== "dialog.dismissed") {
    const outcome: InstallCliOutcome =
      event.type === "install.succeeded" ? { ok: true, path: event.path } : { ok: false, error: event.error }

    return {
      state: { status: "presenting", attempt: state.attempt, outcome },
      commands: [{ type: "show-dialog", attempt: state.attempt, outcome }],
    }
  }

  if (state.status === "presenting" && event.type === "dialog.dismissed")
    return { state: { status: "idle", attempt: state.attempt }, commands: [] }

  return unchanged(state)
}

function unchanged(state: InstallCliState): InstallCliTransition {
  return { state, commands: [] }
}
