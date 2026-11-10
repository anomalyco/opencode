import type { ImportResult, InstallResult } from "./profile/ipc"

/** One thing the Browser settings page asks main to do. */
export type Job =
  | { readonly type: "import-browser"; readonly source: string; readonly profile: string }
  | { readonly type: "import-file"; readonly path: string }
  | { readonly type: "install-store"; readonly url: string }
  | { readonly type: "install-folder"; readonly path: string }
  | { readonly type: "install-browser"; readonly source: string; readonly profile: string; readonly id: string }
  | { readonly type: "remove"; readonly id: string }
  | { readonly type: "enable"; readonly id: string; readonly enabled: boolean }
  | { readonly type: "clear" }

/** What the last job ended with, for the page to say. */
export type Outcome =
  | { readonly type: "imported"; readonly result: ImportResult }
  | { readonly type: "installed"; readonly result: InstallResult }
  | { readonly type: "cleared" }
  /** An extension was removed, or turned on or off; the list shows it, so there is nothing to say. */
  | { readonly type: "changed" }
  /** The call rejected or timed out: main is gone, or the job did not answer in time. */
  | { readonly type: "error" }

/**
 * The page runs one job at a time, so two imports never write the profile at once.
 * - `idle`: nothing runs; `outcome` is the last job's, until the next one starts.
 * - `running`: `job` runs as `attempt`; a result of any other attempt is stale.
 */
export type SettingsState =
  | { readonly status: "idle"; readonly attempt: number; readonly outcome: Outcome | undefined }
  | { readonly status: "running"; readonly attempt: number; readonly job: Job }
  | { readonly status: "disposed" }

export type SettingsEvent =
  | { readonly type: "started"; readonly job: Job }
  | { readonly type: "finished"; readonly attempt: number; readonly outcome: Outcome }
  | { readonly type: "failed"; readonly attempt: number }
  | { readonly type: "timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type SettingsEffect =
  | { readonly type: "run"; readonly attempt: number; readonly job: Job; readonly timeoutMs: number }
  /** Ends the attempt's timer and drops its call's reply. */
  | { readonly type: "abort"; readonly attempt: number }
  /** The profile changed: read its cookie count and lists again. */
  | { readonly type: "refresh" }

/**
 * How long a job may run. An import may wait on the user at a Keychain or keyring prompt, and a store install
 * downloads the package.
 */
export const JOB_TIMEOUT_MS: Record<Job["type"], number> = {
  "import-browser": 300_000,
  "import-file": 60_000,
  "install-store": 120_000,
  "install-folder": 60_000,
  "install-browser": 60_000,
  remove: 30_000,
  enable: 30_000,
  clear: 60_000,
}

export type SettingsTransition = { readonly state: SettingsState; readonly effects: readonly SettingsEffect[] }

export const initialSettingsState: SettingsState = { status: "idle", attempt: 0, outcome: undefined }

export function transitionSettings(state: SettingsState, event: SettingsEvent): SettingsTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: state.status === "running" ? [{ type: "abort", attempt: state.attempt }] : [],
    }

  if (event.type === "started") {
    if (state.status === "running") return { state, effects: [] }
    const attempt = state.attempt + 1

    return {
      state: { status: "running", attempt, job: event.job },
      effects: [{ type: "run", attempt, job: event.job, timeoutMs: JOB_TIMEOUT_MS[event.job.type] }],
    }
  }

  if (state.status !== "running" || event.attempt !== state.attempt) return { state, effects: [] }
  const outcome: Outcome = event.type === "finished" ? event.outcome : { type: "error" }

  // A timed-out job may still finish in main, so the page reads the profile again either way.
  return {
    state: { status: "idle", attempt: state.attempt, outcome },
    effects: [{ type: "abort", attempt: state.attempt }, { type: "refresh" }],
  }
}

/** The job that runs, so its button shows busy; every other action waits for it. */
export function runningJob(state: SettingsState) {
  return state.status === "running" ? state.job : undefined
}

export function lastOutcome(state: SettingsState) {
  return state.status === "idle" ? state.outcome : undefined
}
