import type { BrowseInstallFailure, BrowseInstallJob } from "../../shared/ipc-contract"

/**
 * The browse installer that Settings → Extensions starts. One runs at a time: two would write the same binary and
 * agent configs, and race to pair the browser. A failure stays until the next attempt so every window can show it.
 */
export type BrowseInstallState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "installing"; readonly attempt: number }
  | { readonly status: "failed"; readonly attempt: number; readonly failure: BrowseInstallFailure }
  | { readonly status: "disposed" }

export type BrowseInstallEvent =
  | { readonly type: "install.requested" }
  | { readonly type: "install.succeeded"; readonly attempt: number }
  /** Any failure, timeout or defect of the installer. */
  | { readonly type: "install.failed"; readonly attempt: number; readonly failure: BrowseInstallFailure }
  | { readonly type: "disposed" }

export type BrowseInstallCommand = { readonly type: "run-install"; readonly attempt: number }

export type BrowseInstallTransition = {
  readonly state: BrowseInstallState
  readonly commands: readonly BrowseInstallCommand[]
}

export function initialBrowseInstallState(): BrowseInstallState {
  return { status: "idle", attempt: 0 }
}

export function transitionBrowseInstall(state: BrowseInstallState, event: BrowseInstallEvent): BrowseInstallTransition {
  if (state.status === "disposed") return unchanged(state)

  // Closing the owner's scope interrupts the installer.
  if (event.type === "disposed") return { state: { status: "disposed" }, commands: [] }

  if (event.type === "install.requested") {
    if (state.status === "installing") return unchanged(state)

    const attempt = state.attempt + 1

    return { state: { status: "installing", attempt }, commands: [{ type: "run-install", attempt }] }
  }

  if (state.status !== "installing" || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "install.succeeded") return { state: { status: "idle", attempt: state.attempt }, commands: [] }

  return { state: { status: "failed", attempt: state.attempt, failure: event.failure }, commands: [] }
}

export function browseInstallJob(state: BrowseInstallState): BrowseInstallJob {
  if (state.status === "installing") return { status: "installing" }

  if (state.status === "failed") return { status: "failed", failure: state.failure }

  return { status: "idle" }
}

function unchanged(state: BrowseInstallState): BrowseInstallTransition {
  return { state, commands: [] }
}
