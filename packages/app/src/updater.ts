import type { Accessor } from "solid-js"

export type UpdaterState =
  | { status: "disabled" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading"; version: string; percent?: number }
  | { status: "ready"; version: string }
  | { status: "up-to-date" }
  | { status: "installing"; version: string }
  | { status: "error"; message: string }

// A newer OpenCode 1 release wins; OpenCode 2.0 is only offered once OpenCode 1 is up to date.
export type MajorUpdateState =
  | { status: "unavailable" }
  // OpenCode 2 downloads in the background, like an OpenCode 1 update. Nothing is offered yet.
  | { status: "downloading" }
  // Downloaded. The user is asked, and nothing installs until they choose.
  | { status: "ready" }
  // The user chose to upgrade when the app quits.
  | { status: "scheduled" }

export type MajorUpdaterPlatform = {
  state: Accessor<MajorUpdateState>
  /** Resolves true for one window per launch, so restored windows don't each open the offer. */
  prompt(): Promise<boolean>
  /** Quits, installs OpenCode 2 and opens it. */
  restart(): Promise<void>
  /** Installs OpenCode 2 when the app next quits. */
  schedule(): Promise<void>
}

export type UpdaterPlatform = {
  state: Accessor<UpdaterState>
  check(): Promise<UpdaterState>
  install(): Promise<void>
  major?: MajorUpdaterPlatform
}
