import z from "zod"
import { Effect, Fiber, Layer, PubSub, ServiceMap, Stream } from "effect"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"

export namespace Bus {
  const log = Log.create({ service: "bus" })

  export const InstanceDisposed = BusEvent.define(
    "server.instance.disposed",
    z.object({
      directory: z.string(),
    }),
  )

  type Payload<D extends BusEvent.Definition = BusEvent.Definition> = {
    type: D["type"]
    properties: z.infer<D["properties"]>
  }

  type State = {
    wildcard: PubSub.PubSub<Payload>
    typed: Map<string, PubSub.PubSub<Payload>>
  }

  export interface Interface {
    readonly publish: <D extends BusEvent.Definition>(
      def: D,
      properties: z.output<D["properties"]>,
    ) => Effect.Effect<void>
    readonly subscribe: <D extends BusEvent.Definition>(def: D) => Stream.Stream<Payload<D>>
    readonly subscribeAll: () => Stream.Stream<Payload>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Bus") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cache = yield* InstanceState.make<State>(
        Effect.fn("Bus.state")(function* (ctx) {
          const wildcard = yield* PubSub.unbounded<Payload>()
          const typed = new Map<string, PubSub.PubSub<Payload>>()

          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              // Publish InstanceDisposed before shutting down so subscribers see it
              yield* PubSub.publish(wildcard, {
                type: InstanceDisposed.type,
                properties: { directory: ctx.directory },
              })
              // Shut down all PubSubs — ends all Stream.fromPubSub consumers
              yield* PubSub.shutdown(wildcard)
              for (const ps of typed.values()) {
                yield* PubSub.shutdown(ps)
              }
            }),
          )

          return { wildcard, typed }
        }),
      )

      const getOrCreate = Effect.fn("Bus.getOrCreate")(function* (state: State, type: string) {
        let ps = state.typed.get(type)
        if (!ps) {
          ps = yield* PubSub.unbounded<Payload>()
          state.typed.set(type, ps)
        }
        return ps
      })

      function publish<D extends BusEvent.Definition>(def: D, properties: z.output<D["properties"]>) {
        return Effect.gen(function* () {
          const state = yield* InstanceState.get(cache)
          const payload: Payload = { type: def.type, properties }
          log.info("publishing", { type: def.type })

          const ps = state.typed.get(def.type)
          if (ps) yield* PubSub.publish(ps, payload)
          yield* PubSub.publish(state.wildcard, payload)

          GlobalBus.emit("event", {
            directory: Instance.directory,
            payload,
          })
        })
      }

      function subscribe<D extends BusEvent.Definition>(def: D): Stream.Stream<Payload<D>> {
        log.info("subscribing", { type: def.type })
        return Stream.unwrap(
          Effect.gen(function* () {
            const state = yield* InstanceState.get(cache)
            const ps = yield* getOrCreate(state, def.type)
            return Stream.fromPubSub(ps) as Stream.Stream<Payload<D>>
          }),
        ).pipe(Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: def.type }))))
      }

      function subscribeAll(): Stream.Stream<Payload> {
        log.info("subscribing", { type: "*" })
        return Stream.unwrap(
          Effect.gen(function* () {
            const state = yield* InstanceState.get(cache)
            return Stream.fromPubSub(state.wildcard)
          }),
        ).pipe(Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: "*" }))))
      }

      return Service.of({ publish, subscribe, subscribeAll })
    }),
  )

  const { runPromise, runFork } = makeRuntime(Service, layer)

  export async function publish<D extends BusEvent.Definition>(
    def: D,
    properties: z.output<D["properties"]>,
  ) {
    return runPromise((svc) => svc.publish(def, properties))
  }

  export function subscribe<D extends BusEvent.Definition>(
    def: D,
    callback: (event: { type: D["type"]; properties: z.infer<D["properties"]> }) => void,
  ) {
    const fiber = runFork((svc) =>
      svc.subscribe(def).pipe(Stream.runForEach((msg) => Effect.sync(() => callback(msg)))),
    )
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }

  export function subscribeAll(callback: (event: any) => void) {
    const fiber = runFork((svc) =>
      svc.subscribeAll().pipe(Stream.runForEach((msg) => Effect.sync(() => callback(msg)))),
    )
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }
}
