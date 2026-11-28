import { describe, expect, test } from "bun:test"
import FastCheck from "fast-check"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { serve, type Fixture } from "./fixture/http"
import { DIRECTORIES, remote, world, type Place } from "./harness"

// A model of what two Locations should report for one server, checked against the real service after every step of
// generated operation sequences. Steps run on real sockets; the test clock runs every timer (startup windows, event
// stream backoff) while a step settles. Sequences the property once failed on stay below as fixed traces.

type At = 0 | 1
type Op =
  | { readonly _tag: "connect" | "disconnect" | "call" | "close" | "open" | "unsubscribe"; readonly at: At }
  | { readonly _tag: "subscribe"; readonly at: At; readonly cursor?: null }
  | { readonly _tag: "refuse" | "allow" | "down" | "up" | "restart" | "emit" }

type Status = "connected" | "disabled" | "failed" | "needs_auth"

interface Expected {
  open: boolean
  status: Status
  sub: "none" | "live" | "ended"
  /** When the last subscription started from now: how many events had been emitted, and how many it had seen. */
  since?: { readonly emitted: number; readonly seen: number }
}

interface Fault {
  /** The server answers 401: only a new sign-in helps. */
  refused: boolean
  /** The server answers 501, which nothing retries. */
  down: boolean
}

interface Row {
  readonly era: "modern" | "legacy"
  readonly pool: boolean
}

const rows: ReadonlyArray<Row> = [
  { era: "modern", pool: false },
  { era: "modern", pool: true },
  { era: "legacy", pool: false },
]

const at = FastCheck.constantFrom<At>(0, 1)
const located = (...tags: ReadonlyArray<"connect" | "disconnect" | "call" | "close" | "open" | "unsubscribe">) =>
  FastCheck.record({ _tag: FastCheck.constantFrom(...tags), at })
const op: FastCheck.Arbitrary<Op> = FastCheck.oneof(
  { arbitrary: located("call", "connect"), weight: 4 },
  { arbitrary: located("disconnect", "close", "open", "unsubscribe"), weight: 2 },
  {
    arbitrary: FastCheck.record({
      _tag: FastCheck.constant("subscribe"),
      at,
      cursor: FastCheck.constantFrom(undefined, null),
    }),
    weight: 2,
  },
  {
    arbitrary: FastCheck.record({ _tag: FastCheck.constantFrom("refuse", "allow", "down", "up", "restart", "emit") }),
    weight: 3,
  },
)

describe("MCP lifecycle model", () => {
  for (const row of rows)
    test(
      `${row.era} ${row.pool ? "pooled" : "direct"}`,
      () =>
        FastCheck.assert(
          FastCheck.asyncProperty(FastCheck.array(op, { maxLength: 16 }), (ops) =>
            Effect.runPromise(scenario(row, ops)),
          ),
          { numRuns: Number(process.env.MCP_MODEL_RUNS ?? 30), seed: 66923 },
        ),
      60_000,
    )
})

const traces: ReadonlyArray<readonly [string, Row, ReadonlyArray<Op>]> = [
  [
    "a refused call ends a shared connection in needs_auth for every Location",
    { era: "modern", pool: true },
    [{ _tag: "refuse" }, { _tag: "call", at: 0 }],
  ],
  [
    "a subscription waits out a connection that needs a sign-in",
    { era: "modern", pool: false },
    [{ _tag: "refuse" }, { _tag: "call", at: 0 }, { _tag: "subscribe", at: 0 }],
  ],
  [
    "a subscription keeps following through a reconnect of a shared connection",
    { era: "modern", pool: true },
    [
      { _tag: "subscribe", at: 0 },
      { _tag: "connect", at: 0 },
      { _tag: "connect", at: 1 },
    ],
  ],
  [
    "subscribing again from now skips what was emitted while it was ended",
    { era: "modern", pool: false },
    [
      { _tag: "subscribe", at: 0 },
      { _tag: "disconnect", at: 0 },
      { _tag: "emit" },
      { _tag: "connect", at: 0 },
      { _tag: "subscribe", at: 0, cursor: null },
    ],
  ],
  [
    "a call after the server forgot the session reconnects and retries",
    { era: "legacy", pool: false },
    [{ _tag: "restart" }, { _tag: "call", at: 0 }, { _tag: "refuse" }, { _tag: "restart" }, { _tag: "call", at: 1 }],
  ],
  [
    "a Location joins a shared connection another one holds, and the last to leave closes it",
    { era: "modern", pool: true },
    [
      { _tag: "down" },
      { _tag: "connect", at: 1 },
      { _tag: "close", at: 0 },
      { _tag: "connect", at: 1 },
      { _tag: "open", at: 0 },
    ],
  ],
]

describe("MCP lifecycle traces", () => {
  for (const [name, row, ops] of traces) test(name, () => Effect.runPromise(scenario(row, ops)))
})

function scenario(row: Row, ops: ReadonlyArray<Op>) {
  return Effect.gen(function* () {
    const server = yield* serve({ era: row.era, events: row.era === "modern" })
    const fault: Fault = { refused: false, down: false }
    server.intercept(() =>
      fault.down
        ? new Response(null, { status: 501 })
        : fault.refused
          ? new Response(null, { status: 401 })
          : undefined,
    )
    const places = yield* world
    // Signs in with OAuth, so a 401 means needs_auth.
    const config = remote(server.url, { pool: row.pool, oauth: undefined })
    const model = [0, 1].map((): Expected => ({ open: false, status: "disabled", sub: "none" }))
    const live: Array<Place | undefined> = [undefined, undefined]

    // What a start reports: a pooled Location joins a connection another one holds, without a handshake.
    const start = (index: At): Status => {
      const other = model[1 - index]
      if (row.pool && other.open && other.status === "connected") return "connected"
      return fault.down ? "failed" : fault.refused ? "needs_auth" : "connected"
    }
    const open = Effect.fnUntraced(function* (index: At) {
      live[index] = yield* places.open({ directory: DIRECTORIES[index], servers: { fixture: config } })
      model[index] = { open: true, status: start(index), sub: "none" }
    })

    const apply = Effect.fnUntraced(function* (op: Op) {
      switch (op._tag) {
        case "refuse":
          return void (fault.refused = true)
        case "allow":
          return void (fault.refused = false)
        case "down":
          return void (fault.down = true)
        case "up":
          return void (fault.down = false)
        case "emit":
          return void server.emit()
        // A legacy server forgets every session; the next request on one reconnects and retries.
        case "restart":
          return row.era === "legacy" ? yield* server.restart() : undefined
        case "open":
          return model[op.at].open ? undefined : yield* open(op.at)
      }
      const state = model[op.at]
      const place = live[op.at]
      if (!state.open || !place) return
      switch (op._tag) {
        case "close":
          live[op.at] = undefined
          model[op.at] = { open: false, status: "disabled", sub: "none" }
          return yield* place.close
        case "connect":
          yield* place.mcp.connect("fixture")
          // It lets go of its own claim first, so it joins only a connection another Location still holds.
          state.status = "disabled"
          state.status = start(op.at)
          return
        case "disconnect":
          yield* place.mcp.disconnect("fixture")
          state.status = "disabled"
          if (state.sub === "live") state.sub = "ended"
          return
        case "call": {
          const result = yield* place.mcp.callTool({ server: "fixture", name: "echo" }).pipe(Effect.result)
          expect(result._tag).toBe(
            state.status === "connected" && !fault.down && !fault.refused ? "Success" : "Failure",
          )
          // A refused credential ends the connection, for every Location that shares it.
          if (state.status === "connected" && !fault.down && fault.refused)
            for (const item of row.pool ? model : [state])
              if (item.open && item.status === "connected") item.status = "needs_auth"
          return
        }
        case "subscribe":
          if (row.era !== "modern") return
          if (state.sub !== "live" && op.cursor === null)
            state.since = { emitted: server.emitted(), seen: place.events.length }
          yield* place.mcp.subscribe("fixture", { name: "job.finished", cursor: op.cursor })
          if (state.sub !== "live") state.sub = state.status === "disabled" ? "ended" : "live"
          return
        case "unsubscribe": {
          const subscription = (yield* place.mcp.subscriptions())[0]
          if (subscription) yield* place.mcp.unsubscribe(subscription.id)
          state.sub = "none"
          return
        }
      }
    })

    yield* open(0)
    yield* open(1)
    yield* check(server, live, model, fault)
    for (const step of ops) {
      yield* apply(step)
      yield* check(server, live, model, fault)
    }
    for (const place of live) if (place) yield* place.close
    // Closing every Location leaves no event stream open.
    yield* settle(server, "event streams to close", Effect.sync(server.streams), (streams) => streams.length === 0)
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer()))
}

// After each step, once settled: every Location reports what the model says, offers what it reports, has no waiter
// stuck on a finished startup, and follows events exactly while it should.
const check = (server: Fixture, live: ReadonlyArray<Place | undefined>, model: ReadonlyArray<Expected>, fault: Fault) =>
  Effect.forEach(
    model,
    Effect.fnUntraced(function* (expected, index) {
      const place = live[index]
      if (!expected.open || !place) return
      yield* settle(
        server,
        `location ${index} to be ${expected.status}`,
        place.status("fixture"),
        (status) => status?.status === expected.status,
      )
      expect((yield* place.mcp.tools()).length > 0).toBe(expected.status === "connected")
      if (expected.status !== "connected") expect(yield* place.mcp.prompts()).toEqual([])
      // Nothing is starting, so nobody waits for a startup.
      const waiting = yield* place.mcp.awaitStartup().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.promise(() => Bun.sleep(1))
      expect(waiting.pollUnsafe()).toBeDefined()
      yield* Fiber.interrupt(waiting)
      yield* follows(server, place, index, expected, fault)

      // No event reaches a Location twice, and one started from now delivers nothing emitted before it.
      const delivered = place.events.flatMap((event, position) =>
        event.type === "experimental.mcp.event"
          ? [{ id: Number((event.data as { eventId: string }).eventId.slice(1)), position }]
          : [],
      )
      expect(delivered.map((event) => event.id)).toEqual(Array.from(new Set(delivered.map((event) => event.id))))
      const since = expected.since
      if (since)
        for (const event of delivered.filter((event) => event.position >= since.seen))
          expect(event.id).toBeGreaterThan(since.emitted)
    }),
    { discard: true },
  )

// A live subscription delivers the next event while its server serves it and waits to reopen while it can't; an
// ended one stays ended.
const follows = (server: Fixture, place: Place, index: number, expected: Expected, fault: Fault) =>
  Effect.gen(function* () {
    const subscription = (yield* place.mcp.subscriptions())[0]
    if (expected.sub === "none") return expect(subscription).toBeUndefined()
    if (expected.sub === "ended")
      return yield* settle(
        server,
        `location ${index}'s subscription to end`,
        place.mcp.subscriptions(),
        (all) => all[0]?.status.status === "ended",
      )
    if (expected.status !== "connected" || fault.refused || fault.down)
      return expect(subscription?.status.status).not.toBe("ended")
    yield* settle(
      server,
      `location ${index}'s subscription to be active`,
      place.mcp.subscriptions(),
      (all) => all[0]?.status.status === "active",
    )
    const eventId = server.emit()
    yield* settle(
      server,
      `location ${index} to receive ${eventId}`,
      Effect.sync(() => place.events),
      (events) =>
        events.some(
          (event) => event.type === "experimental.mcp.event" && (event.data as { eventId: string }).eventId === eventId,
        ),
    )
  })

// Alternates a real millisecond, for sockets, with 200 virtual ones, for timers (event stream backoff), until
// `predicate` holds. The clock stays put while the server is answering a request, so no timeout on the test clock
// (a startup deadline, a session termination) runs out before a slow reply arrives.
const settle = <A, E, R>(
  server: Fixture,
  label: string,
  effect: Effect.Effect<A, E, R>,
  predicate: (value: A) => boolean,
) =>
  Effect.gen(function* () {
    const deadline = Date.now() + 5_000
    while (true) {
      const value = yield* effect
      if (predicate(value)) return value
      if (Date.now() > deadline)
        return yield* Effect.die(new Error(`Timed out waiting for ${label}: ${JSON.stringify(value)}`))
      yield* Effect.promise(() => Bun.sleep(1))
      if (!server.busy()) yield* TestClock.adjust("200 millis")
    }
  })
