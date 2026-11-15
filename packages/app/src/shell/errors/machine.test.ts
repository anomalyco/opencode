import { describe, expect, test } from "bun:test"
import {
  ERROR_ACTION_TIMEOUT_MS,
  FATAL_RECORD_TIMEOUT_MS,
  INITIAL_ERROR_PAGE_STATE,
  selectActionError,
  selectCheckUpdatesDisabled,
  selectExportDisabled,
  selectInstallUpdateDisabled,
  selectReportDisabled,
  selectReported,
  transitionErrorPage,
  type ErrorPageEffect,
  type ErrorPageEvent,
  type ErrorPageState,
} from "./machine"

const replay = (events: ErrorPageEvent[], state = INITIAL_ERROR_PAGE_STATE) =>
  events.reduce<{ state: ErrorPageState; effects: ErrorPageEffect[] }>(
    (current, event) => {
      const next = transitionErrorPage(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

const presented: ErrorPageEvent = { type: "error.presented" }

const check: ErrorPageEvent = { type: "check.clicked", available: true, busy: false }

const install: ErrorPageEvent = { type: "install.clicked", available: true, busy: false }

const exportLogs: ErrorPageEvent = { type: "export.clicked", available: true }

describe("error page actions", () => {
  test("starting an action clears the previous action's error", () => {
    const failed = replay([presented, exportLogs, { type: "action.failed", attempt: 1, error: "Export failed" }]).state
    expect(selectActionError(failed)).toBe("Export failed")

    const checking = transitionErrorPage(failed, check)
    expect(checking.state.status).toBe("checking")
    expect(selectActionError(checking.state)).toBeUndefined()
    expect(checking.effects).toEqual([{ type: "updater.check", attempt: 2, timeoutMs: ERROR_ACTION_TIMEOUT_MS }])
  })

  test("a crash that failed to record does not block Export Logs", () => {
    const start = replay([presented])
    expect(start.effects).toEqual([{ type: "fatal.record", attempt: 1, timeoutMs: FATAL_RECORD_TIMEOUT_MS }])

    const unrecorded = transitionErrorPage(start.state, { type: "fatal.settled", attempt: 1, recorded: false }).state
    const exporting = transitionErrorPage(unrecorded, exportLogs)
    expect(exporting.effects).toEqual([
      {
        type: "logs.export",
        attempt: 1,
        fatalAttempt: 1,
        recordFirst: true,
        recordTimeoutMs: FATAL_RECORD_TIMEOUT_MS,
      },
    ])
    expect(transitionErrorPage(exporting.state, { type: "action.succeeded", attempt: 1 }).state.status).toBe("idle")
  })

  test("a recorded crash exports at once, even when the record answered after its timeout", () => {
    const late = replay([
      presented,
      { type: "fatal.settled", attempt: 1, recorded: false },
      { type: "fatal.settled", attempt: 1, recorded: true },
      exportLogs,
    ])

    expect(late.effects.at(-1)).toMatchObject({ type: "logs.export", recordFirst: false })
  })

  test("the first click claims the action and later clicks wait", () => {
    const exporting = replay([presented, exportLogs]).state
    expect(selectExportDisabled(exporting)).toBe(true)
    expect(selectCheckUpdatesDisabled(exporting, undefined)).toBe(true)

    for (const event of [exportLogs, install, check]) {
      const again = transitionErrorPage(exporting, event)
      expect(again.state).toBe(exporting)
      expect(again.effects).toEqual([])
    }
  })

  test("results of an earlier action are ignored", () => {
    const installing = replay([presented, check, { type: "action.succeeded", attempt: 1 }, install]).state
    expect(installing).toMatchObject({ status: "installing", attempt: 2 })

    for (const event of [
      { type: "action.succeeded", attempt: 1 },
      { type: "action.failed", attempt: 1, error: "late" },
      { type: "action.timed-out", attempt: 1, error: "late" },
    ] satisfies ErrorPageEvent[])
      expect(transitionErrorPage(installing, event).state).toBe(installing)
  })

  test("a busy or missing updater does not start an action", () => {
    const idle = replay([presented]).state
    expect(transitionErrorPage(idle, { type: "check.clicked", available: true, busy: true }).state).toBe(idle)
    expect(transitionErrorPage(idle, { type: "install.clicked", available: false, busy: false }).state).toBe(idle)
    expect(transitionErrorPage(idle, { type: "export.clicked", available: false }).state).toBe(idle)
  })

  test("a check that never answers fails after the timeout and can be retried", () => {
    const timedOut = replay([presented, check, { type: "action.timed-out", attempt: 1, error: "Request failed" }])
    expect(selectActionError(timedOut.state)).toBe("Request failed")
    expect(selectCheckUpdatesDisabled(timedOut.state, undefined)).toBe(false)
    expect(transitionErrorPage(timedOut.state, check).state.status).toBe("checking")
  })

  test("a new error resets the report and the action error, and records the new crash", () => {
    const reported = replay([
      presented,
      { type: "sentry.loaded", enabled: true },
      { type: "report.clicked" },
      check,
      { type: "action.failed", attempt: 1, error: "Check failed" },
    ])

    expect(reported.effects).toContainEqual({ type: "sentry.capture" })
    expect(selectReported(reported.state)).toBe(true)
    expect(selectReportDisabled(reported.state)).toBe(true)

    const next = transitionErrorPage(reported.state, presented)
    expect(next.state).toEqual({ status: "idle", attempt: 1, fatalAttempt: 2, fatal: "recording", report: "ready" })
    expect(selectActionError(next.state)).toBeUndefined()
    expect(next.effects).toEqual([{ type: "fatal.record", attempt: 2, timeoutMs: FATAL_RECORD_TIMEOUT_MS }])
    // The previous crash's record answers late.
    expect(transitionErrorPage(next.state, { type: "fatal.settled", attempt: 1, recorded: true }).state).toBe(
      next.state,
    )
  })

  test("an action still running when a new error arrives keeps the page busy until it settles", () => {
    for (const start of [check, install, exportLogs]) {
      const busy = replay([presented, { type: "sentry.loaded", enabled: true }, { type: "report.clicked" }, start])
      const next = transitionErrorPage(busy.state, presented)

      expect(next.state).toMatchObject({ status: busy.state.status, attempt: 1, fatalAttempt: 2, report: "ready" })
      expect(selectExportDisabled(next.state)).toBe(true)
      expect(selectCheckUpdatesDisabled(next.state, undefined)).toBe(true)
      expect(selectInstallUpdateDisabled(next.state, undefined)).toBe(true)

      // A click meanwhile does not start a second action beside the first.
      for (const event of [check, install, exportLogs])
        expect(transitionErrorPage(next.state, event).state).toBe(next.state)

      // The running action settles; its timeout and late duplicates then change nothing.
      const failed = transitionErrorPage(next.state, { type: "action.failed", attempt: 1, error: "Install failed" })
      expect(selectActionError(failed.state)).toBe("Install failed")
      expect(transitionErrorPage(failed.state, { type: "action.timed-out", attempt: 1, error: "late" }).state).toBe(
        failed.state,
      )
      expect(
        transitionErrorPage(next.state, { type: "action.timed-out", attempt: 1, error: "Request failed" }).state,
      ).toMatchObject({ status: "failed", error: "Request failed" })
    }
  })

  test("Report stays hidden until Sentry is enabled, and sends once", () => {
    const idle = replay([presented, { type: "sentry.loaded", enabled: false }]).state
    expect(transitionErrorPage(idle, { type: "report.clicked" }).effects).toEqual([])

    const reported = replay([{ type: "sentry.loaded", enabled: true }, { type: "report.clicked" }], idle).state
    expect(transitionErrorPage(reported, { type: "report.clicked" }).effects).toEqual([])
  })

  test("disposal ignores every later event", () => {
    const disposed = replay([presented, check, { type: "disposed" }]).state
    expect(disposed.status).toBe("disposed")

    for (const event of [{ type: "action.succeeded", attempt: 2 }, presented, exportLogs] satisfies ErrorPageEvent[])
      expect(transitionErrorPage(disposed, event).state).toBe(disposed)
  })
})
