import type { SessionInfo } from "@opencode/client/promise"

export const VIEW_RETRY_DELAY = 250

export const VIEW_RETRY_MAX_DELAY = 5_000

export const VIEW_RETRY_LIMIT = 6

// One root session's `session.view` report. `attempt` names one request, so a result for a watermark that a newer
// one replaced can never settle it. `reporting` covers both the request in flight and the backoff before a retry.
export type ViewReportState =
  | { readonly status: "unreported"; readonly attempt: number }
  | { readonly status: "reporting"; readonly idle: number; readonly attempt: number; readonly failures: number }
  | { readonly status: "reported"; readonly idle: number; readonly attempt: number }
  | { readonly status: "failed"; readonly idle: number; readonly attempt: number }
  | { readonly status: "disposed" }

export type ViewReportEvent =
  | { readonly type: "view"; readonly idle: number }
  | { readonly type: "report.succeeded"; readonly attempt: number }
  | { readonly type: "report.failed"; readonly attempt: number; readonly notFound: boolean }
  | { readonly type: "connected" }
  | { readonly type: "disposed" }

export type ViewReportEffect =
  | { readonly type: "send"; readonly idle: number; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "send.cancel" }
  | { readonly type: "forget" }

export type ViewReportTransition = {
  readonly state: ViewReportState
  readonly effects: readonly ViewReportEffect[]
}

export const INITIAL_VIEW_REPORT_STATE: ViewReportState = Object.freeze({ status: "unreported", attempt: 0 })

export function viewRetryDelay(failures: number) {
  return Math.min(VIEW_RETRY_DELAY * 2 ** (failures - 1), VIEW_RETRY_MAX_DELAY)
}

export function transitionViewReport(state: ViewReportState, event: ViewReportEvent): ViewReportTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") {
    return { state: { status: "disposed" }, effects: state.status === "reporting" ? [{ type: "send.cancel" }] : [] }
  }

  // Reactive callers view again whenever what they read changes; only a newer watermark starts a new report. A
  // report that gave up starts over on any view, so clicking the session again retries it.
  if (event.type === "view") {
    if ((state.status === "reporting" || state.status === "reported") && event.idle <= state.idle) {
      return { state, effects: [] }
    }

    const idle = state.status === "failed" ? Math.max(state.idle, event.idle) : event.idle

    return report(state, idle)
  }

  // A report that gave up while offline is retried once the connection is back.
  if (event.type === "connected") {
    if (state.status !== "failed") return { state, effects: [] }

    return report(state, state.idle)
  }

  if (state.status !== "reporting" || state.attempt !== event.attempt) return { state, effects: [] }

  if (event.type === "report.succeeded") {
    return { state: { status: "reported", idle: state.idle, attempt: state.attempt }, effects: [] }
  }

  if (event.notFound) return { state: { status: "unreported", attempt: state.attempt }, effects: [{ type: "forget" }] }

  if (state.failures >= VIEW_RETRY_LIMIT) {
    return { state: { status: "failed", idle: state.idle, attempt: state.attempt }, effects: [] }
  }

  const failures = state.failures + 1

  return {
    state: { ...state, failures },
    effects: [{ type: "send", idle: state.idle, attempt: state.attempt, delayMs: viewRetryDelay(failures) }],
  }
}

function report(state: Exclude<ViewReportState, { status: "disposed" }>, idle: number): ViewReportTransition {
  const attempt = state.attempt + 1
  const send: ViewReportEffect = { type: "send", idle, attempt, delayMs: 0 }

  return {
    state: { status: "reporting", idle, attempt, failures: 0 },
    effects: state.status === "reporting" ? [{ type: "send.cancel" }, send] : [send],
  }
}

// The carry-over waits this long after connecting so it doesn't compete with startup requests.
export const LEGACY_MIGRATION_DELAY = 5_000

export const LEGACY_MIGRATION_RETRY_MAX_DELAY = 30_000

export const LEGACY_MIGRATION_RETRY_LIMIT = 3

export type LegacyListItem = {
  readonly session?: string
  readonly viewed: boolean
}

export type LegacyCarry = {
  // Sessions the old list still had unread.
  readonly unseen: ReadonlySet<string>
  // When this client first found the list. Sessions that went idle later are new, whatever the list says.
  readonly started: number
}

export type LegacyViewReport = {
  readonly sessionID: string
  readonly idle: number
}

// The background carry-over of the list Desktop kept before unread state moved to the server. `reported` keeps the
// watermarks it posted, so rows drawn from an older fetched copy of a session stay read after the list is deleted.
// `migrating` covers the delay before a run and the run itself.
export type LegacyMigrationState =
  | { readonly status: "loading" }
  | {
      readonly status: "idle"
      readonly carry: LegacyCarry
      readonly reported: ReadonlyMap<string, number>
      readonly attempt: number
    }
  | {
      readonly status: "migrating"
      readonly carry: LegacyCarry
      readonly reported: ReadonlyMap<string, number>
      readonly attempt: number
      readonly failures: number
    }
  | { readonly status: "done"; readonly reported: ReadonlyMap<string, number> }
  | { readonly status: "disposed" }

export type LegacyMigrationEvent =
  | {
      readonly type: "hydrated"
      readonly list: readonly LegacyListItem[] | undefined
      readonly started: number | undefined
      readonly now: number
      readonly connected: boolean
    }
  | { readonly type: "connection.changed"; readonly connected: boolean }
  | { readonly type: "sessions.reported"; readonly reports: readonly LegacyViewReport[] }
  | { readonly type: "run.succeeded"; readonly attempt: number }
  | { readonly type: "run.failed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type LegacyMigrationEffect =
  | { readonly type: "persist.started"; readonly started: number }
  | { readonly type: "persist.remove" }
  | { readonly type: "run"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "run.cancel" }

export type LegacyMigrationTransition = {
  readonly state: LegacyMigrationState
  readonly effects: readonly LegacyMigrationEffect[]
}

export const INITIAL_LEGACY_MIGRATION_STATE: LegacyMigrationState = Object.freeze({ status: "loading" })

const EMPTY_REPORTED: ReadonlyMap<string, number> = new Map()

export function legacyRetryDelay(failures: number) {
  return Math.min(LEGACY_MIGRATION_DELAY * 2 ** (failures - 1), LEGACY_MIGRATION_RETRY_MAX_DELAY)
}

export function transitionLegacyMigration(
  state: LegacyMigrationState,
  event: LegacyMigrationEvent,
): LegacyMigrationTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") {
    return { state: { status: "disposed" }, effects: state.status === "migrating" ? [{ type: "run.cancel" }] : [] }
  }

  if (state.status === "loading") {
    if (event.type !== "hydrated") return { state, effects: [] }

    return hydrate(event)
  }

  if (event.type === "hydrated") return { state, effects: [] }

  // A report the server saved stays recorded even when the run that made it was cancelled or failed. A run records
  // each page's reports in one event, so unread readers re-run once per page rather than once per session.
  if (event.type === "sessions.reported") {
    const updates = event.reports.filter((report) => report.idle > (state.reported.get(report.sessionID) ?? -Infinity))

    if (updates.length === 0) return { state, effects: [] }

    const reported = new Map(state.reported)

    updates.forEach((report) =>
      reported.set(report.sessionID, Math.max(report.idle, reported.get(report.sessionID) ?? -Infinity)),
    )

    return { state: { ...state, reported }, effects: [] }
  }

  if (state.status === "done") return { state, effects: [] }

  if (event.type === "connection.changed") {
    if (event.connected && state.status === "idle") return migrate(state, state.attempt + 1, 0, LEGACY_MIGRATION_DELAY)

    if (!event.connected && state.status === "migrating") {
      return {
        state: { status: "idle", carry: state.carry, reported: state.reported, attempt: state.attempt },
        effects: [{ type: "run.cancel" }],
      }
    }

    return { state, effects: [] }
  }

  if (state.status !== "migrating" || state.attempt !== event.attempt) return { state, effects: [] }

  if (event.type === "run.succeeded") {
    return { state: { status: "done", reported: state.reported }, effects: [{ type: "persist.remove" }] }
  }

  // After the last retry the list is kept, and the next connection tries again.
  if (state.failures >= LEGACY_MIGRATION_RETRY_LIMIT) {
    return {
      state: { status: "idle", carry: state.carry, reported: state.reported, attempt: state.attempt },
      effects: [],
    }
  }

  const failures = state.failures + 1

  return migrate(state, state.attempt + 1, failures, legacyRetryDelay(failures))
}

function hydrate(event: Extract<LegacyMigrationEvent, { type: "hydrated" }>): LegacyMigrationTransition {
  if (!event.list) return { state: { status: "done", reported: EMPTY_REPORTED }, effects: [] }

  const started = event.started ?? event.now

  const state: LegacyMigrationState = {
    status: "idle",
    carry: {
      unseen: new Set(event.list.flatMap((item) => (!item.viewed && item.session ? [item.session] : []))),
      started,
    },
    reported: EMPTY_REPORTED,
    attempt: 0,
  }

  const persist: LegacyMigrationEffect[] = event.started === undefined ? [{ type: "persist.started", started }] : []

  if (!event.connected) return { state, effects: persist }

  const next = migrate(state, 1, 0, LEGACY_MIGRATION_DELAY)

  return { state: next.state, effects: [...persist, ...next.effects] }
}

function migrate(
  state: Extract<LegacyMigrationState, { status: "idle" | "migrating" }>,
  attempt: number,
  failures: number,
  delayMs: number,
): LegacyMigrationTransition {
  return {
    state: { status: "migrating", carry: state.carry, reported: state.reported, attempt, failures },
    effects: [{ type: "run", attempt, delayMs }],
  }
}

type SessionTime = Pick<SessionInfo["time"], "idle" | "viewed">

type UnreadSession = { readonly id: string; readonly time: SessionTime }

/** A session is unread on the server when its latest terminal execution is newer than the last one any client viewed. */
export function isSessionUnread(session?: { readonly time: SessionTime }) {
  const time = session?.time

  return time?.idle !== undefined && (time.viewed === undefined || time.idle > time.viewed)
}

/** Whether the session shows unread here, honouring the old local list until its viewed state reaches the server. */
export function selectSessionUnread(state: LegacyMigrationState, session?: UnreadSession) {
  // Until the old list is read, a session it had read could flash unread.
  if (state.status === "loading" || state.status === "disposed") return false

  const idle = session?.time.idle

  if (!session || idle === undefined || !isSessionUnread(session)) return false

  if (idle <= (state.reported.get(session.id) ?? -Infinity)) return false

  if (state.status === "done") return true

  return state.carry.unseen.has(session.id) || idle > state.carry.started
}

/** Sessions on a fetched page that the server has unread but this client shows read: the carry-over reports these. */
export function selectLegacyHiddenReports(state: LegacyMigrationState, sessions: readonly UnreadSession[]) {
  return sessions.flatMap((session) =>
    session.time.idle !== undefined && isSessionUnread(session) && !selectSessionUnread(state, session)
      ? [{ sessionID: session.id, idle: session.time.idle }]
      : [],
  )
}
