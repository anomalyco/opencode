import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import {
  INITIAL_SESSION_SEARCH_STATE,
  SESSION_RESTORE_TIMEOUT_MS,
  selectSessionRestoreEntryID,
  transitionSessionSearch,
  type SessionSearchEvent,
  type SessionSearchState,
} from "./session-search-machine"

const server = "http://localhost:4096" as ServerConnection.Key

const session = { id: "ses_a", title: "Restored", time: { created: 1, updated: 2 } } as SessionInfo

const select = (sessionID: string, archived = true): SessionSearchEvent => ({
  type: "entry.selected",
  server,
  sessionID,
  directory: "/repo",
  archived,
})

const restoring = transitionSessionSearch(INITIAL_SESSION_SEARCH_STATE, select("ses_a"))

const run = (state: SessionSearchState, ...events: SessionSearchEvent[]) =>
  events.reduce((current, event) => transitionSessionSearch(current, event).state, state)

describe("session search machine", () => {
  test("restores an archived session before opening it", () => {
    expect(restoring.state).toMatchObject({ status: "restoring", attempt: 1, sessionID: "ses_a" })
    expect(restoring.effects).toEqual([
      { type: "restore.start", attempt: 1, server, sessionID: "ses_a", timeoutMs: SESSION_RESTORE_TIMEOUT_MS },
    ])
    expect(selectSessionRestoreEntryID(restoring.state)).toBe(`session:${server}:ses_a`)

    const done = transitionSessionSearch(restoring.state, {
      type: "restore.succeeded",
      attempt: 1,
      server,
      session,
    })

    expect(done.state).toEqual({ status: "done", issued: 1 })
    expect(done.effects).toEqual([
      { type: "timer.clear", attempt: 1 },
      { type: "session.remember", server, session },
      { type: "session.open", server, sessionID: "ses_a", directory: "/repo" },
    ])
    expect(selectSessionRestoreEntryID(done.state)).toBeUndefined()
  })

  test("a restore that lands after the dialog closed refreshes the session but opens no tab", () => {
    const disposed = transitionSessionSearch(restoring.state, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "timer.clear", attempt: 1 }])

    const late = transitionSessionSearch(disposed.state, {
      type: "restore.succeeded",
      attempt: 1,
      server,
      session,
    })

    expect(late.state).toBe(disposed.state)
    expect(late.effects).toEqual([{ type: "session.remember", server, session }])

    const failed = transitionSessionSearch(disposed.state, { type: "restore.failed", attempt: 1, error: new Error() })

    expect(failed).toEqual({ state: disposed.state, effects: [] })
  })

  test("a second Enter or another row while restoring starts nothing", () => {
    expect(transitionSessionSearch(restoring.state, select("ses_a"))).toEqual({ state: restoring.state, effects: [] })
    expect(transitionSessionSearch(restoring.state, select("ses_b")).state).toBe(restoring.state)
  })

  test("an active session opens at once, once", () => {
    const opened = transitionSessionSearch(INITIAL_SESSION_SEARCH_STATE, select("ses_a", false))

    expect(opened.state).toEqual({ status: "done", issued: 0 })
    expect(opened.effects).toEqual([{ type: "session.open", server, sessionID: "ses_a", directory: "/repo" }])
    expect(transitionSessionSearch(opened.state, select("ses_b", false)).effects).toEqual([])
  })

  test("a timeout gives control back, and the late result only refreshes the session", () => {
    const timedOut = transitionSessionSearch(restoring.state, { type: "restore.timed-out", attempt: 1 })

    expect(timedOut.state).toEqual({ status: "idle", issued: 1 })
    expect(timedOut.effects).toEqual([
      { type: "timer.clear", attempt: 1 },
      { type: "toast.failed", error: undefined },
    ])

    expect(transitionSessionSearch(timedOut.state, { type: "restore.failed", attempt: 1, error: new Error() })).toEqual({
      state: timedOut.state,
      effects: [],
    })

    const retry = transitionSessionSearch(timedOut.state, select("ses_a"))

    expect(retry.state).toMatchObject({ status: "restoring", attempt: 2 })

    // The first attempt lands while the retry is in flight: refresh only; the retry decides when the tab opens.
    const late = transitionSessionSearch(retry.state, { type: "restore.succeeded", attempt: 1, server, session })

    expect(late).toEqual({ state: retry.state, effects: [{ type: "session.remember", server, session }] })
    expect(run(retry.state, { type: "restore.succeeded", attempt: 2, server, session })).toEqual({
      status: "done",
      issued: 2,
    })
  })

  test("a failed restore toasts and allows another try", () => {
    const error = new Error("boom")
    const failed = transitionSessionSearch(restoring.state, { type: "restore.failed", attempt: 1, error })

    expect(failed.state).toEqual({ status: "idle", issued: 1 })
    expect(failed.effects).toEqual([
      { type: "timer.clear", attempt: 1 },
      { type: "toast.failed", error },
    ])
    expect(transitionSessionSearch(failed.state, select("ses_b")).state).toMatchObject({
      status: "restoring",
      attempt: 2,
      sessionID: "ses_b",
    })
  })

  test("ignores results for attempts never issued", () => {
    expect(
      transitionSessionSearch(INITIAL_SESSION_SEARCH_STATE, { type: "restore.succeeded", attempt: 1, server, session }),
    ).toEqual({ state: INITIAL_SESSION_SEARCH_STATE, effects: [] })
  })
})
