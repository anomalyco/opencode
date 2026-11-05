import type { UpdaterState } from "@opencode/plugin/gui/updater"

// Main bounds its own update check; this covers a bridge that never answers after the crash.
export const ERROR_ACTION_TIMEOUT_MS = 30_000

// Export Logs waits this long for the crash to reach the log before it exports anyway.
export const FATAL_RECORD_TIMEOUT_MS = 2_000

/** Whether the crash reached the main-process log: `pending` until it has, so Export Logs records it first. */
export type ErrorFatalStatus = "pending" | "recording" | "recorded"

/** `unavailable` while Sentry is off or still loading; `reported` once the user sent this error. */
export type ErrorReportStatus = "unavailable" | "ready" | "reported"

type ErrorPageFields = {
  readonly attempt: number
  readonly fatalAttempt: number
  readonly fatal: ErrorFatalStatus
  readonly report: ErrorReportStatus
}

/**
 * The crash page's actions. One action runs at a time; `failed` shows its error until the next action starts or
 * another error is shown.
 */
export type ErrorPageState =
  | (ErrorPageFields & { readonly status: "idle" })
  | (ErrorPageFields & { readonly status: "checking" })
  | (ErrorPageFields & { readonly status: "installing" })
  | (ErrorPageFields & { readonly status: "exporting" })
  | (ErrorPageFields & { readonly status: "failed"; readonly error: string })
  | { readonly status: "disposed" }

export type ErrorPageEvent =
  /** The page shows an error: on mount, and again when the boundary passes a new one. */
  | { readonly type: "error.presented" }
  | { readonly type: "fatal.settled"; readonly attempt: number; readonly recorded: boolean }
  | { readonly type: "sentry.loaded"; readonly enabled: boolean }
  | { readonly type: "report.clicked" }
  /** `available` is false without an updater; `busy` while the updater itself checks, downloads or installs. */
  | { readonly type: "check.clicked"; readonly available: boolean; readonly busy: boolean }
  | { readonly type: "install.clicked"; readonly available: boolean; readonly busy: boolean }
  | { readonly type: "export.clicked"; readonly available: boolean }
  | { readonly type: "action.succeeded"; readonly attempt: number }
  | { readonly type: "action.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "action.timed-out"; readonly attempt: number; readonly error: string }
  | { readonly type: "disposed" }

export type ErrorPageEffect =
  | { readonly type: "fatal.record"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "sentry.capture" }
  | { readonly type: "updater.check"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "updater.install"; readonly attempt: number; readonly timeoutMs: number }
  /** `recordFirst` records the crash first, bounded by `recordTimeoutMs`, so the exported log holds it. */
  | {
      readonly type: "logs.export"
      readonly attempt: number
      readonly fatalAttempt: number
      readonly recordFirst: boolean
      readonly recordTimeoutMs: number
    }

export type ErrorPageTransition = {
  readonly state: ErrorPageState
  readonly effects: readonly ErrorPageEffect[]
}

export const INITIAL_ERROR_PAGE_STATE: ErrorPageState = Object.freeze({
  status: "idle",
  attempt: 0,
  fatalAttempt: 0,
  fatal: "pending",
  report: "unavailable",
})

const DISPOSED: ErrorPageState = Object.freeze({ status: "disposed" })

const NONE: readonly ErrorPageEffect[] = []

export function transitionErrorPage(state: ErrorPageState, event: ErrorPageEvent): ErrorPageTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: DISPOSED, effects: NONE }

  if (event.type === "error.presented") {
    // A new error gets its own record and report, and drops the previous action's error. An action still running
    // stays busy until it settles: it acts on the app, not on the error, and a second one must not start beside it.
    const attempt = state.fatalAttempt + 1

    return {
      state: {
        status: state.status === "failed" ? "idle" : state.status,
        attempt: state.attempt,
        fatalAttempt: attempt,
        fatal: "recording",
        report: state.report === "unavailable" ? "unavailable" : "ready",
      },
      effects: [{ type: "fatal.record", attempt, timeoutMs: FATAL_RECORD_TIMEOUT_MS }],
    }
  }

  if (event.type === "fatal.settled") {
    if (event.attempt !== state.fatalAttempt || state.fatal === "recorded") return unchanged(state)
    // A record that answers after its timeout still counts, so Export Logs does not record it twice.
    const fatal = event.recorded ? "recorded" : "pending"

    return fatal === state.fatal ? unchanged(state) : { state: { ...state, fatal }, effects: NONE }
  }

  if (event.type === "sentry.loaded")
    return event.enabled && state.report === "unavailable"
      ? { state: { ...state, report: "ready" }, effects: NONE }
      : unchanged(state)

  if (event.type === "report.clicked")
    return state.report === "ready"
      ? { state: { ...state, report: "reported" }, effects: [{ type: "sentry.capture" }] }
      : unchanged(state)

  if (event.type === "check.clicked" || event.type === "install.clicked" || event.type === "export.clicked")
    return start(state, event)

  if (!isBusy(state) || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "action.succeeded") return { state: { ...fields(state), status: "idle" }, effects: NONE }

  return { state: { ...fields(state), status: "failed", error: event.error }, effects: NONE }
}

export function selectCanReport(state: ErrorPageState) {
  return state.status !== "disposed" && state.report !== "unavailable"
}

export function selectReported(state: ErrorPageState) {
  return state.status !== "disposed" && state.report === "reported"
}

export function selectReportDisabled(state: ErrorPageState) {
  return state.status === "disposed" || state.report !== "ready"
}

export function selectExportDisabled(state: ErrorPageState) {
  return state.status === "disposed" || isBusy(state)
}

export function selectUpdateVersion(updater: UpdaterState | undefined) {
  return updater?.status === "ready" || updater?.status === "download-required" ? updater.version : undefined
}

export function selectCheckingUpdates(state: ErrorPageState, updater: UpdaterState | undefined) {
  return state.status === "checking" || updater?.status === "checking"
}

export function selectCheckUpdatesDisabled(state: ErrorPageState, updater: UpdaterState | undefined) {
  return state.status === "disposed" || isBusy(state) || isUpdaterBusy(updater)
}

export function selectInstallUpdateDisabled(state: ErrorPageState, updater: UpdaterState | undefined) {
  return state.status === "disposed" || isBusy(state) || updater?.status === "installing"
}

export function selectActionError(state: ErrorPageState) {
  return state.status === "failed" ? state.error : undefined
}

export function isUpdaterBusy(updater: UpdaterState | undefined) {
  return updater?.status === "checking" || updater?.status === "downloading" || updater?.status === "installing"
}

type LiveState = Exclude<ErrorPageState, { status: "disposed" }>

function start(
  state: LiveState,
  event: Extract<ErrorPageEvent, { type: "check.clicked" | "install.clicked" | "export.clicked" }>,
): ErrorPageTransition {
  // The first click claims the action; a double click, or another action meanwhile, waits for it.
  if (isBusy(state) || !event.available || (event.type !== "export.clicked" && event.busy)) return unchanged(state)
  const attempt = state.attempt + 1
  const next = { ...fields(state), attempt }

  if (event.type === "check.clicked")
    return {
      state: { ...next, status: "checking" },
      effects: [{ type: "updater.check", attempt, timeoutMs: ERROR_ACTION_TIMEOUT_MS }],
    }

  if (event.type === "install.clicked")
    return {
      state: { ...next, status: "installing" },
      effects: [{ type: "updater.install", attempt, timeoutMs: ERROR_ACTION_TIMEOUT_MS }],
    }

  return {
    state: { ...next, status: "exporting" },
    effects: [
      {
        type: "logs.export",
        attempt,
        fatalAttempt: state.fatalAttempt,
        recordFirst: state.fatal !== "recorded",
        recordTimeoutMs: FATAL_RECORD_TIMEOUT_MS,
      },
    ],
  }
}

function isBusy(state: ErrorPageState) {
  return state.status === "checking" || state.status === "installing" || state.status === "exporting"
}

function fields(state: LiveState): ErrorPageFields {
  return { attempt: state.attempt, fatalAttempt: state.fatalAttempt, fatal: state.fatal, report: state.report }
}

function unchanged(state: ErrorPageState): ErrorPageTransition {
  return { state, effects: NONE }
}
