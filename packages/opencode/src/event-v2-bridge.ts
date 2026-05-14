// Temporary V2 bridge: core events are the publish path, but the rest of
// opencode and the HTTP event stream still expect legacy bus/sync payloads.
// This layer goes away once consumers subscribe to core EventV2 directly.
import { Bus as ProjectBus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { SyncEvent } from "@/sync"
import { EventV2 } from "@opencode-ai/core/event"
import "@opencode-ai/core/catalog"
import "@opencode-ai/core/session-event"
import { Context, Effect, Layer } from "effect"

const syncDefinitions = new WeakMap<EventV2.Definition, SyncEvent.Definition>()

export function toSyncDefinition<D extends EventV2.Definition>(
  definition: D,
): SyncEvent.Definition<D["type"], D["data"], D["data"]> {
  const cached = syncDefinitions.get(definition)
  if (cached) return cached as SyncEvent.Definition<D["type"], D["data"], D["data"]>
  if (definition.version === undefined)
    throw new Error(`Event.toSyncDefinition: version required for ${definition.type}`)
  if (!definition.aggregate) throw new Error(`Event.toSyncDefinition: aggregate required for ${definition.type}`)
  const result = {
    type: definition.type,
    version: definition.version,
    aggregate: definition.aggregate,
    schema: definition.data,
    properties: definition.data,
  }
  syncDefinitions.set(definition, result)
  return result
}

export class Service extends Context.Service<Service, EventV2.Interface>()("@opencode/EventV2Bridge") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const bus = yield* ProjectBus.Service
    const sync = yield* SyncEvent.Service

    const unsubscribe = yield* events.sync((event) => {
      const definition = EventV2.registry.get(event.type)
      if (!definition) return Effect.void
      const aggregateID = definition.aggregate
        ? (event.data as Record<string, unknown>)[definition.aggregate]
        : undefined

      if (definition.version !== undefined && typeof aggregateID === "string") {
        return sync.run(toSyncDefinition(definition), event.data)
      }

      return bus.publish({ type: definition.type, properties: definition.data }, event.data, { id: event.id }).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            GlobalBus.emit("event", {
              directory: event.location?.directory,
              workspace: event.location?.workspaceID,
              payload: {
                id: event.id,
                type: event.type,
                properties: event.data,
              },
            })
          }),
        ),
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
