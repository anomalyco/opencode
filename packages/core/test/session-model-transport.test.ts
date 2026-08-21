import { describe, expect, test } from "bun:test"
import { AIError, TransportReason } from "@opencode-ai/ai"
import type {
  ChannelObservation,
  WebSocketChannelExchange,
  WebSocketConnection,
  WebSocketConnector,
} from "@opencode-ai/ai/route"
import { SessionModelTransport } from "@opencode-ai/core/session/model-transport"
import { Session } from "@opencode-ai/schema/session"
import { Deferred, Effect, Fiber, Metric, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Headers } from "effect/unstable/http"

const session = Session.ID.make("ses_transport")
const otherSession = Session.ID.make("ses_transport_other")
const queue = <A, E = never>() => Effect.runSync(Queue.unbounded<A, E>())

const error = (message: string, delivery?: TransportReason["delivery"]) =>
  new AIError({
    module: "test",
    method: "websocket",
    reason: new TransportReason({ message, transport: "websocket", operation: "write", phase: "send", delivery }),
  })

const exchange = (
  id: string,
  input: {
    readonly headers?: Record<string, string>
    readonly fallback?: () => Stream.Stream<string, AIError>
    readonly rotateAfterMs?: number
  } = {},
): WebSocketChannelExchange => ({
  id,
  connect: {
    url: "wss://provider.test/responses",
    headers: Headers.fromInput(input.headers),
    rotateAfterMs: input.rotateAfterMs,
  },
  fallback: input.fallback ?? (() => Stream.make(`fallback:${id}`)),
  driver: {
    create: () => Effect.succeed({ message: id, mode: "full" }),
    observe: (_create, frame): Effect.Effect<ChannelObservation, AIError> =>
      Effect.succeed({ type: "completed", frame }),
  },
})

const run = <A, E>(connector: WebSocketConnector, effect: Effect.Effect<A, E, SessionModelTransport.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SessionModelTransport.makeLayer(connector)), Effect.scoped))

const runWithTestClock = <A, E>(
  connector: WebSocketConnector,
  effect: Effect.Effect<A, E, SessionModelTransport.Service>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(SessionModelTransport.makeLayer(connector)),
      Effect.scoped,
      Effect.provide(TestClock.layer()),
    ),
  )

const collect = (executor: ReturnType<SessionModelTransport.Interface["bind"]>, item: WebSocketChannelExchange) =>
  Effect.gen(function* () {
    const execution = yield* executor.execute(item)
    return Array.from(yield* Stream.runCollect(execution.frames))
  }).pipe(Effect.scoped)

const collectComplete = (
  executor: ReturnType<SessionModelTransport.Interface["bind"]>,
  item: WebSocketChannelExchange,
) =>
  Effect.gen(function* () {
    const execution = yield* executor.execute(item)
    return Array.from(yield* Stream.runCollect(execution.frames.pipe(Stream.onEnd(execution.complete))))
  }).pipe(Effect.scoped)

const automatic = () => {
  const connections: Array<{
    readonly messages: Queue.Queue<string | Uint8Array, AIError>
    readonly headers: Headers.Headers
    closed: number
    sent: string[]
  }> = []
  const connector: WebSocketConnector = {
    open: (input) =>
      Effect.gen(function* () {
        const messages = yield* Queue.unbounded<string | Uint8Array, AIError>()
        const record = { messages, headers: input.headers, closed: 0, sent: [] as string[] }
        connections.push(record)
        const connection: WebSocketConnection = {
          sendText: (message) =>
            Effect.sync(() => {
              record.sent.push(message)
              Queue.offerUnsafe(messages, `completed:${message}`)
            }),
          messages: Stream.fromQueue(messages),
          close: Effect.sync(() => {
            record.closed++
          }).pipe(Effect.andThen(Queue.shutdown(messages)), Effect.asVoid),
        }
        return connection
      }),
  }
  return { connector, connections }
}

describe("SessionModelTransport", () => {
  test("commits checkpoints only after successful outer completion", async () => {
    const messages = queue<string | Uint8Array, AIError>()
    const checkpoints: Array<unknown> = []
    const candidate = { protocol: "test", value: { response: "one" } }
    const connector: WebSocketConnector = {
      open: () =>
        Effect.succeed({
          sendText: (message) =>
            Effect.sync(() => Queue.offerUnsafe(messages, `completed:${message}`)).pipe(Effect.asVoid),
          messages: Stream.fromQueue(messages),
          close: Queue.shutdown(messages).pipe(Effect.asVoid),
        }),
    }
    const item = (id: string): WebSocketChannelExchange => ({
      ...exchange(id),
      driver: {
        create: (checkpoint) =>
          Effect.sync(() => {
            checkpoints.push(checkpoint)
            return { message: id, mode: checkpoint ? "incremental" : "full" }
          }),
        observe: (_create, frame) => Effect.succeed({ type: "completed", frame, checkpoint: candidate }),
      },
    })

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const executor = transport.bind(session)
        yield* collectComplete(executor, item("first"))
        yield* collect(executor, item("second"))
        yield* collect(executor, item("third"))

        expect(checkpoints).toEqual([undefined, candidate, undefined])
      }),
    )
  })

  test("does not carry a checkpoint across physical connection rotation", async () => {
    const fixture = automatic()
    const checkpoints: Array<unknown> = []
    const candidate = { protocol: "test", value: { response: "one" } }
    const item = (id: string, authorization: string): WebSocketChannelExchange => ({
      ...exchange(id, { headers: { authorization } }),
      driver: {
        create: (checkpoint) =>
          Effect.sync(() => {
            checkpoints.push(checkpoint)
            return { message: id, mode: checkpoint ? "incremental" : "full" }
          }),
        observe: (_create, frame) => Effect.succeed({ type: "completed", frame, checkpoint: candidate }),
      },
    })

    await run(
      fixture.connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const executor = transport.bind(session)
        yield* collectComplete(executor, item("first", "one"))
        yield* collect(executor, item("second", "two"))

        expect(checkpoints).toEqual([undefined, undefined])
        expect(fixture.connections).toHaveLength(2)
      }),
    )
  })

  test("clears a rejected checkpoint before the runner retries full", async () => {
    const fixture = automatic()
    const checkpoints: Array<unknown> = []
    const candidate = { protocol: "test", value: { response: "one" } }
    const item = (id: string): WebSocketChannelExchange => ({
      ...exchange(id),
      driver: {
        create: (checkpoint) =>
          Effect.sync(() => {
            checkpoints.push(checkpoint)
            return { message: id, mode: checkpoint ? "incremental" : "full" }
          }),
        observe: (_create, frame) =>
          id === "rejected"
            ? Effect.succeed({
                type: "rejected",
                recovery: "retry-full",
                error: new AIError({
                  module: "test",
                  method: "stream",
                  reason: new TransportReason({
                    message: "missing response",
                    transport: "websocket",
                    operation: "read",
                    phase: "receive",
                    delivery: "rejected",
                    recovery: "retry-full",
                  }),
                }),
              })
            : Effect.succeed({ type: "completed", frame, checkpoint: candidate }),
      },
    })

    await run(
      fixture.connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const executor = transport.bind(session)
        yield* collectComplete(executor, item("first"))
        yield* Effect.result(collect(executor, item("rejected")))
        yield* collect(executor, item("retry"))

        expect(checkpoints).toEqual([undefined, candidate, undefined])
        expect(fixture.connections).toHaveLength(1)
      }),
    )
  })

  test("rotates after the provider rejects the connection generation", async () => {
    const fixture = automatic()
    const rejected: WebSocketChannelExchange = {
      ...exchange("rejected"),
      driver: {
        create: () => Effect.succeed({ message: "rejected", mode: "incremental" }),
        observe: () =>
          Effect.succeed({
            type: "rejected",
            recovery: "rotate-and-retry-full",
            error: new AIError({
              module: "test",
              method: "stream",
              reason: new TransportReason({
                message: "connection limit",
                transport: "websocket",
                operation: "read",
                phase: "receive",
                delivery: "rejected",
                recovery: "rotate-and-retry-full",
              }),
            }),
          }),
      },
    }

    await run(
      fixture.connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const executor = transport.bind(session)
        yield* Effect.result(collect(executor, rejected))
        yield* collect(executor, exchange("retry"))

        expect(fixture.connections).toHaveLength(2)
        expect(fixture.connections[0]?.closed).toBe(1)
      }),
    )
  })

  test("reuses one physical connection for sequential Session calls", async () => {
    const fixture = automatic()

    await run(
      fixture.connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        expect(yield* collect(transport.bind(session), exchange("first"))).toEqual(["completed:first"])
        expect(yield* collect(transport.bind(session), exchange("second"))).toEqual(["completed:second"])
        expect(fixture.connections).toHaveLength(1)
        expect(fixture.connections[0]?.sent).toEqual(["first", "second"])
      }),
    )
  })

  test("serializes concurrent calls for one Session", async () => {
    const started = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const messages = queue<string | Uint8Array, AIError>()
    const sent: string[] = []
    const connector: WebSocketConnector = {
      open: () =>
        Effect.succeed({
          sendText: (message) =>
            Effect.gen(function* () {
              sent.push(message)
              if (message === "first") {
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
              }
              Queue.offerUnsafe(messages, `completed:${message}`)
            }),
          messages: Stream.fromQueue(messages),
          close: Queue.shutdown(messages).pipe(Effect.asVoid),
        }),
    }

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const executor = transport.bind(session)
        const first = yield* collect(executor, exchange("first")).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(started)
        const second = yield* collect(executor, exchange("second")).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Effect.yieldNow
        expect(sent).toEqual(["first"])
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        expect(sent).toEqual(["first", "second"])
      }),
    )
  })

  test("isolates connections and permits concurrency across Sessions", async () => {
    const started = queue<string>()
    const release = Deferred.makeUnsafe<void>()
    let opened = 0
    const connector: WebSocketConnector = {
      open: () =>
        Effect.gen(function* () {
          opened++
          const messages = yield* Queue.unbounded<string | Uint8Array, AIError>()
          return {
            sendText: (message) =>
              Effect.gen(function* () {
                Queue.offerUnsafe(started, message)
                yield* Deferred.await(release)
                Queue.offerUnsafe(messages, `completed:${message}`)
              }),
            messages: Stream.fromQueue(messages),
            close: Queue.shutdown(messages).pipe(Effect.asVoid),
          }
        }),
    }

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const first = yield* collect(transport.bind(session), exchange("first")).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        const second = yield* collect(transport.bind(otherSession), exchange("second")).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        expect(new Set([yield* Queue.take(started), yield* Queue.take(started)])).toEqual(new Set(["first", "second"]))
        expect(opened).toBe(2)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      }),
    )
  })

  test("cancels a queued call without affecting the active exchange", async () => {
    const started = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const messages = queue<string | Uint8Array, AIError>()
    const sent: string[] = []
    const connector: WebSocketConnector = {
      open: () =>
        Effect.succeed({
          sendText: (message) =>
            Effect.gen(function* () {
              sent.push(message)
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              Queue.offerUnsafe(messages, `completed:${message}`)
            }),
          messages: Stream.fromQueue(messages),
          close: Queue.shutdown(messages).pipe(Effect.asVoid),
        }),
    }

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const executor = transport.bind(session)
        const active = yield* collect(executor, exchange("active")).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(started)
        const queued = yield* collect(executor, exchange("queued")).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Fiber.interrupt(queued)
        expect(sent).toEqual(["active"])
        yield* Deferred.succeed(release, undefined)
        expect(yield* Fiber.join(active)).toEqual(["completed:active"])
      }),
    )
  })

  test("closes the connection when an active exchange is interrupted", async () => {
    const started = Deferred.makeUnsafe<void>()
    const messages = queue<string | Uint8Array, AIError>()
    let closed = 0
    const connector: WebSocketConnector = {
      open: () =>
        Effect.succeed({
          sendText: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          messages: Stream.fromQueue(messages),
          close: Effect.sync(() => closed++).pipe(Effect.andThen(Queue.shutdown(messages)), Effect.asVoid),
        }),
    }

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const fiber = yield* collect(transport.bind(session), exchange("first")).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        yield* Deferred.await(started)
        yield* Fiber.interrupt(fiber)
        expect(closed).toBe(1)
      }),
    )
  })

  test("closes an active exchange without waiting for its Session permit", async () => {
    const started = Deferred.makeUnsafe<void>()
    const messages = queue<string | Uint8Array, AIError>()
    let closed = 0
    const connector: WebSocketConnector = {
      open: () =>
        Effect.succeed({
          sendText: () => Deferred.succeed(started, undefined),
          messages: Stream.fromQueue(messages),
          close: Effect.sync(() => closed++).pipe(Effect.andThen(Queue.shutdown(messages)), Effect.asVoid),
        }),
    }

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const running = yield* collect(transport.bind(session), exchange("active")).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        yield* Deferred.await(started)

        yield* transport.close(session)
        const result = yield* Effect.result(Fiber.join(running))

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { reason: { _tag: "Transport", code: "close", delivery: "ambiguous" } },
        })
        expect(closed).toBe(1)
      }),
    )
  })

  test("times out an idle accepted request and poisons its socket", async () => {
    const started = Deferred.makeUnsafe<void>()
    const messages = queue<string | Uint8Array, AIError>()
    let closed = 0
    const connector: WebSocketConnector = {
      open: () =>
        Effect.succeed({
          sendText: () => Deferred.succeed(started, undefined),
          messages: Stream.fromQueue(messages),
          close: Effect.sync(() => closed++).pipe(Effect.andThen(Queue.shutdown(messages)), Effect.asVoid),
        }),
    }

    await runWithTestClock(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const running = yield* collect(transport.bind(session), exchange("idle")).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        yield* Deferred.await(started)
        yield* Effect.yieldNow

        yield* TestClock.adjust("5 minutes")
        const result = yield* Effect.result(Fiber.join(running))

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { reason: { _tag: "Transport", code: "idle-timeout", delivery: "ambiguous" } },
        })
        expect(closed).toBe(1)
      }),
    )
  })

  test("closes a newly opened connection when request creation is interrupted", async () => {
    const opened = Deferred.makeUnsafe<void>()
    const messages = queue<string | Uint8Array, AIError>()
    let closed = 0
    const connector: WebSocketConnector = {
      open: () =>
        Deferred.succeed(opened, undefined).pipe(
          Effect.as({
            sendText: () => Effect.void,
            messages: Stream.fromQueue(messages),
            close: Effect.sync(() => closed++).pipe(Effect.andThen(Queue.shutdown(messages)), Effect.asVoid),
          }),
        ),
    }

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const item = exchange("first")
        const fiber = yield* collect(transport.bind(session), {
          ...item,
          driver: { create: () => Effect.never, observe: item.driver.observe },
        }).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(opened)
        yield* Fiber.interrupt(fiber)
        expect(closed).toBe(1)
      }),
    )
  })

  test("falls back once when connection setup fails before send", async () => {
    let fallbacks = 0
    const connector: WebSocketConnector = { open: () => Effect.fail(error("upgrade rejected", "not-sent")) }

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const result = yield* collect(
          transport.bind(session),
          exchange("first", {
            fallback: () => {
              fallbacks++
              return Stream.make("http")
            },
          }),
        )
        expect(result).toEqual(["http"])
        expect(fallbacks).toBe(1)
      }),
    )
  })

  test("does not fall back after an ambiguous send failure", async () => {
    const messages = queue<string | Uint8Array, AIError>()
    let fallbacks = 0
    let closed = 0
    const connector: WebSocketConnector = {
      open: () =>
        Effect.succeed({
          sendText: () => Effect.fail(error("send failed")),
          messages: Stream.fromQueue(messages),
          close: Effect.sync(() => closed++).pipe(Effect.andThen(Queue.shutdown(messages)), Effect.asVoid),
        }),
    }

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const result = yield* Effect.result(
          collect(
            transport.bind(session),
            exchange("first", {
              fallback: () => {
                fallbacks++
                return Stream.make("http")
              },
            }),
          ),
        )
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { reason: { _tag: "Transport", phase: "send", delivery: "ambiguous" } },
        })
        expect(fallbacks).toBe(0)
        expect(closed).toBe(1)
      }),
    )
  })

  test("rotates when refreshed authorization changes handshake affinity", async () => {
    const fixture = automatic()

    await run(
      fixture.connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const executor = transport.bind(session)
        yield* collect(executor, exchange("first", { headers: { authorization: "one" } }))
        yield* collect(executor, exchange("second", { headers: { authorization: "one" } }))
        yield* collect(executor, exchange("third", { headers: { authorization: "two" } }))
        expect(fixture.connections).toHaveLength(2)
        expect(fixture.connections[0]?.closed).toBe(1)
        expect(fixture.connections.map((item) => item.headers.authorization)).toEqual(["one", "two"])
      }),
    )
  })

  test("rotates when the connection exceeds its requested age limit", async () => {
    const fixture = automatic()

    await run(
      fixture.connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const executor = transport.bind(session)
        yield* collect(executor, exchange("first"))
        yield* Effect.sleep("5 millis")
        yield* collect(executor, exchange("second", { rotateAfterMs: 1 }))
        expect(fixture.connections).toHaveLength(2)
        expect(fixture.connections[0]?.closed).toBe(1)
      }),
    )
  })

  test("poisons a socket that receives data while idle", async () => {
    const fixture = automatic()

    await run(
      fixture.connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const executor = transport.bind(session)
        yield* collect(executor, exchange("first"))
        const connection = fixture.connections[0]
        if (!connection) throw new Error("Expected connection")
        Queue.offerUnsafe(connection.messages, "late")
        yield* Effect.yieldNow
        yield* collect(executor, exchange("second"))
        expect(fixture.connections).toHaveLength(2)
        expect(fixture.connections[0]?.closed).toBe(1)
      }),
    )
  })

  test("poisons instead of dropping data when the inbound queue overflows", async () => {
    const messages = queue<string | Uint8Array, AIError>()
    let closed = 0
    const connector: WebSocketConnector = {
      open: () =>
        Effect.succeed({
          sendText: () =>
            Effect.sync(() => {
              for (let index = 0; index <= 129; index++) Queue.offerUnsafe(messages, `frame:${index}`)
            }),
          messages: Stream.fromQueue(messages),
          close: Effect.sync(() => closed++).pipe(Effect.andThen(Queue.shutdown(messages)), Effect.asVoid),
        }),
    }

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const item = exchange("first")
        const result = yield* Effect.result(
          collect(transport.bind(session), {
            ...item,
            driver: {
              create: item.driver.create,
              observe: (_create, frame) => Effect.sleep("1 millis").pipe(Effect.as({ type: "frame" as const, frame })),
            },
          }),
        )
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { reason: { _tag: "Transport", code: "queue-overflow", delivery: "accepted" } },
        })
        expect(closed).toBe(1)
      }),
    )
  })

  test("poisons unsupported binary frames after provider observation", async () => {
    const messages = queue<string | Uint8Array, AIError>()
    const closed = Deferred.makeUnsafe<void>()
    const connector: WebSocketConnector = {
      open: () =>
        Effect.succeed({
          sendText: () => Effect.sync(() => Queue.offerUnsafe(messages, new Uint8Array([1]))).pipe(Effect.asVoid),
          messages: Stream.fromQueue(messages),
          close: Deferred.succeed(closed, undefined).pipe(Effect.andThen(Queue.shutdown(messages)), Effect.asVoid),
        }),
    }

    await run(
      connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const result = yield* Effect.result(collect(transport.bind(session), exchange("first")))
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { reason: { _tag: "Transport", code: "message", delivery: "accepted" } },
        })
        yield* Deferred.await(closed)
      }),
    )
  })

  test("closes individual and all owned connections", async () => {
    const fixture = automatic()

    await run(
      fixture.connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        yield* collect(transport.bind(session), exchange("first"))
        yield* collect(transport.bind(otherSession), exchange("second"))
        yield* transport.close(session)
        expect(fixture.connections.map((item) => item.closed)).toEqual([1, 0])
        yield* transport.closeAll
        expect(fixture.connections.map((item) => item.closed)).toEqual([1, 1])
      }),
    )
  })

  test("closes owned connections when the Location scope ends", async () => {
    const fixture = automatic()

    await run(
      fixture.connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        yield* collect(transport.bind(session), exchange("first"))
        expect(fixture.connections[0]?.closed).toBe(0)
      }),
    )

    expect(fixture.connections[0]?.closed).toBe(1)
  })

  test("records metadata-only lifecycle metrics", async () => {
    const fixture = automatic()

    await run(
      fixture.connector,
      Effect.gen(function* () {
        const transport = yield* SessionModelTransport.Service
        const executor = transport.bind(session)
        yield* collect(executor, exchange("first", { headers: { authorization: "secret-one" } }))
        yield* collect(executor, exchange("second", { headers: { authorization: "secret-one" } }))
        yield* collect(executor, exchange("third", { headers: { authorization: "secret-two" } }))

        const snapshots = yield* Metric.snapshot
        const lifecycle = snapshots.filter((item) => item.id === "opencode_session_websocket_events_total")
        const names = new Set(lifecycle.map((item) => item.attributes?.event))
        expect(Array.from(names)).toEqual(
          expect.arrayContaining(["connect", "reuse", "rotation", "reconnect", "send", "terminal"]),
        )
        expect(JSON.stringify(lifecycle)).not.toContain("secret-one")
        expect(JSON.stringify(lifecycle)).not.toContain("secret-two")
      }),
    )
  })
})
