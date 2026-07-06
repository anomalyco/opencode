export * as EventLogger from "./event-logger"

import { Effect, Layer } from "effect"
import { makeGlobalNode } from "./effect/app-node"
import { EventV2 } from "./event"

const Types = new Set([
  "agent.updated",
  "catalog.updated",
  "command.updated",
  "config.updated",
])

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const unsubscribe = yield* events.listen((event) =>
      Types.has(event.type) ? Effect.logInfo("event", { event }) : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
  }),
)

export const node = makeGlobalNode({ name: "event-logger", layer, deps: [EventV2.node] })
