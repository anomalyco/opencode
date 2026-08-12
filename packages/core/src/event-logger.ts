export * as EventLogger from "./event-logger.js"

import { Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "./bus.js"

const Types = new Set(["agent.updated", "catalog.updated", "command.updated", "config.updated"])

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const unsubscribe = yield* bus.listen((event) =>
      Types.has(event.type) ? Effect.logInfo("event", { event }) : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
  }),
)

export const node = makeGlobalNode({ name: "event-logger", layer, deps: [Bus.node] })
