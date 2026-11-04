import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { BackgroundServiceMachine } from "./background-service-machine"

const A = { url: "http://127.0.0.1:4100", password: "a" }

const B = { url: "http://127.0.0.1:4200", password: "b" }

const C = { url: "http://127.0.0.1:4300", password: "c" }

const reply = (): BackgroundServiceMachine.Reply => ({ resolve: () => undefined, reject: () => undefined })

// Folds events through the machine and keeps the commands of each step.
function replay(
  events: readonly BackgroundServiceMachine.Event[],
  from: BackgroundServiceMachine.State = BackgroundServiceMachine.initialTransition().state,
) {
  return events.reduce<{
    state: BackgroundServiceMachine.State
    commands: (readonly BackgroundServiceMachine.Command[])[]
  }>(
    (result, event) => {
      const next = BackgroundServiceMachine.transition(result.state, event)

      return { state: next.state, commands: [...result.commands, next.commands] }
    },
    { state: from, commands: [] },
  )
}

const readyA = replay([{ type: "connect.succeeded", attempt: 1, data: A }]).state

describe("background service connection", () => {
  test("starts the initial connect at once", () => {
    expect(BackgroundServiceMachine.initialTransition()).toEqual({
      state: { status: "connecting", attempt: 1, waiters: [] },
      commands: [{ type: "connect", attempt: 1, mode: "initial" }],
    })
  })

  test("windows that reconnect together share one attempt and all move to its service", () => {
    const [r1, r2, r3] = [reply(), reply(), reply()]

    const result = replay(
      [
        { type: "reconnect.requested", reply: r1 },
        { type: "reconnect.requested", reply: r2 },
        { type: "connection.requested", reply: r3 },
        { type: "connect.succeeded", attempt: 2, data: B },
      ],
      readyA,
    )

    expect(result.commands).toEqual([
      [{ type: "connect", attempt: 2, mode: "reconnect" }],
      [],
      [],
      [
        { type: "publish", data: B },
        { type: "resolve", replies: [r1, r2, r3], data: B },
      ],
    ])
    expect(result.state).toEqual({ status: "ready", attempt: 2, data: B })
  })

  test("a reconnect that finds the same service publishes nothing", () => {
    const r1 = reply()

    const result = replay(
      [
        { type: "reconnect.requested", reply: r1 },
        { type: "connect.succeeded", attempt: 2, data: { ...A } },
      ],
      readyA,
    )

    expect(result.commands.at(-1)).toEqual([{ type: "resolve", replies: [r1], data: A }])
  })

  test("a probed service is adopted at once and replaced by the one its verification settles on", () => {
    const r1 = reply()

    const probed = replay([
      { type: "connection.requested", reply: r1 },
      { type: "probe.succeeded", attempt: 1, data: A },
    ])

    expect(probed.commands.at(-1)).toEqual([
      { type: "publish", data: A },
      { type: "resolve", replies: [r1], data: A },
      { type: "verify", attempt: 1 },
    ])

    const replaced = replay([{ type: "verify.succeeded", attempt: 1, data: B }], probed.state)

    expect(replaced.state).toEqual({ status: "ready", attempt: 1, data: B })
    expect(replaced.commands).toEqual([[{ type: "publish", data: B }]])

    const confirmed = replay([{ type: "verify.succeeded", attempt: 1, data: { ...A } }], probed.state)

    expect(confirmed.state).toBe(probed.state)
    expect(confirmed.commands).toEqual([[]])
  })

  test("a failed verification keeps the probed service", () => {
    const probed = replay([{ type: "probe.succeeded", attempt: 1, data: A }]).state
    const result = replay([{ type: "verify.failed", attempt: 1, error: new Error("handoff failed") }], probed)

    expect(result.state).toBe(probed)
    expect(result.commands).toEqual([[]])
  })

  test("a failed initial connect is retried by the next window instead of replayed", () => {
    const [r1, r2] = [reply(), reply()]
    const error = new Error("config invalid")

    const result = replay([
      { type: "connection.requested", reply: r1 },
      { type: "connect.failed", attempt: 1, error },
      { type: "connection.requested", reply: r2 },
      { type: "connect.succeeded", attempt: 2, data: A },
    ])

    expect(result.commands).toEqual([
      [],
      [{ type: "reject", replies: [r1], error }],
      [{ type: "connect", attempt: 2, mode: "initial" }],
      [
        { type: "publish", data: A },
        { type: "resolve", replies: [r2], data: A },
      ],
    ])
  })

  test("a failed reconnect keeps the last service and retries as a reconnect", () => {
    const [r1, r2] = [reply(), reply()]
    const error = new Error("port in use")

    const failed = replay(
      [
        { type: "reconnect.requested", reply: r1 },
        { type: "connect.failed", attempt: 2, error },
      ],
      readyA,
    )

    expect(failed.state).toEqual({ status: "failed", attempt: 2, error, last: A })
    expect(failed.commands.at(-1)).toEqual([{ type: "reject", replies: [r1], error }])

    const retried = replay([{ type: "connection.requested", reply: r2 }], failed.state)

    expect(retried.state).toEqual({ status: "reconnecting", attempt: 3, data: A, waiters: [r2] })
    expect(retried.commands).toEqual([[{ type: "connect", attempt: 3, mode: "reconnect" }]])
  })

  test("ignores results of an attempt a reconnect superseded", () => {
    const r1 = reply()
    const probed = replay([{ type: "probe.succeeded", attempt: 1, data: A }]).state
    const reconnecting = replay([{ type: "reconnect.requested", reply: r1 }], probed).state

    const result = replay(
      [
        { type: "verify.succeeded", attempt: 1, data: C },
        { type: "verify.failed", attempt: 1, error: new Error("late") },
        { type: "connect.succeeded", attempt: 1, data: C },
        { type: "connect.failed", attempt: 1, error: new Error("late") },
        { type: "probe.succeeded", attempt: 2, data: C },
      ],
      reconnecting,
    )

    expect(result.state).toBe(reconnecting)
    expect(result.commands.flat()).toEqual([])
  })

  test("a window that stops waiting leaves the attempt to the others", () => {
    const [r1, r2] = [reply(), reply()]

    const waiting = replay([
      { type: "connection.requested", reply: r1 },
      { type: "connection.requested", reply: r2 },
    ]).state

    const cancelled = replay([{ type: "waiter.cancelled", reply: r1 }], waiting)
    const unknown = replay([{ type: "waiter.cancelled", reply: reply() }], cancelled.state)
    const done = replay([{ type: "connect.succeeded", attempt: 1, data: A }], cancelled.state)

    expect(cancelled.state).toEqual({ status: "connecting", attempt: 1, waiters: [r2] })
    expect(unknown.state).toBe(cancelled.state)
    expect(done.commands.at(-1)).toContainEqual({ type: "resolve", replies: [r2], data: A })
  })

  test("disposal rejects every waiter and every later caller", () => {
    const [r1, r2, r3] = [reply(), reply(), reply()]
    const reconnecting = replay([{ type: "reconnect.requested", reply: r1 }], readyA).state

    const result = replay(
      [
        { type: "disposed" },
        { type: "connect.succeeded", attempt: 2, data: B },
        { type: "connection.requested", reply: r2 },
        { type: "reconnect.requested", reply: r3 },
      ],
      reconnecting,
    )

    expect(result.state).toEqual({ status: "disposed" })
    expect(result.commands.map((commands) => commands.map((command) => command.type))).toEqual([
      ["reject"],
      [],
      ["reject"],
      ["reject"],
    ])
    expect(result.commands.flat().flatMap((command) => (command.type === "reject" ? command.replies : []))).toEqual([
      r1,
      r2,
      r3,
    ])
  })
})

describe("background service driver", () => {
  test("callers wait for the initial connect", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>()

          const machine = yield* BackgroundServiceMachine.make({
            probe: Effect.succeed(undefined),
            ensure: () => Deferred.await(gate).pipe(Effect.as(A)),
            publish: () => undefined,
          })

          const consumer = yield* Effect.forkChild(machine.connection, { startImmediately: true })
          yield* Effect.yieldNow
          expect(consumer.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(gate, undefined)

          return yield* Fiber.join(consumer)
        }),
      ),
    )

    expect(result).toEqual(A)
  })

  test("a connect that dies fails its callers, and the next caller connects again", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>()
          const attempts: string[] = []

          const machine = yield* BackgroundServiceMachine.make({
            probe: Effect.succeed(undefined),
            ensure: (mode) =>
              Effect.suspend(() => {
                attempts.push(mode)

                return attempts.length === 1
                  ? Deferred.await(gate).pipe(Effect.andThen(Effect.die(new Error("CLI missing"))))
                  : Effect.succeed(A)
              }),
            publish: () => undefined,
          })

          const waiting = yield* Effect.forkChild(machine.connection.pipe(Effect.exit), { startImmediately: true })
          yield* Deferred.succeed(gate, undefined)
          const first = yield* Fiber.join(waiting)

          return { first: first._tag, second: yield* machine.connection, attempts }
        }),
      ),
    )

    expect(result).toEqual({ first: "Failure", second: A, attempts: ["initial", "initial"] })
  })

  test("concurrent reconnects run one ensure and publish each new service once", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>()
          const attempts: string[] = []
          const published: string[] = []

          const machine = yield* BackgroundServiceMachine.make({
            probe: Effect.succeed(undefined),
            ensure: (mode) =>
              Effect.suspend(() => {
                attempts.push(mode)

                return mode === "initial" ? Effect.succeed(A) : Deferred.await(gate).pipe(Effect.as(B))
              }),
            publish: (data) => published.push(data.url),
          })

          yield* machine.connection

          const fibers = yield* Effect.forEach([1, 2, 3], () =>
            Effect.forkChild(machine.reconnect, { startImmediately: true }),
          )

          yield* Effect.yieldNow
          yield* Deferred.succeed(gate, undefined)

          return { replies: yield* Fiber.joinAll(fibers), attempts, published }
        }),
      ),
    )

    expect(result).toEqual({
      replies: [B, B, B],
      attempts: ["initial", "reconnect"],
      published: [A.url, B.url],
    })
  })

  test("adopts a probed service and moves to the one its verification starts", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>()
          const verified = yield* Deferred.make<void>()
          const published: string[] = []

          const machine = yield* BackgroundServiceMachine.make({
            probe: Effect.succeed(A),
            ensure: () => Deferred.await(gate).pipe(Effect.as(B)),
            publish: (data) => {
              published.push(data.url)

              if (data.url === B.url) Deferred.doneUnsafe(verified, Effect.void)
            },
          })

          const first = yield* machine.connection
          yield* Deferred.succeed(gate, undefined)
          yield* Deferred.await(verified)

          return { first, next: yield* machine.connection, published }
        }),
      ),
    )

    expect(result).toEqual({ first: A, next: B, published: [A.url, B.url] })
  })
})
