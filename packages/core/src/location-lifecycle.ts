export * as LocationLifecycle from "./location-lifecycle.js"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LocationEvent } from "@opencode/schema/location-event"
import { Bus } from "./bus.js"
import { Form } from "./form.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { Permission } from "./permission.js"
import { Project } from "./project.js"
import { Rpc } from "./rpc.js"
import { SessionEvent } from "./session/event.js"

const isSessionEvent = Schema.is(SessionEvent.Durable)

export class Service extends Context.Service<
  Service,
  { readonly isClosed: () => boolean; readonly shutdown: Effect.Effect<void> }
>()("@opencode/LocationLifecycle") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service
    const forms = yield* Form.Service
    const rpc = yield* Rpc.Service
    const project = yield* Project.Service
    const scope = yield* Effect.scope
    yield* project.activate(location.project.id)
    const unsubscribe = yield* bus.listen((event) => {
      if (!isSessionEvent(event) || !event.location) return Effect.void
      const ref = LocationServiceMap.canonical(event.location)
      if (ref.directory !== location.directory || ref.workspaceID !== location.workspaceID) return Effect.void
      // Listeners run inside publish; keep the write and its Project event off that path.
      return project.activate(location.project.id).pipe(Effect.forkIn(scope), Effect.asVoid)
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    let closed = false
    const shutdown = yield* Effect.cached(
      Effect.gen(function* () {
        closed = true
        yield* permission.close
        yield* forms.close
        yield* rpc.close
        yield* bus.publish(
          LocationEvent.Shutdown,
          {},
          {
            location: Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
          },
        )
      }).pipe(Effect.uninterruptible),
    )
    return Service.of({
      isClosed: () => closed,
      shutdown,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Location.node, Permission.node, Project.node, Form.node, Rpc.node],
})
