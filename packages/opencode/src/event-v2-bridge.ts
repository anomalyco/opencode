// Temporary V2 bridge: core events are the publish path, but the rest of
// opencode and the HTTP event stream still expect legacy bus/sync payloads.
// This layer goes away once consumers subscribe to core EventV2 directly.
import { Bus as ProjectBus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { SyncEvent } from "@/sync"
import { EventV2 } from "@opencode-ai/core/event"
import "@opencode-ai/core/catalog"
import "@opencode-ai/core/session-event"
import { Context, Effect, Layer, Option } from "effect"

export function toSyncDefinition<D extends EventV2.Definition>(definition: D) {
  const result = {
    type: definition.type,
    version: definition.version,
    aggregate: definition.aggregate,
    schema: definition.data,
    properties: definition.data,
  }
  return result as SyncEvent.Definition<D["type"], D["data"], D["data"]>
}

export class Service extends Context.Service<Service, EventV2.Interface>()("@opencode/EventV2Bridge") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const bus = yield* ProjectBus.Service
    const sync = yield* SyncEvent.Service

    const publishGlobal = (event: EventV2.Payload) =>
      Effect.sync(() => {
        GlobalBus.emit("event", {
          workspace: event.location?.workspaceID,
          payload: {
            id: event.id,
            type: event.type,
            properties: event.data,
          },
        })
      })

    const provideEventLocation = <E, R>(event: EventV2.Payload, effect: Effect.Effect<void, E, R>) => {
      return Effect.gen(function* () {
        const ctx = yield* InstanceRef
        if (ctx) return yield* effect
        const store = Option.getOrUndefined(yield* Effect.serviceOption(InstanceStore.Service))
        if (!event.location?.directory || !store) return yield* publishGlobal(event)
        return yield* store.load({ directory: event.location.directory }).pipe(
          Effect.flatMap((ctx) => {
            const withInstance = effect.pipe(Effect.provideService(InstanceRef, ctx))
            if (!event.location?.workspaceID) return withInstance
            return withInstance.pipe(Effect.provideService(WorkspaceRef, event.location.workspaceID))
          }),
        )
      })
    }

    const unsubscribe = yield* events.sync((event) => {
      const definition = EventV2.registry.get(event.type)
      if (!definition) return Effect.void
      const aggregateID = definition.aggregate
        ? (event.data as Record<string, unknown>)[definition.aggregate]
        : undefined

      if (definition.version !== undefined && typeof aggregateID === "string") {
        return provideEventLocation(event, sync.run(toSyncDefinition(definition), event.data))
      }

      return provideEventLocation(
        event,
        bus.publish({ type: definition.type, properties: definition.data }, event.data, { id: event.id }),
      )
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    return Service.of(events)
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provide(SyncEvent.defaultLayer),
  Layer.provide(ProjectBus.defaultLayer),
)

export * as EventV2Bridge from "./event-v2-bridge"
