import { describe, expect, test } from "bun:test"
import {
  INITIAL_LEGACY_MIGRATION_STATE,
  INITIAL_VIEW_REPORT_STATE,
  selectLegacyHiddenReports,
  selectSessionUnread,
  transitionLegacyMigration,
  transitionViewReport,
  type LegacyMigrationEvent,
  type LegacyMigrationState,
  type LegacyMigrationTransition,
  type ViewReportEvent,
  type ViewReportState,
  type ViewReportTransition,
} from "./machine"

function replayView(events: ViewReportEvent[], from = INITIAL_VIEW_REPORT_STATE) {
  return events.reduce<ViewReportTransition[]>((steps, event) => {
    steps.push(transitionViewReport(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

function replayLegacy(events: LegacyMigrationEvent[], from = INITIAL_LEGACY_MIGRATION_STATE) {
  return events.reduce<LegacyMigrationTransition[]>((steps, event) => {
    steps.push(transitionLegacyMigration(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

const failed = (attempt: number): ViewReportEvent => ({ type: "report.failed", attempt, notFound: false })

const reporting = (idle: number, attempt: number, failures = 0): ViewReportState => ({
  status: "reporting",
  idle,
  attempt,
  failures,
})

describe("transitionViewReport", () => {
  test("a one-shot view retries on its own until the report lands", () => {
    // Menu and Inbox actions call markViewed once from an event handler; nothing re-runs them after a failure.
    const steps = replayView([{ type: "view", idle: 2 }, failed(1), { type: "report.succeeded", attempt: 1 }])

    expect(steps.map((step) => step.state)).toEqual([
      reporting(2, 1),
      reporting(2, 1, 1),
      { status: "reported", idle: 2, attempt: 1 },
    ])
    expect(steps.map((step) => step.effects)).toEqual([
      [{ type: "send", idle: 2, attempt: 1, delayMs: 0 }],
      [{ type: "send", idle: 2, attempt: 1, delayMs: 250 }],
      [],
    ])
  })

  test("backs off per root, gives up after the limit, and starts over on reconnect or a new view", () => {
    const steps = replayView([{ type: "view", idle: 2 }, ...Array.from({ length: 7 }, () => failed(1))])

    expect(steps.slice(1, 7).map((step) => step.effects[0])).toEqual(
      [250, 500, 1000, 2000, 4000, 5000].map((delayMs) => ({ type: "send", idle: 2, attempt: 1, delayMs })),
    )
    const gaveUp = steps.at(-1)!
    expect(gaveUp).toEqual({ state: { status: "failed", idle: 2, attempt: 1 }, effects: [] })

    expect(transitionViewReport(gaveUp.state, { type: "connected" })).toEqual({
      state: reporting(2, 2),
      effects: [{ type: "send", idle: 2, attempt: 2, delayMs: 0 }],
    })
    // A view of an older copy still reports the newest watermark the failed report held.
    expect(transitionViewReport(gaveUp.state, { type: "view", idle: 1 })).toEqual({
      state: reporting(2, 2),
      effects: [{ type: "send", idle: 2, attempt: 2, delayMs: 0 }],
    })
    // The next failure after starting over waits the first delay again, not the cap.
    expect(transitionViewReport(reporting(2, 2), failed(2)).effects).toEqual([
      { type: "send", idle: 2, attempt: 2, delayMs: 250 },
    ])
  })

  test("a newer watermark replaces the report in flight and its late result is ignored", () => {
    const steps = replayView([{ type: "view", idle: 2 }, failed(1), { type: "view", idle: 6 }])

    expect(steps.at(-1)).toEqual({
      state: reporting(6, 2),
      effects: [{ type: "send.cancel" }, { type: "send", idle: 6, attempt: 2, delayMs: 0 }],
    })
    const current = steps.at(-1)!.state
    expect(transitionViewReport(current, { type: "report.succeeded", attempt: 1 }).state).toBe(current)
    expect(transitionViewReport(current, failed(1)).state).toBe(current)
  })

  test("re-running a view for a watermark already reported or in flight posts nothing", () => {
    const inFlight = reporting(2, 1)
    const reported: ViewReportState = { status: "reported", idle: 2, attempt: 1 }

    expect(transitionViewReport(inFlight, { type: "view", idle: 2 }).state).toBe(inFlight)
    expect(transitionViewReport(reported, { type: "view", idle: 2 }).state).toBe(reported)
    expect(transitionViewReport(reported, { type: "view", idle: 3 })).toEqual({
      state: reporting(3, 2),
      effects: [{ type: "send", idle: 3, attempt: 2, delayMs: 0 }],
    })
    expect(transitionViewReport(reported, { type: "connected" }).state).toBe(reported)
  })

  test("a deleted session is forgotten without a retry", () => {
    expect(transitionViewReport(reporting(2, 3, 2), { type: "report.failed", attempt: 3, notFound: true })).toEqual({
      state: { status: "unreported", attempt: 3 },
      effects: [{ type: "forget" }],
    })
  })

  const afterDispose: ViewReportEvent[] = [
    { type: "view", idle: 9 },
    failed(1),
    { type: "report.succeeded", attempt: 1 },
    { type: "connected" },
  ]

  test.each([
    [INITIAL_VIEW_REPORT_STATE, []],
    [reporting(2, 1, 1), [{ type: "send.cancel" }]],
    [{ status: "reported", idle: 2, attempt: 1 }, []],
    [{ status: "failed", idle: 2, attempt: 1 }, []],
  ] as const)("disposing from %o cancels pending work and ignores later results", (from, effects) => {
    const disposed = transitionViewReport(from, { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "disposed" }, effects })
    afterDispose.forEach((event) => expect(transitionViewReport(disposed.state, event).state).toBe(disposed.state))
  })
})

const list = [
  { session: "read-here", viewed: true },
  { session: "unread-here", viewed: false },
]

const hydrated = (connected: boolean, started?: number): LegacyMigrationEvent => ({
  type: "hydrated",
  list,
  started,
  now: 10,
  connected,
})

describe("transitionLegacyMigration", () => {
  test("a transient failure while connected retries with backoff, then ends in done", () => {
    const steps = replayLegacy([
      hydrated(true),
      { type: "session.reported", sessionID: "s1", idle: 5 },
      { type: "run.failed", attempt: 1 },
      { type: "run.succeeded", attempt: 2 },
    ])

    expect(steps[0]!.effects).toEqual([
      { type: "persist.started", started: 10 },
      { type: "run", attempt: 1, delayMs: 5000 },
    ])
    expect(steps[2]!.state).toMatchObject({ status: "migrating", attempt: 2, failures: 1 })
    expect(steps[2]!.effects).toEqual([{ type: "run", attempt: 2, delayMs: 5000 }])
    expect(steps[3]).toEqual({
      state: { status: "done", reported: new Map([["s1", 5]]) },
      effects: [{ type: "persist.remove" }],
    })
  })

  test("a disconnect cancels the run, ignores its late result, and the reconnect runs a new attempt", () => {
    const steps = replayLegacy([hydrated(true), { type: "connection.changed", connected: false }])
    const idle = steps.at(-1)!

    expect(idle.state).toMatchObject({ status: "idle", attempt: 1 })
    expect(idle.effects).toEqual([{ type: "run.cancel" }])
    expect(transitionLegacyMigration(idle.state, { type: "run.succeeded", attempt: 1 }).state).toBe(idle.state)
    expect(transitionLegacyMigration(idle.state, { type: "run.failed", attempt: 1 }).state).toBe(idle.state)
    expect(transitionLegacyMigration(idle.state, { type: "connection.changed", connected: true })).toMatchObject({
      state: { status: "migrating", attempt: 2, failures: 0 },
      effects: [{ type: "run", attempt: 2, delayMs: 5000 }],
    })
  })

  test("after the last retry it keeps the list and waits for the next connection", () => {
    const steps = replayLegacy([
      hydrated(true),
      ...[1, 2, 3, 4].map((attempt): LegacyMigrationEvent => ({ type: "run.failed", attempt })),
    ])

    expect(steps.slice(1, 4).map((step) => step.effects)).toEqual(
      [5000, 10000, 20000].map((delayMs, index) => [{ type: "run", attempt: index + 2, delayMs }]),
    )
    expect(steps.at(-1)).toMatchObject({ state: { status: "idle", attempt: 4 }, effects: [] })
  })

  test.each([
    ["no list", { ...hydrated(true), list: undefined }, { status: "done" }, []],
    ["offline", hydrated(false), { status: "idle", attempt: 0 }, [{ type: "persist.started", started: 10 }]],
    ["a cutoff from an earlier start", hydrated(false, 3), { status: "idle", carry: { started: 3 } }, []],
  ] as const)("hydrating with %s", (_name, event, state, effects) => {
    const result = transitionLegacyMigration(INITIAL_LEGACY_MIGRATION_STATE, event)

    expect(result.state).toMatchObject(state)
    expect(result.effects).toEqual(effects)
  })

  test("events that don't apply keep the same state", () => {
    const idle = transitionLegacyMigration(INITIAL_LEGACY_MIGRATION_STATE, hydrated(false)).state
    const reported = transitionLegacyMigration(idle, { type: "session.reported", sessionID: "s1", idle: 5 }).state

    expect(transitionLegacyMigration(INITIAL_LEGACY_MIGRATION_STATE, { type: "run.failed", attempt: 0 }).state).toBe(
      INITIAL_LEGACY_MIGRATION_STATE,
    )
    expect(transitionLegacyMigration(idle, hydrated(true)).state).toBe(idle)
    expect(transitionLegacyMigration(idle, { type: "connection.changed", connected: false }).state).toBe(idle)
    expect(transitionLegacyMigration(reported, { type: "session.reported", sessionID: "s1", idle: 4 }).state).toBe(
      reported,
    )
  })

  test("disposing cancels a pending run and ignores later results", () => {
    const migrating = transitionLegacyMigration(INITIAL_LEGACY_MIGRATION_STATE, hydrated(true)).state
    const disposed = transitionLegacyMigration(migrating, { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "run.cancel" }] })
    expect(transitionLegacyMigration(disposed.state, { type: "run.succeeded", attempt: 1 }).state).toBe(disposed.state)
    expect(transitionLegacyMigration(INITIAL_LEGACY_MIGRATION_STATE, { type: "disposed" }).effects).toEqual([])
  })
})

describe("selectSessionUnread", () => {
  const sessions = [
    { id: "read-here", time: { idle: 5 } },
    { id: "unread-here", time: { idle: 6 } },
    { id: "viewed", time: { idle: 4, viewed: 4 } },
    { id: "untracked", time: { idle: 7, viewed: 3 } },
    { id: "new", time: { idle: 20 } },
    { id: "never-ran", time: {} },
  ]

  const carrying = transitionLegacyMigration(INITIAL_LEGACY_MIGRATION_STATE, hydrated(false)).state
  const done: LegacyMigrationState = { status: "done", reported: new Map([["read-here", 5]]) }

  test.each([
    ["loading", INITIAL_LEGACY_MIGRATION_STATE, []],
    ["carrying the old list", carrying, ["unread-here", "new"]],
    ["done", done, ["unread-here", "untracked", "new"]],
  ] as const)("while %s", (_name, state, unread) => {
    expect(sessions.flatMap((session) => (selectSessionUnread(state, session) ? [session.id] : []))).toEqual([
      ...unread,
    ])
  })

  test("the carry-over reports the sessions the server has unread but this client shows read", () => {
    expect(selectLegacyHiddenReports(carrying, sessions)).toEqual([
      { sessionID: "read-here", idle: 5 },
      { sessionID: "untracked", idle: 7 },
    ])
  })
})
