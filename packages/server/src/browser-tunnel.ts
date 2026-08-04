export * as BrowserTunnelServer from "./browser-tunnel"

import { BrowserHost } from "@opencode-ai/core/browser-host"
import { BrowserTunnelProtocol } from "@opencode-ai/protocol/browser-tunnel"
import { BrowserTunnel } from "@opencode-ai/schema/browser-tunnel"
import {
  Cause,
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Ref,
  Result,
  Schema,
  Scope,
  SynchronizedRef,
} from "effect"
import { Socket } from "effect/unstable/socket"
import { BrowserControlConnection } from "./browser-control-connection"

const ActiveLimit = 64

export class CapacityError extends Schema.TaggedErrorClass<CapacityError>()("BrowserTunnel.CapacityError", {
  limit: Schema.Int,
  message: Schema.String,
}) {}

class TunnelError extends Schema.TaggedErrorClass<TunnelError>()("BrowserTunnel.TunnelError", {
  kind: Schema.Literals(["closed", "protocol", "target", "revoked"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

class ConnectError extends Schema.TaggedErrorClass<ConnectError>()("BrowserTunnel.ConnectError", {
  kind: Schema.Literals(["failed", "timeout"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

type Dial = (host: string, port: number) => Effect.Effect<import("node:net").Socket, ConnectError, Scope.Scope>
type State = { readonly active: number; readonly shutdown: boolean }

export interface Connection {
  readonly run: (socket: Socket.Socket, opened?: Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>
}

export interface Interface {
  readonly acquire: Effect.Effect<Connection, CapacityError, Scope.Scope>
  readonly shutdown: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/BrowserTunnel") {}

export function make(dial: Dial = connect) {
  return Effect.gen(function* () {
    const browser = yield* BrowserHost.Service
    const state = yield* SynchronizedRef.make<State>({ active: 0, shutdown: false })
    const connections = new Set<Effect.Effect<void>>()
    const shutdown = Effect.fn("BrowserTunnel.shutdown")(function* () {
      const close = yield* SynchronizedRef.modify(state, (current) => [
        !current.shutdown,
        { ...current, shutdown: true },
      ])
      if (close) yield* Effect.all(connections, { concurrency: "unbounded", discard: true })
    })
    yield* Effect.addFinalizer(shutdown)

    const acquire: Interface["acquire"] = Effect.acquireRelease(
      SynchronizedRef.modifyEffect(
        state,
        Effect.fnUntraced(function* (current) {
          if (current.shutdown || current.active >= ActiveLimit) {
            return yield* new CapacityError({ limit: ActiveLimit, message: "Browser tunnel capacity is unavailable." })
          }
          return [undefined, { ...current, active: current.active + 1 }] as const
        }),
      ),
      () => SynchronizedRef.update(state, (current) => ({ ...current, active: Math.max(0, current.active - 1) })),
    ).pipe(
      Effect.andThen(Ref.make(false)),
      Effect.map((started) => ({
        run: (socket: Socket.Socket, opened = Effect.void) =>
          Effect.gen(function* () {
            const write = yield* socket.writer
            if (yield* Ref.getAndSet(started, true)) return
            const restart = close(write, 1012, "Server restarting")
            connections.add(restart)
            yield* serve(browser, socket, write, dial, opened).pipe(
              Effect.catch(() => Effect.void),
              Effect.ensuring(Effect.sync(() => connections.delete(restart))),
            )
          }),
      })),
    )
    return Service.of({ acquire, shutdown: shutdown() })
  })
}

export const layer = Layer.effect(Service, make())

const serve = Effect.fn("BrowserTunnel.serve")(function* (
  browser: BrowserHost.Interface,
  socket: Socket.Socket,
  writeSocket: (data: string | Uint8Array | Socket.CloseEvent) => Effect.Effect<void, Socket.SocketError>,
  dial: Dial,
  opened: Effect.Effect<void>,
) {
  const inbound = yield* Queue.bounded<string | Uint8Array, TunnelError>(16)
  const reader = yield* socket
    .runRaw(
      (message) => {
        if (typeof message !== "string" && message.byteLength > BrowserTunnelProtocol.MaxFrameBytes) {
          return fail(inbound, new TunnelError({ kind: "protocol", message: "Browser tunnel frame is too large." }))
        }
        return Queue.offer(inbound, message).pipe(Effect.asVoid)
      },
      { onOpen: opened },
    )
    .pipe(
      Effect.onExit(() => fail(inbound, new TunnelError({ kind: "closed", message: "Browser tunnel closed." }))),
      Effect.forkScoped,
    )

  const first = yield* Queue.take(inbound).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new TunnelError({ kind: "protocol", message: "Browser tunnel open timed out." })),
    }),
    Effect.flatMap(BrowserTunnelProtocol.decodeFromClient),
    Effect.mapError(() => new TunnelError({ kind: "protocol", message: "Browser tunnel open message is invalid." })),
    Effect.result,
  )
  if (Result.isFailure(first)) {
    yield* reject(writeSocket, "invalid_open", first.failure.message)
    return
  }
  const input = first.success
  const capability = yield* browser.get(input.sessionID)
  if (Option.isNone(capability) || capability.value.type !== "attached") {
    yield* reject(writeSocket, "not_attached", "No browser is attached to this Session.")
    return
  }
  if (!BrowserControlConnection.isAttached(input.sessionID, input.leaseID)) {
    yield* reject(writeSocket, "stale_lease", "The browser attachment lease is stale.")
    return
  }

  const target = yield* Effect.result(
    Effect.raceFirst(
      dial(input.target.host, input.target.port),
      Effect.raceFirst(
        Fiber.join(reader).pipe(Effect.andThen(new TunnelError({ kind: "closed", message: "Browser tunnel closed." }))),
        capability.value.revoked.pipe(
          Effect.andThen(new TunnelError({ kind: "revoked", message: "Browser lease was revoked." })),
        ),
      ),
    ),
  )
  if (Result.isFailure(target)) {
    if (target.failure instanceof ConnectError) {
      yield* reject(
        writeSocket,
        target.failure.kind === "timeout" ? "connect_timeout" : "connect_failed",
        target.failure.message,
      )
    }
    return
  }
  const tcp = target.success
  yield* Effect.addFinalizer(() => Effect.sync(() => tcp.destroy()))
  yield* writeSocket(BrowserTunnelProtocol.encodeFromServer({ type: "browser.tunnel.opened" }))

  const output = yield* Queue.bounded<Uint8Array, TunnelError>(1)
  const onData = (data: Buffer) => {
    tcp.pause()
    Queue.offerUnsafe(output, data)
  }
  const onClose = () =>
    Queue.failCauseUnsafe(output, Cause.fail(new TunnelError({ kind: "closed", message: "Target closed." })))
  const onError = (cause: Error) =>
    Queue.failCauseUnsafe(output, Cause.fail(new TunnelError({ kind: "target", message: "Target failed.", cause })))
  tcp.on("data", onData)
  tcp.once("close", onClose)
  tcp.once("error", onError)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      tcp.off("data", onData)
      tcp.off("close", onClose)
      tcp.off("error", onError)
    }).pipe(Effect.andThen(Queue.shutdown(output))),
  )

  const fromClient = Effect.forever(
    Queue.take(inbound).pipe(
      Effect.flatMap((message) =>
        typeof message === "string"
          ? new TunnelError({ kind: "protocol", message: "Tunnel payloads must be binary." })
          : writeTarget(tcp, message),
      ),
    ),
  )
  const fromTarget = Effect.forever(
    Queue.take(output).pipe(
      Effect.flatMap((data) =>
        Effect.forEach(
          Array.from({ length: Math.ceil(data.byteLength / BrowserTunnelProtocol.MaxFrameBytes) }, (_, index) =>
            data.subarray(
              index * BrowserTunnelProtocol.MaxFrameBytes,
              (index + 1) * BrowserTunnelProtocol.MaxFrameBytes,
            ),
          ),
          writeSocket,
          { discard: true },
        ),
      ),
      Effect.ensuring(Effect.sync(() => tcp.resume())),
    ),
  )
  yield* Effect.raceFirst(
    Effect.all([fromClient, fromTarget], { concurrency: "unbounded", discard: true }),
    Effect.raceFirst(Fiber.join(reader), capability.value.revoked),
  ).pipe(Effect.ensuring(close(writeSocket, 1000, "Browser tunnel closed")))
})

function connect(host: string, port: number) {
  return Effect.gen(function* () {
    const net = yield* Effect.promise(() => import("node:net"))
    return yield* Effect.acquireRelease(
      Effect.callback<import("node:net").Socket, ConnectError>((resume) => {
        const socket = new net.Socket()
        const onError = (cause: Error) =>
          resume(
            Effect.fail(
              new ConnectError({ kind: "failed", message: "Failed to connect browser tunnel target.", cause }),
            ),
          )
        socket.once("error", onError)
        socket.connect(port, host, () => {
          socket.off("error", onError)
          socket.setNoDelay(true)
          resume(Effect.succeed(socket))
        })
        return Effect.sync(() => socket.destroy())
      }).pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () =>
            Effect.fail(new ConnectError({ kind: "timeout", message: "Browser tunnel target connection timed out." })),
        }),
      ),
      (socket) => Effect.sync(() => socket.destroy()),
    )
  })
}

function writeTarget(socket: import("node:net").Socket, data: Uint8Array) {
  return Effect.callback<void, TunnelError>((resume) => {
    socket.write(data, (cause) =>
      resume(
        cause ? Effect.fail(new TunnelError({ kind: "target", message: "Target write failed.", cause })) : Effect.void,
      ),
    )
  })
}

function reject(
  write: (data: string | Uint8Array | Socket.CloseEvent) => Effect.Effect<void, Socket.SocketError>,
  code: BrowserTunnel.OpenErrorCode,
  message: string,
) {
  return write(BrowserTunnelProtocol.encodeFromServer({ type: "browser.tunnel.rejected", code, message })).pipe(
    Effect.catch(() => Effect.void),
    Effect.andThen(close(write, 1000, message)),
  )
}

function close(
  write: (data: string | Uint8Array | Socket.CloseEvent) => Effect.Effect<void, Socket.SocketError>,
  code: number,
  reason: string,
) {
  return write(new Socket.CloseEvent(code, reason.slice(0, 123))).pipe(
    Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.void }),
    Effect.catch(() => Effect.void),
  )
}

function fail(queue: Queue.Queue<string | Uint8Array, TunnelError>, error: TunnelError) {
  return Effect.sync(() => Queue.failCauseUnsafe(queue, Cause.fail(error)))
}
