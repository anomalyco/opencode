export * as LocationLifecycle from "./location-lifecycle.js"

import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LocationEvent } from "@opencode/schema/location-event"
import { Bus } from "./bus.js"
import { Form } from "./form.js"
import { Location } from "./location.js"
import { Permission } from "./permission.js"
import { Rpc } from "./rpc.js"

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
  deps: [Bus.node, Location.node, Permission.node, Form.node, Rpc.node],
})
