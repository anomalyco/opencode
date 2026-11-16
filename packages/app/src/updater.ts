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
  // Downloaded. The user is asked, and nothing installs until they choose. `quit` is false where OpenCode 2 cannot
  // install while the app quits, so only a restart is offered. `stopped` is set once a restart failed after the app's
  // servers shut down: the app has to restart before it works again.
  | { status: "ready"; quit: boolean; stopped?: boolean }
  // The user chose to upgrade when the app quits, and the install is being armed. On macOS this lasts as long as the
  // system updater needs to unpack and verify OpenCode 2.
  | { status: "scheduling" }
  // The user chose to upgrade when the app quits.
  | { status: "scheduled"; stopped?: boolean }
  // The user chose to restart. The app is shutting down to install OpenCode 2.
  | { status: "installing" }

// Why a window opens the offer by itself: it is the one window that does so right after the app starts, or the user
// asked for the offer while no window was open.
export type MajorUpdatePrompt = "launch" | "asked" | undefined

export type MajorUpdaterPlatform = {
  state: Accessor<MajorUpdateState>
  /** Asks the app whether this window opens the offer by itself. At most one window per launch gets an answer. */
  prompt(): Promise<MajorUpdatePrompt>
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
