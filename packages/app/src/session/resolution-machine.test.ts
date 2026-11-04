import { expect, test } from "bun:test"
import type { ServerHealth } from "@/runtime/server/health"
import {
  createSessionResolutionState,
  sessionRouteView,
  transitionSessionResolution,
  type SessionResolutionEffect,
  type SessionResolutionEvent,
  type SessionResolutionState,
  type SessionResolutionTransition,
  type SessionRouteView,
} from "./resolution-machine"

type Session = { id: string }

type Event = SessionResolutionEvent<Session, string>

type State = SessionResolutionState<Session, string>

const target = (sessionID: string, scope = "server-a") => ({ scope, sessionID })

function open(
  sessionID: string,
  input: { cached?: Session; connected?: boolean; refresh?: boolean; scope?: string } = {},
): Event {
  return {
    type: "target.changed",
    target: target(sessionID, input.scope),
    cached: input.cached,
    connected: input.connected ?? true,
    refresh: input.refresh ?? true,
  }
}

function replay(events: Event[]) {
  const initial: SessionResolutionTransition<Session, string> = { state: createSessionResolutionState(), effects: [] }

  return events.reduce((current, event) => transitionSessionResolution(current.state, event), initial)
}

const notFound = (sessionID: string) =>
  new Error(`Session not found: ${sessionID}`, { cause: { body: { _tag: "SessionNotFoundError", sessionID } } })

// The route used to rethrow these outcomes into an error boundary that every session tab on the
// server shares, so the next tab kept showing the previous session's error.
test.each([
  { name: "missing", error: notFound("ses_a"), shown: "not-found" },
  { name: "failed", error: new Error("boom"), shown: "error" },
])("a $name session does not outlive a switch to another tab", ({ error, shown }) => {
  const failed = replay([open("ses_a"), { type: "sync.failed", target: target("ses_a"), attempt: 1, error }])
  expect(sessionRouteView(failed.state, undefined)).toMatchObject({ type: shown, sessionID: "ses_a" })

  const next = transitionSessionResolution(failed.state, open("ses_b"))
  expect(sessionRouteView(next.state, undefined)).toEqual({ type: "resolving", sessionID: "ses_b" })
  expect(next.effects).toEqual([
    { type: "sync.transcript", target: target("ses_b") },
    { type: "sync.metadata", target: target("ses_b"), attempt: 2 },
  ])

  const cached = transitionSessionResolution(failed.state, open("ses_b", { cached: { id: "ses_b" } }))
  expect(sessionRouteView(cached.state, undefined)).toEqual({
    type: "ready",
    sessionID: "ses_b",
    session: { id: "ses_b" },
  })
})

test("ignores results from an earlier visit to the same session", () => {
  const returned = replay([open("ses_a"), open("ses_b"), open("ses_a")])
  expect(returned.state).toEqual({ status: "resolving", target: target("ses_a"), attempt: 3 })

  const late: Event[] = [
    { type: "sync.failed", target: target("ses_a"), attempt: 1, error: new Error("boom") },
    { type: "sync.settled", target: target("ses_a"), attempt: 1, session: undefined },
    { type: "sync.settled", target: target("ses_b"), attempt: 2, session: { id: "ses_b" } },
  ]

  late.forEach((event) => expect(transitionSessionResolution(returned.state, event).state).toBe(returned.state))

  const current: Event = { type: "sync.settled", target: target("ses_a"), attempt: 3, session: undefined }
  expect(transitionSessionResolution(returned.state, current).state).toEqual({
    status: "not-found",
    target: target("ses_a"),
    attempt: 3,
  })
})

test("a replaced session store is a new target", () => {
  const ready = replay([open("ses_a", { cached: { id: "ses_a" } })])
  const replaced = transitionSessionResolution(ready.state, open("ses_a", { scope: "server-b" }))
  expect(replaced.state).toEqual({ status: "resolving", target: target("ses_a", "server-b"), attempt: 2 })

  const stale: Event = { type: "cache.changed", target: target("ses_a"), session: undefined }
  expect(transitionSessionResolution(replaced.state, stale).state).toBe(replaced.state)
})

test.each<{ name: string; event: Event; effects: SessionResolutionEffect<string>["type"][] }>([
  {
    name: "a cached session without refresh loads only its transcript",
    event: open("ses_a", { cached: { id: "ses_a" }, refresh: false }),
    effects: ["sync.transcript"],
  },
  {
    name: "a cached session with refresh also reloads its metadata",
    event: open("ses_a", { cached: { id: "ses_a" } }),
    effects: ["sync.transcript", "sync.metadata"],
  },
  { name: "a disconnected route waits to load", event: open("ses_a", { connected: false }), effects: [] },
])("$name", ({ event, effects }) => {
  expect(replay([event]).effects.map((effect) => effect.type)).toEqual(effects)
})

test("reconnecting retries a failed session and refreshes a resolved one in place", () => {
  const connected: Event = { type: "connected", target: target("ses_a"), refresh: true }
  const failed = replay([open("ses_a"), { type: "sync.failed", target: target("ses_a"), attempt: 1, error: "offline" }])
  const retried = transitionSessionResolution(failed.state, connected)
  expect(retried.state).toEqual({ status: "resolving", target: target("ses_a"), attempt: 2 })
  expect(retried.effects.map((effect) => effect.type)).toEqual(["sync.transcript", "sync.metadata"])

  const ready = replay([open("ses_a", { cached: { id: "ses_a" } })])
  const refreshed = transitionSessionResolution(ready.state, connected)
  expect(refreshed.state).toBe(ready.state)
  expect(refreshed.effects.map((effect) => effect.type)).toEqual(["sync.transcript", "sync.metadata"])
})

test("a resolved session stays visible through a failed refresh until it leaves the cache", () => {
  const ready = replay([open("ses_a", { cached: { id: "ses_a" } })])
  const failure: Event = { type: "sync.failed", target: target("ses_a"), attempt: 1, error: new Error("boom") }
  expect(transitionSessionResolution(ready.state, failure).state).toBe(ready.state)

  const deleted: Event = { type: "cache.changed", target: target("ses_a"), session: undefined }
  expect(transitionSessionResolution(ready.state, deleted).state).toEqual({
    status: "not-found",
    target: target("ses_a"),
    attempt: 1,
  })
})

test("unmounting ignores later results", () => {
  const disposed = replay([open("ses_a"), { type: "disposed" }])
  expect(disposed.state).toEqual({ status: "idle", attempt: 2 })

  const late: Event = { type: "sync.settled", target: target("ses_a"), attempt: 1, session: { id: "ses_a" } }
  expect(transitionSessionResolution(disposed.state, late).state).toBe(disposed.state)
})

const resolving: State = { status: "resolving", target: target("ses_a"), attempt: 1 }

const resolved: State = { status: "ready", target: target("ses_a"), session: { id: "ses_a" }, attempt: 1 }

const missing: State = { status: "not-found", target: target("ses_a"), attempt: 1 }

test.each<{ name: string; health: ServerHealth; state: State; view: SessionRouteView<Session>["type"] }>([
  {
    name: "incompatible wins over a resolved session",
    health: { healthy: true, incompatible: true },
    state: resolved,
    view: "incompatible",
  },
  {
    name: "an unreachable server explains a pending session",
    health: { healthy: false },
    state: resolving,
    view: "unreachable",
  },
  {
    name: "a running health check keeps waiting",
    health: { healthy: false, checking: true },
    state: resolving,
    view: "resolving",
  },
  {
    name: "a rejected credential keeps waiting",
    health: { healthy: false, unauthorized: true },
    state: resolving,
    view: "resolving",
  },
  {
    name: "an unreachable server keeps a known outcome",
    health: { healthy: false },
    state: missing,
    view: "not-found",
  },
])("view: $name", ({ health, state, view }) => {
  expect(sessionRouteView(state, health).type).toBe(view)
})
