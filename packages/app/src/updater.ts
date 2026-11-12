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
  | { status: "available" }
  | { status: "installing" }
  | { status: "installed" }
  | { status: "failed"; message?: string }

export type MajorUpdaterPlatform = {
  state: Accessor<MajorUpdateState>
  /** Resolves true for one window per launch, so restored windows don't each open the offer. */
  prompt(): Promise<boolean>
  install(): Promise<void>
  restart(): Promise<void>
}

export type UpdaterPlatform = {
  state: Accessor<UpdaterState>
  check(): Promise<UpdaterState>
  install(): Promise<void>
  major?: MajorUpdaterPlatform
}
