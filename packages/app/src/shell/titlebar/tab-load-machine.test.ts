import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { ServerKey } from "@/runtime/server/persistence"
import {
  INITIAL_SESSION_TAB_LOADS_STATE,
  selectSessionTabView,
  transitionSessionTabLoads,
  type SessionTabLoadsEffect,
  type SessionTabLoadsEvent,
  type SessionTabLoadsState,
  type SessionTabSnapshot,
  type SessionTabViewInput,
} from "./tab-load-machine"

const server = ServerKey.make("server")

const tab: SessionTabSnapshot = {
  key: "tab-a",
  server,
  sessionID: "ses_a",
  active: true,
  pending: false,
  cached: false,
  missing: false,
  persistedTitle: false,
  serverReady: true,
  connected: true,
}

const session: SessionInfo = {
  id: "ses_a",
  projectID: "proj",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  location: { directory: "/project" },
  title: "Loaded",
  time: { created: 1, updated: 1 },
}

const input: SessionTabViewInput = {
  active: true,
  pending: undefined,
  session: undefined,
  missing: false,
  persisted: undefined,
  serverReady: true,
}

const persisted = { title: "Stored title", directory: "/project", prompted: true }

function replay(events: SessionTabLoadsEvent[], state: SessionTabLoadsState = INITIAL_SESSION_TAB_LOADS_STATE) {
  return events.reduce<{ state: SessionTabLoadsState; effects: SessionTabLoadsEffect[] }>(
    (acc, event) => {
      const next = transitionSessionTabLoads(acc.state, event)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

describe("session tab load machine", () => {
  test("a background tab with a stored title shows it without a fetch, and is not missing", () => {
    const background = { ...tab, active: false, persistedTitle: true }
    const result = replay([{ type: "sync", tabs: [background] }])

    expect(result.state).toBe(INITIAL_SESSION_TAB_LOADS_STATE)
    expect(result.effects).toEqual([])
    expect(selectSessionTabView(result.state, tab.key, { ...input, active: false, persisted })).toMatchObject({
      phase: "deferred",
      visible: true,
      fallbackTitle: "persisted",
    })
  })

  test("visibility is known in the first pass, without waiting for the tab to render", () => {
    const state = INITIAL_SESSION_TAB_LOADS_STATE
    const visible = (view: Partial<SessionTabViewInput>) => selectSessionTabView(state, tab.key, { ...input, ...view })

    expect(visible({ session }).visible).toBe(true)
    expect(visible({ missing: true })).toMatchObject({ visible: true, fallbackTitle: "unknown" })
    expect(visible({ active: false, persisted }).visible).toBe(true)
    expect(visible({}).visible).toBe(false)
    expect(visible({ serverReady: false })).toMatchObject({ phase: "waiting-server", visible: false })
    expect(visible({ persisted }).visible).toBe(true)
  })

  test("activating a background tab fetches it while its stored title stays", () => {
    const background = { ...tab, active: false, persistedTitle: true }

    const result = replay([
      { type: "sync", tabs: [background] },
      { type: "sync", tabs: [{ ...background, active: true }] },
    ])

    expect(result.effects).toEqual([
      { type: "load.start", key: tab.key, server, sessionID: tab.sessionID, attempt: 1, timeoutMs: 15_000 },
    ])
    expect(selectSessionTabView(result.state, tab.key, { ...input, persisted })).toMatchObject({
      phase: "loading",
      visible: true,
    })
  })

  test("a fetch that hangs shows the tab as unavailable, and retries once the connection returns", () => {
    const timedOut = replay([
      { type: "sync", tabs: [tab] },
      { type: "load.timed-out", key: tab.key, attempt: 1, connected: true },
      { type: "load.settled", key: tab.key, attempt: 1, cached: true, missing: false, connected: true },
    ])

    expect(selectSessionTabView(timedOut.state, tab.key, input)).toMatchObject({
      phase: "unavailable",
      visible: true,
      fallbackTitle: "unknown",
    })

    const still = replay([{ type: "sync", tabs: [tab] }], timedOut.state)
    expect(still.state).toBe(timedOut.state)

    const retried = replay(
      [
        { type: "sync", tabs: [{ ...tab, connected: false }] },
        { type: "sync", tabs: [tab] },
      ],
      timedOut.state,
    )

    expect(retried.effects.filter((effect) => effect.type === "load.start")).toMatchObject([{ attempt: 2 }])
  })

  test("a failed fetch while offline retries on reconnect, and a missing session never retries", () => {
    const offline = replay([
      { type: "sync", tabs: [tab] },
      { type: "load.settled", key: tab.key, attempt: 1, cached: false, missing: false, connected: false },
      { type: "sync", tabs: [{ ...tab, connected: false }] },
      { type: "sync", tabs: [tab] },
    ])

    expect(offline.effects.filter((effect) => effect.type === "load.start")).toMatchObject([
      { attempt: 1 },
      { attempt: 2 },
    ])

    const missing = replay([
      { type: "sync", tabs: [tab] },
      { type: "load.settled", key: tab.key, attempt: 1, cached: false, missing: true, connected: true },
      { type: "sync", tabs: [{ ...tab, missing: true, connected: false }] },
      { type: "sync", tabs: [{ ...tab, missing: true }] },
    ])

    expect(missing.effects.filter((effect) => effect.type === "load.start")).toHaveLength(1)
    expect(missing.state).toEqual({ status: "active", issued: 1, entries: {} })
  })

  test("closing a loading tab or unmounting the strip clears its fetch and ignores its late answer", () => {
    const loading = replay([{ type: "sync", tabs: [tab] }])

    const closed = replay(
      [
        { type: "sync", tabs: [] },
        { type: "load.settled", key: tab.key, attempt: 1, cached: false, missing: false, connected: true },
      ],
      loading.state,
    )

    expect(closed.effects).toEqual([{ type: "load.clear", attempt: 1 }])
    expect(selectSessionTabView(closed.state, tab.key, input).phase).toBe("loading")

    const disposed = replay(
      [{ type: "disposed" }, { type: "load.timed-out", key: tab.key, attempt: 1, connected: true }],
      loading.state,
    )

    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.effects).toEqual([{ type: "load.clear", attempt: 1 }])
  })
})
