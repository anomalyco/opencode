import { Context, Effect, Layer, Option } from "effect"
import * as Socket from "effect/unstable/socket/Socket"

export const SERVER_CLOSING_EVENT = () => new Socket.CloseEvent(1001, "server closing")

type Close = Effect.Effect<void, unknown>

export interface Interface {
  readonly add: (close: Close) => Effect.Effect<void>
  readonly remove: (close: Close) => Effect.Effect<void>
  readonly closeAll: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/HttpApiWebSocketTracker") {}

export const layer = Layer.sync(Service)(() => {
  const sockets = new Set<Close>()
  let closing = false
  return Service.of({
    add: (close) =>
      Effect.gen(function* () {
        if (closing) return yield* close.pipe(Effect.catch(() => Effect.void))
        sockets.add(close)
      }),
    remove: (close) =>
      Effect.sync(() => {
        sockets.delete(close)
      }),
    closeAll: Effect.gen(function* () {
      closing = true
      const active = Array.from(sockets)
      sockets.clear()
      yield* Effect.all(
        active.map((close) => close.pipe(Effect.catch(() => Effect.void))),
        { concurrency: "unbounded", discard: true },
      )
    }),
  })
})

export const register = (close: Close) =>
  Effect.gen(function* () {
    const tracker = yield* Effect.serviceOption(Service)
    if (Option.isNone(tracker)) return Effect.void
    yield* tracker.value.add(close)
    return tracker.value.remove(close)
  })

export * as WebSocketTracker from "./websocket-tracker"
