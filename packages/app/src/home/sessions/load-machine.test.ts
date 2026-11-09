import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/runtime/server/registry"
import {
  HOME_SESSIONS_CONNECT_TIMEOUT_MS,
  HOME_SESSIONS_FETCH_TIMEOUT_MS,
  INITIAL_HOME_SESSIONS_LOAD_STATE,
  selectHomeSessionsListView,
  selectHomeSessionsSearchLoading,
  transitionHomeSessionsLoad,
  type HomeSessionsLoadEffect,
  type HomeSessionsLoadEvent,
  type HomeSessionsLoadState,
  type HomeSessionsTarget,
} from "./load-machine"

// SAFETY: the brand only marks registry-built keys; these tests compare them as plain strings.
const A = "http:a" as ServerConnection.Key

// SAFETY: as above.
const B = "http:b" as ServerConnection.Key

const target = (
  connection: HomeSessionsTarget["connection"],
  options: { server?: ServerConnection.Key; cached?: boolean; stale?: boolean } = {},
): HomeSessionsLoadEvent => ({
  type: "context.changed",
  target: {
    server: options.server ?? A,
    connection,
    cached: options.cached ?? false,
    stale: options.stale ?? !options.cached,
  },
})

function replay(events: HomeSessionsLoadEvent[], state = INITIAL_HOME_SESSIONS_LOAD_STATE) {
  return events.reduce<{ state: HomeSessionsLoadState; effects: readonly HomeSessionsLoadEffect[] }>(
    (step, event) => transitionHomeSessionsLoad(step.state, event),
    { state, effects: [] },
  )
}

const view = (state: HomeSessionsLoadState, hasSessions = false) => selectHomeSessionsListView(state, hasSessions)

describe("home sessions load machine", () => {
  test("a server that cannot answer never shows placeholder rows or the search spinner", () => {
    for (const reason of ["offline", "auth", "incompatible"] as const) {
      const step = replay([target(reason), { type: "placeholder.due", since: 1 }])

      expect(view(step.state)).toEqual({ status: "unavailable", reason })
      expect(selectHomeSessionsSearchLoading(step.state)).toBe(false)
      expect(step.effects.some((effect) => effect.type === "fetch.start")).toBe(false)
    }

    // Sessions the server's live store already holds still show.
    expect(view(replay([target("offline")]).state, true)).toEqual({ status: "ready", revealing: false })
  })

  test("a connect that never finishes ends as unreachable instead of loading forever", () => {
    const connecting = replay([target("connecting")])
    expect(connecting.effects).toContainEqual({
      type: "timer.start",
      timer: "deadline",
      delayMs: HOME_SESSIONS_CONNECT_TIMEOUT_MS,
      event: { type: "connect.timed-out", attempt: 1 },
    })
    expect(view(replay([{ type: "placeholder.due", since: 1 }], connecting.state).state)).toEqual({
      status: "loading",
      skeleton: true,
    })

    const timedOut = replay([{ type: "connect.timed-out", attempt: 1 }], connecting.state)
    expect(view(timedOut.state)).toEqual({ status: "unavailable", reason: "offline" })
    expect(selectHomeSessionsSearchLoading(timedOut.state)).toBe(false)

    // Try again probes the servers and waits for a connection again.
    const retried = replay([{ type: "retry" }], timedOut.state)
    expect(retried.state).toMatchObject({ status: "connecting", attempt: 2 })
    expect(retried.effects).toContainEqual({ type: "probe.servers" })
  })

  test("a failed first load shows an error with Try again, not the empty state", () => {
    const loading = replay([target("connected")])
    expect(loading.effects).toContainEqual({ type: "fetch.start", server: A, attempt: 1 })

    const failed = replay([{ type: "fetch.failed", attempt: 1, message: "500" }], loading.state)
    expect(view(failed.state)).toEqual({ status: "error", failure: { type: "rejected", message: "500" } })
    expect(selectHomeSessionsSearchLoading(failed.state)).toBe(false)

    // The server reporting itself connected again does not retry behind the user's back.
    expect(transitionHomeSessionsLoad(failed.state, target("connected")).state).toBe(failed.state)

    const retried = replay([{ type: "retry" }], failed.state)
    expect(retried.state).toMatchObject({ status: "loading", attempt: 2, skeleton: false })
    expect(retried.effects).toContainEqual({ type: "fetch.start", server: A, attempt: 2 })
    expect(view(replay([{ type: "fetch.succeeded", attempt: 2, reducedMotion: false }], retried.state).state)).toEqual({
      status: "ready",
      revealing: false,
    })
  })

  test("a hung first load times out, cancels the request and shows the error", () => {
    const loading = replay([target("connected")])
    expect(loading.effects).toContainEqual({
      type: "timer.start",
      timer: "deadline",
      delayMs: HOME_SESSIONS_FETCH_TIMEOUT_MS,
      event: { type: "fetch.timed-out", attempt: 1 },
    })

    const timedOut = replay([{ type: "fetch.timed-out", attempt: 1 }], loading.state)
    expect(view(timedOut.state)).toEqual({ status: "error", failure: { type: "timeout" } })
    expect(timedOut.effects).toContainEqual({ type: "fetch.cancel", server: A })

    // The cancelled request's rejection lands on an attempt the machine already left.
    expect(transitionHomeSessionsLoad(timedOut.state, { type: "fetch.failed", attempt: 1, message: "x" }).state).toBe(
      timedOut.state,
    )
  })

  test("placeholder rows appear only after the delay, fade out over the list, and never over an error", () => {
    const fast = replay([target("connected"), { type: "fetch.succeeded", attempt: 1, reducedMotion: false }])
    expect(view(fast.state)).toEqual({ status: "ready", revealing: false })
    expect(fast.effects).toContainEqual({ type: "timer.stop", timer: "placeholder" })

    const slow = replay([target("connected"), { type: "placeholder.due", since: 1 }])
    const revealed = replay([{ type: "fetch.succeeded", attempt: 1, reducedMotion: false }], slow.state)
    expect(view(revealed.state)).toEqual({ status: "ready", revealing: true })
    expect(view(replay([{ type: "reveal.completed", attempt: 1 }], revealed.state).state)).toEqual({
      status: "ready",
      revealing: false,
    })
    expect(view(replay([{ type: "fetch.succeeded", attempt: 1, reducedMotion: true }], slow.state).state)).toEqual({
      status: "ready",
      revealing: false,
    })

    expect(view(replay([{ type: "fetch.failed", attempt: 1, message: "x" }], slow.state).state).status).toBe("error")

    // Switching to a server with a cached list shows it at once, without fading placeholder rows over it.
    const switched = replay([target("connected", { server: B, cached: true, stale: false })], slow.state)
    expect(view(switched.state)).toEqual({ status: "ready", revealing: false })
    expect(switched.effects).toContainEqual({ type: "timer.stop", timer: "deadline" })
  })

  test("placeholder rows shown while connecting stay up through the first fetch", () => {
    const step = replay([target("connecting"), { type: "placeholder.due", since: 1 }, target("connected")])

    expect(step.state).toMatchObject({ status: "loading", attempt: 2, since: 1, skeleton: true })
    expect(step.effects).toContainEqual({ type: "fetch.start", server: A, attempt: 2 })
    expect(step.effects.some((effect) => effect.type === "timer.start" && effect.timer === "placeholder")).toBe(false)
  })

  test("a fresh cached list shows without a fetch; a stale one shows while it refreshes", () => {
    const fresh = replay([target("connected", { cached: true, stale: false })])
    expect(fresh.state).toMatchObject({ status: "ready" })
    expect(fresh.effects).toEqual([])

    const stale = replay([target("connected", { cached: true, stale: true })])
    expect(stale.state).toMatchObject({ status: "refreshing", attempt: 1 })
    expect(view(stale.state)).toEqual({ status: "ready", revealing: false })

    // A failed refresh keeps the list.
    expect(replay([{ type: "fetch.failed", attempt: 1, message: "x" }], stale.state).state).toMatchObject({
      status: "ready",
    })
  })

  test("a server that goes away keeps its list and stops waiting for the refresh", () => {
    const refreshing = replay([target("connected", { cached: true, stale: true })])
    const offline = replay([target("offline", { cached: true })], refreshing.state)

    expect(offline.state).toMatchObject({ status: "ready" })
    expect(offline.effects).toEqual([{ type: "timer.stop", timer: "deadline" }])
    expect(transitionHomeSessionsLoad(offline.state, target("offline", { cached: true })).state).toBe(offline.state)
  })

  test("an invalidation refreshes the list, and one during a fetch runs one more fetch", () => {
    const ready = replay([target("connected"), { type: "fetch.succeeded", attempt: 1, reducedMotion: false }])
    const refreshing = replay([{ type: "refresh", server: A }], ready.state)
    expect(refreshing.effects).toContainEqual({ type: "fetch.start", server: A, attempt: 2 })

    const queued = replay([{ type: "refresh", server: A }], refreshing.state)
    expect(queued.state).toMatchObject({ status: "refreshing", attempt: 2, queued: true })
    expect(queued.effects).toEqual([])

    const again = replay([{ type: "fetch.succeeded", attempt: 2, reducedMotion: false }], queued.state)
    expect(again.state).toMatchObject({ status: "refreshing", attempt: 3, queued: false })
    expect(again.effects).toContainEqual({ type: "fetch.start", server: A, attempt: 3 })

    // Another server's invalidation changes nothing.
    expect(transitionHomeSessionsLoad(ready.state, { type: "refresh", server: B }).state).toBe(ready.state)
  })

  test("a result for a server the user left is ignored", () => {
    const step = replay([target("connected"), target("connected", { server: B })])
    expect(step.state).toMatchObject({ status: "loading", server: B, attempt: 2 })

    expect(
      transitionHomeSessionsLoad(step.state, { type: "fetch.succeeded", attempt: 1, reducedMotion: false }).state,
    ).toBe(step.state)
    expect(transitionHomeSessionsLoad(step.state, { type: "fetch.failed", attempt: 1, message: "x" }).state).toBe(
      step.state,
    )
  })

  test("disposing stops every timer and ignores what arrives later", () => {
    const loading = replay([target("connected")])
    const disposed = replay([{ type: "disposed" }], loading.state)

    expect(disposed.effects).toEqual([
      { type: "timer.stop", timer: "placeholder" },
      { type: "timer.stop", timer: "deadline" },
    ])

    for (const event of [
      { type: "fetch.succeeded", attempt: 1, reducedMotion: false },
      target("connected", { server: B }),
      { type: "retry" },
    ] satisfies HomeSessionsLoadEvent[]) {
      expect(transitionHomeSessionsLoad(disposed.state, event).state).toBe(disposed.state)
    }
  })
})
