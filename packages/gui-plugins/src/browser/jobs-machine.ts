import type { ImportResult, InstallResult } from "./profile/ipc"

/** One thing a surface asks main to do with the browser profile: the settings page, or the pane's import prompt. */
export type Job =
  /**
   * A browser profile's sign-ins and browsing history, or with `sites` only those of the sites the user chose. Both
   * come unless the person unticked one in the import dialog: `signins` false leaves the cookies behind, `history`
   * false the history.
   */
  | {
      readonly type: "import-browser"
      readonly source: string
      readonly profile: string
      readonly sites?: readonly string[]
      readonly signins?: boolean
      readonly history?: boolean
    }
  | { readonly type: "import-file"; readonly path: string }
  | { readonly type: "install-store"; readonly url: string; readonly token?: string }
  | { readonly type: "install-folder"; readonly path: string; readonly token?: string }
  | {
      readonly type: "install-browser"
      readonly source: string
      readonly profile: string
      readonly id: string
      readonly token?: string
    }
  | { readonly type: "remove"; readonly id: string }
  | { readonly type: "enable"; readonly id: string; readonly enabled: boolean }
  | { readonly type: "clear" }

/** How a job ended. */
export type Outcome =
  | { readonly type: "imported"; readonly result: ImportResult }
  | { readonly type: "installed"; readonly result: InstallResult }
  /** Signed out everywhere; `history` is whether the browsing history went too. */
  | { readonly type: "cleared"; readonly history: boolean }
  /** An extension was removed, or turned on or off; the list shows it, so there is nothing to say. */
  | { readonly type: "changed" }
  /** The call rejected or timed out: main is gone, or the job did not answer in time. */
  | { readonly type: "error" }

/** The last job a surface ran and how it ended, so the surface can say it beside what the user pressed. */
export type Finished = { readonly job: Job; readonly outcome: Outcome }

/**
 * A surface runs one job at a time; main runs the jobs of every surface one after another.
 * - `idle`: nothing runs; `last` is the previous job and its outcome, until the next one starts.
 * - `confirming`: the person is asked whether `job` should run, as `attempt`; nothing has run yet, and `last` comes
 *   back if they say no. An answer to any other attempt is stale.
 * - `running`: `job` runs as `attempt`; a result of any other attempt is stale.
 */
export type JobsState =
  | { readonly status: "idle"; readonly attempt: number; readonly last: Finished | undefined }
  | { readonly status: "confirming"; readonly attempt: number; readonly job: Job; readonly last: Finished | undefined }
  | { readonly status: "running"; readonly attempt: number; readonly job: Job }
  | { readonly status: "disposed" }

export type JobsEvent =
  | { readonly type: "started"; readonly job: Job }
  /** The person answered the question of `attempt`. Closing the question any other way is a no. */
  | { readonly type: "answered"; readonly attempt: number; readonly confirmed: boolean }
  | { readonly type: "finished"; readonly attempt: number; readonly outcome: Outcome }
  | { readonly type: "failed"; readonly attempt: number }
  | { readonly type: "timed-out"; readonly attempt: number }
  /** The user closed the message of the last job. */
  | { readonly type: "dismissed" }
  | { readonly type: "disposed" }

export type JobsEffect =
  /** Asks the person whether `job` should run; the answer names `attempt`. */
  | { readonly type: "confirm"; readonly attempt: number; readonly job: Job }
  | { readonly type: "run"; readonly attempt: number; readonly job: Job; readonly timeoutMs: number }
  /** Ends the attempt's timer and drops its call's reply. */
  | { readonly type: "abort"; readonly attempt: number }
  /** The job ended: tell the surface, which reads the profile again and acts on the outcome. */
  | { readonly type: "notify"; readonly finished: Finished }

export type JobsTransition = { readonly state: JobsState; readonly effects: readonly JobsEffect[] }

/**
 * How long a job may run. An import may wait on the user at a Keychain or keyring prompt, and a store install
 * downloads the package.
 */
const JOB_TIMEOUT_MS: Record<Job["type"], number> = {
  "import-browser": 300_000,
  "import-file": 60_000,
  "install-store": 120_000,
  "install-folder": 60_000,
  "install-browser": 60_000,
  remove: 30_000,
  enable: 30_000,
  clear: 60_000,
}

export const initialJobsState: JobsState = { status: "idle", attempt: 0, last: undefined }

export function transitionJobs(state: JobsState, event: JobsEvent): JobsTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: state.status === "running" ? [{ type: "abort", attempt: state.attempt }] : [],
    }

  if (event.type === "dismissed") {
    if (state.status !== "idle" || !state.last) return { state, effects: [] }

    return { state: { status: "idle", attempt: state.attempt, last: undefined }, effects: [] }
  }

  if (event.type === "started") {
    // One job at a time: a second press while one runs, or while its question is open, starts nothing.
    if (state.status !== "idle") return { state, effects: [] }
    const attempt = state.attempt + 1

    // What a job deletes cannot be brought back, so it asks first, wherever it was started from.
    if (deletes(event.job))
      return { state: { status: "confirming", attempt, job: event.job, last: state.last }, effects: [{ type: "confirm", attempt, job: event.job }] }

    return run(attempt, event.job)
  }

  if (event.type === "answered") {
    if (state.status !== "confirming" || event.attempt !== state.attempt) return { state, effects: [] }

    if (event.confirmed) return run(state.attempt, state.job)

    // Nothing ran: the surface is as it was before the question.
    return { state: { status: "idle", attempt: state.attempt, last: state.last }, effects: [] }
  }

  if (state.status !== "running" || event.attempt !== state.attempt) return { state, effects: [] }
  const outcome: Outcome = event.type === "finished" ? event.outcome : { type: "error" }
  const finished = { job: state.job, outcome }

  // A timed-out job may still finish in main, so the surface reads the profile again either way.
  return {
    state: { status: "idle", attempt: state.attempt, last: finished },
    effects: [
      { type: "abort", attempt: state.attempt },
      { type: "notify", finished },
    ],
  }
}

/** The job that runs, so its button shows busy; every other action waits for it. */
export function runningJob(state: JobsState) {
  return state.status === "running" ? state.job : undefined
}

/** The last job and its outcome, which stay on the surface while the person is asked about the next one. */
export function lastFinished(state: JobsState) {
  return state.status === "idle" || state.status === "confirming" ? state.last : undefined
}

/** Whether a job deletes what cannot be brought back, so the person is asked before it runs. */
function deletes(job: Job) {
  return job.type === "clear"
}

function run(attempt: number, job: Job): JobsTransition {
  return { state: { status: "running", attempt, job }, effects: [{ type: "run", attempt, job, timeoutMs: JOB_TIMEOUT_MS[job.type] }] }
}

/** Whether an import wrote cookies, so the user is signed in where the other browser was. */
export function importedCookies(outcome: Outcome) {
  return outcome.type === "imported" && outcome.result.type === "imported" ? outcome.result.imported : 0
}

/**
 * Counts cookies that genuinely could not be imported (`failed` or app-bound `protected`), ignoring `skipped` expired
 * or third-party partitioned leftovers. Give encryption-specific advice only when it accounts for every cookie that
 * stayed behind.
 */
export function importLoss(result: Extract<ImportResult, { type: "imported" }>) {
  if (result.failed) return { reason: "other", count: result.failed + result.protected } as const

  if (result.protected) return { reason: "protected", count: result.protected } as const
}
