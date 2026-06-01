// Opencode publish boundary for core events. Attach routed instance location
// so direct EventV2 consumers can isolate directory/workspace streams.
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@opencode-ai/core/event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import "@opencode-ai/core/account"
import "@opencode-ai/core/catalog"
import "@opencode-ai/core/session/event"
import { Context, Effect, Layer } from "effect"

export class Service extends Context.Service<Service, EventV2.Interface>()("@opencode/EventV2Bridge") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service

    const publish: EventV2.Interface["publish"] = (definition, data, options) =>
      Effect.gen(function* () {
        if (options?.location) return yield* events.publish(definition, data, options)
        const ctx = yield* InstanceRef
        if (!ctx) return yield* events.publish(definition, data, options)
        const workspaceID = yield* WorkspaceRef
        return yield* events.publish(definition, data, {
          ...options,
          location: {
            directory: AbsolutePath.make(ctx.directory),
            ...(workspaceID ? { workspaceID } : {}),
          },
        })
      })

    const unsubscribe = yield* events.listen((event) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceRef
        const workspaceID = (yield* WorkspaceRef) ?? event.location?.workspaceID
        GlobalBus.emit("event", {
          directory: event.location?.directory ?? ctx?.directory,
          project: ctx?.project.id,
          workspace: workspaceID,
          payload: { id: event.id, type: event.type, properties: event.data },
        })
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    return Service.of({ ...events, publish })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer))

export * as EventV2Bridge from "./event-v2-bridge"
