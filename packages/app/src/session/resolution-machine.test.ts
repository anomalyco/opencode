import { expect, test } from "bun:test"
import type { ServerHealth } from "@/runtime/server/health-machine"
import {
  createSessionResolutionState,
  SESSION_RESOLUTION_TIMEOUT_MS,
  sessionDocumentTitle,
  sessionModelDirectory,
  sessionRouteView,
  transitionSessionResolution,
  viewedSessionID,
  type SessionResolutionEffect,
  type SessionResolutionEvent,
  type SessionResolutionState,
  type SessionResolutionTransition,
  type SessionRouteView,
} from "./resolution-machine"

type Session = { id: string; title?: string; location: { directory: string } }

type Pending = { draft: { directory: string } }

type Event = SessionResolutionEvent<Session, string, Pending>

type State = SessionResolutionState<Session, string, Pending>

const target = (sessionID: string, scope = "server-a") => ({ scope, sessionID })

const info = (id: string, title?: string): Session => ({ id, title, location: { directory: `/work/${id}` } })

const timer = (attempt: number) => ({ type: "timer.start", attempt, delayMs: SESSION_RESOLUTION_TIMEOUT_MS }) as const

function open(
  sessionID: string,
  input: { cached?: Session; pending?: Pending; connected?: boolean; refresh?: boolean; scope?: string } = {},
): Event {
  return {
    type: "target.changed",
    target: target(sessionID, input.scope),
    pending: input.pending,
    cached: input.cached,
    connected: input.connected ?? true,
    refresh: input.refresh ?? true,
  }
}

function settledPending(sessionID: string, input: { cached?: Session; connected?: boolean } = {}): Event {
  return {
    type: "pending.changed",
    target: target(sessionID),
    pending: undefined,
    cached: input.cached,
    connected: input.connected ?? true,
    refresh: true,
  }
}

function replay(events: Event[], from: State = createSessionResolutionState()) {
  const initial: SessionResolutionTransition<Session, string, Pending> = { state: from, effects: [] }

  return events.reduce((current, event) => transitionSessionResolution(current.state, event), initial)
}

const types = (effects: readonly SessionResolutionEffect<string>[]) => effects.map((effect) => effect.type)

// The SDK rejects with the decoded response body.
const notFound = (sessionID: string) =>
  JSON.parse(`{"_tag":"SessionNotFoundError","sessionID":"${sessionID}","message":"Session not found"}`)

// The route used to rethrow these outcomes into an error boundary that every session tab on the
// server shares, so the next tab kept showing the previous session's error.
test.each([
  { name: "missing", error: notFound("ses_a"), shown: "not-found" },
  { name: "failed", error: new Error("boom"), shown: "error" },
])("a $name session does not outlive a switch to another tab", ({ error, shown }) => {
  const failed = replay([open("ses_a"), { type: "sync.failed", target: target("ses_a"), attempt: 1, error }])
  expect(sessionRouteView(failed.state, undefined)).toMatchObject({ type: shown, sessionID: "ses_a" })
  expect(failed.effects).toEqual([{ type: "timer.clear" }])

  const next = transitionSessionResolution(failed.state, open("ses_b"))
  expect(sessionRouteView(next.state, undefined)).toEqual({ type: "resolving", sessionID: "ses_b" })
  expect(next.effects).toEqual([
    { type: "sync.transcript", target: target("ses_b") },
    { type: "sync.metadata", target: target("ses_b"), attempt: 2 },
    timer(2),
  ])

  const cached = transitionSessionResolution(failed.state, open("ses_b", { cached: info("ses_b") }))
  expect(sessionRouteView(cached.state, undefined)).toEqual({
    type: "ready",
    sessionID: "ses_b",
    session: info("ses_b"),
  })
})

test("ignores results from an earlier visit to the same session", () => {
  const returned = replay([open("ses_a"), open("ses_b"), open("ses_a")])
  expect(returned.state).toEqual({ status: "resolving", target: target("ses_a"), attempt: 3 })

  const late: Event[] = [
    { type: "sync.failed", target: target("ses_a"), attempt: 1, error: new Error("boom") },
    { type: "sync.settled", target: target("ses_a"), attempt: 1, session: undefined },
    { type: "sync.settled", target: target("ses_b"), attempt: 2, session: info("ses_b") },
    { type: "resolve.timed-out", attempt: 1 },
    { type: "resolve.timed-out", attempt: 2 },
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
  const ready = replay([open("ses_a", { cached: info("ses_a") })])
  const replaced = transitionSessionResolution(ready.state, open("ses_a", { scope: "server-b" }))
  expect(replaced.state).toEqual({ status: "resolving", target: target("ses_a", "server-b"), attempt: 2 })

  const stale: Event = { type: "cache.changed", target: target("ses_a"), session: undefined }
  expect(transitionSessionResolution(replaced.state, stale).state).toBe(replaced.state)
})

test.each<{ name: string; event: Event; effects: SessionResolutionEffect<string>["type"][] }>([
  {
    name: "a cached session without refresh loads only its transcript",
    event: open("ses_a", { cached: info("ses_a"), refresh: false }),
    effects: ["sync.transcript"],
  },
  {
    name: "a cached session with refresh also reloads its metadata",
    event: open("ses_a", { cached: info("ses_a") }),
    effects: ["sync.transcript", "sync.metadata"],
  },
  {
    name: "a disconnected route waits to load, for a bounded time",
    event: open("ses_a", { connected: false }),
    effects: ["timer.start"],
  },
  {
    name: "a pending session loads nothing while its promotion creates it",
    event: open("ses_a", { pending: { draft: { directory: "/draft" } } }),
    effects: [],
  },
])("$name", ({ event, effects }) => {
  expect(types(replay([event]).effects)).toEqual(effects)
})

test("reconnecting retries a failed session and refreshes a resolved one in place", () => {
  const connected: Event = { type: "connected", target: target("ses_a"), refresh: true }
  const failed = replay([open("ses_a"), { type: "sync.failed", target: target("ses_a"), attempt: 1, error: "offline" }])
  const retried = transitionSessionResolution(failed.state, connected)
  expect(retried.state).toEqual({ status: "resolving", target: target("ses_a"), attempt: 2 })
  expect(types(retried.effects)).toEqual(["sync.transcript", "sync.metadata", "timer.start"])

  const ready = replay([open("ses_a", { cached: info("ses_a") })])
  const refreshed = transitionSessionResolution(ready.state, connected)
  expect(refreshed.state).toBe(ready.state)
  expect(types(refreshed.effects)).toEqual(["sync.transcript", "sync.metadata"])
})

test("a resolved session stays visible through a failed refresh until it leaves the cache", () => {
  const ready = replay([open("ses_a", { cached: info("ses_a") })])
  const failure: Event = { type: "sync.failed", target: target("ses_a"), attempt: 1, error: new Error("boom") }
  expect(transitionSessionResolution(ready.state, failure).state).toBe(ready.state)

  const deleted: Event = { type: "cache.changed", target: target("ses_a"), session: undefined }
  expect(transitionSessionResolution(ready.state, deleted).state).toEqual({
    status: "not-found",
    target: target("ses_a"),
    attempt: 1,
  })
})

test("unmounting ignores later results and stops the resolution timeout", () => {
  const disposed = replay([open("ses_a"), { type: "disposed" }])
  expect(disposed.state).toEqual({ status: "idle", attempt: 2 })
  expect(disposed.effects).toEqual([{ type: "timer.clear" }])

  const late: Event[] = [
    { type: "sync.settled", target: target("ses_a"), attempt: 1, session: info("ses_a") },
    { type: "resolve.timed-out", attempt: 1 },
  ]

  late.forEach((event) => expect(transitionSessionResolution(disposed.state, event).state).toBe(disposed.state))
})

// The route showed the preparing screen outside the machine, so a server that turned out to be incompatible while a
// new session was being created stayed on "Creating worktree" instead of saying so.
test("an incompatible server wins over a session that is still being prepared", () => {
  const pending = { draft: { directory: "/draft" } }
  const preparing = replay([open("ses_a", { pending })])
  expect(preparing.state).toEqual({ status: "preparing", target: target("ses_a"), pending, attempt: 1 })

  expect(sessionRouteView(preparing.state, { type: "checking", managed: false })).toEqual({
    type: "preparing",
    sessionID: "ses_a",
    pending,
  })
  expect(sessionRouteView(preparing.state, { type: "incompatible" })).toEqual({
    type: "incompatible",
    sessionID: "ses_a",
  })
})

// The created session reached the cache before the promotion settled, so the route briefly had both a pending
// session and a cached one: the model picker read neither directory, and the session counted as viewed early.
test("a prepared session stays prepared until its promotion settles, then shows without resolving", () => {
  const pending = { draft: { directory: "/draft" } }
  const preparing = replay([open("ses_a", { pending })])
  const created = info("ses_a")

  const early: Event[] = [
    { type: "cache.changed", target: target("ses_a"), session: created },
    { type: "connected", target: target("ses_a"), refresh: true },
    { type: "pending.changed", target: target("ses_a"), pending, cached: created, connected: true, refresh: true },
    { type: "sync.settled", target: target("ses_a"), attempt: 1, session: created },
  ]

  early.forEach((event) => {
    const next = transitionSessionResolution(preparing.state, event)
    expect(next.state).toBe(preparing.state)
    expect(next.effects).toEqual([])
  })
  expect(sessionModelDirectory(preparing.state)).toBe("/draft")
  expect(viewedSessionID(sessionRouteView(preparing.state, { type: "healthy" }))).toBeUndefined()

  const settled = transitionSessionResolution(preparing.state, settledPending("ses_a", { cached: created }))
  expect(settled.state).toEqual({ status: "ready", target: target("ses_a"), session: created, attempt: 2 })
  expect(types(settled.effects)).toEqual(["sync.transcript", "sync.metadata"])
  expect(sessionModelDirectory(settled.state)).toBe("/work/ses_a")
  expect(viewedSessionID(sessionRouteView(settled.state, { type: "healthy" }))).toBe("ses_a")
})

test("a promotion that settles before the session is cached resolves it", () => {
  const preparing = replay([open("ses_a", { pending: { draft: { directory: "/draft" } } })])
  const settled = transitionSessionResolution(preparing.state, settledPending("ses_a"))
  expect(settled.state).toEqual({ status: "resolving", target: target("ses_a"), attempt: 2 })
  expect(settled.effects).toEqual([
    { type: "sync.transcript", target: target("ses_a") },
    { type: "sync.metadata", target: target("ses_a"), attempt: 2 },
    timer(2),
  ])
  expect(sessionModelDirectory(settled.state)).toBeUndefined()
})

// A contributed server waiting for sign-in or stopped never answers, so an uncached session stayed blank forever.
test.each<{ health: ServerHealth; view: SessionRouteView<Session>["type"] }>([
  { health: { type: "auth" }, view: "signed-out" },
  { health: { type: "unauthorized" }, view: "signed-out" },
  { health: { type: "stopped" }, view: "unreachable" },
])("an uncached session on a $health.type server explains it, a cached one stays", ({ health, view }) => {
  expect(sessionRouteView(replay([open("ses_a")]).state, health)).toMatchObject({ type: view, sessionID: "ses_a" })
  expect(sessionRouteView(replay([open("ses_a", { cached: info("ses_a") })]).state, health).type).toBe("ready")
})

// A server that answers its health check while its event stream never connects, or a metadata request that hangs,
// left the route on a bare header with no explanation and no way to close the tab.
test("a session that does not resolve in time shows as unreachable and recovers", () => {
  const resolving = replay([open("ses_a", { connected: false })])
  expect(resolving.effects).toEqual([timer(1)])

  const mismatched = transitionSessionResolution(resolving.state, { type: "resolve.timed-out", attempt: 99 })
  expect(mismatched.state).toBe(resolving.state)

  const timedOut = transitionSessionResolution(resolving.state, { type: "resolve.timed-out", attempt: 1 })
  expect(timedOut.state).toEqual({ status: "unreachable", target: target("ses_a"), attempt: 2 })
  expect(timedOut.effects).toEqual([{ type: "timer.clear" }])
  expect(sessionRouteView(timedOut.state, { type: "healthy" })).toEqual({ type: "unreachable", sessionID: "ses_a" })
  expect(sessionRouteView(timedOut.state, { type: "incompatible" }).type).toBe("incompatible")

  const late: Event = { type: "sync.failed", target: target("ses_a"), attempt: 1, error: new Error("late") }
  expect(transitionSessionResolution(timedOut.state, late).state).toBe(timedOut.state)

  const reconnected = transitionSessionResolution(timedOut.state, {
    type: "connected",
    target: target("ses_a"),
    refresh: true,
  })
  expect(reconnected.state).toEqual({ status: "resolving", target: target("ses_a"), attempt: 3 })
  expect(types(reconnected.effects)).toEqual(["sync.transcript", "sync.metadata", "timer.start"])

  // A request that hung past the timeout still fills the cache when it finally answers.
  const cached = transitionSessionResolution(timedOut.state, {
    type: "cache.changed",
    target: target("ses_a"),
    session: info("ses_a"),
  })
  expect(cached.state).toEqual({ status: "ready", target: target("ses_a"), session: info("ses_a"), attempt: 2 })
  expect(cached.effects).toEqual([])
})

test.each<{ name: string; event: Event }>([
  {
    name: "metadata arrives",
    event: { type: "sync.settled", target: target("ses_a"), attempt: 1, session: info("ses_a") },
  },
  {
    name: "metadata fails",
    event: { type: "sync.failed", target: target("ses_a"), attempt: 1, error: new Error("x") },
  },
  { name: "the cache fills", event: { type: "cache.changed", target: target("ses_a"), session: info("ses_a") } },
  {
    name: "a promotion starts",
    event: {
      type: "pending.changed",
      target: target("ses_a"),
      pending: { draft: { directory: "/draft" } },
      cached: undefined,
      connected: true,
      refresh: true,
    },
  },
  {
    name: "the route loses its target",
    event: { type: "target.changed", target: undefined, cached: undefined, connected: false, refresh: true },
  },
  { name: "the route unmounts", event: { type: "disposed" } },
])("leaving resolving when $name stops the timeout", ({ event }) => {
  const next = transitionSessionResolution(replay([open("ses_a")]).state, event)
  expect(next.state.status).not.toBe("resolving")
  expect(next.effects.at(-1)).toEqual({ type: "timer.clear" })
})

test("the document title names only a shown session with a real title", () => {
  const ready = (title?: string) => replay([open("ses_a", { cached: info("ses_a", title) })]).state

  expect(sessionDocumentTitle(sessionRouteView(ready("Fix the build"), undefined))).toBe("Fix the build")
  expect(sessionDocumentTitle(sessionRouteView(ready(), undefined))).toBeUndefined()
  expect(sessionDocumentTitle(sessionRouteView(ready("Fix the build"), { type: "incompatible" }))).toBeUndefined()
  expect(sessionDocumentTitle(sessionRouteView(replay([open("ses_a")]).state, undefined))).toBeUndefined()
})

const resolving: State = { status: "resolving", target: target("ses_a"), attempt: 1 }

const resolved: State = { status: "ready", target: target("ses_a"), session: info("ses_a"), attempt: 1 }

const missing: State = { status: "not-found", target: target("ses_a"), attempt: 1 }

test.each<{ name: string; health: ServerHealth; state: State; view: SessionRouteView<Session>["type"] }>([
  {
    name: "incompatible wins over a resolved session",
    health: { type: "incompatible" },
    state: resolved,
    view: "incompatible",
  },
  {
    name: "an unreachable server explains a pending session",
    health: { type: "unreachable" },
    state: resolving,
    view: "unreachable",
  },
  {
    name: "an unreachable server keeps a resolved session visible",
    health: { type: "unreachable" },
    state: resolved,
    view: "ready",
  },
  {
    name: "a running health check keeps waiting",
    health: { type: "checking", managed: true },
    state: resolving,
    view: "resolving",
  },
  {
    name: "an unreachable server keeps a known outcome",
    health: { type: "unreachable" },
    state: missing,
    view: "not-found",
  },
])("view: $name", ({ health, state, view }) => {
  expect(sessionRouteView(state, health).type).toBe(view)
})
