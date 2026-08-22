export * as LocationActivity from "./location-activity.js"

import { Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "./bus.js"
import { LocationServiceMap } from "./location-service-map.js"
import { SessionEvent } from "./session/event.js"
import { SessionStore } from "./session/store.js"

const isSessionEvent = Schema.is(SessionEvent.Durable)

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const locations = yield* LocationServiceMap.Service
    const sessions = yield* SessionStore.Service
    const unsubscribe = yield* bus.listen((event) => {
      if (!isSessionEvent(event)) return Effect.void
      return Effect.gen(function* () {
        const location = event.location ?? (yield* sessions.get(event.data.sessionID))?.location
        if (!location) return
        yield* locations.activity(location, classify(event))
      })
    })
    yield* Effect.addFinalizer(() => unsubscribe)
  }),
)

export const node = makeGlobalNode({
  name: "location-activity",
  layer,
  deps: [Bus.node, LocationServiceMap.node, SessionStore.node],
})

function classify(event: SessionEvent.DurableEvent): LocationServiceMap.Activity {
  if (
    event.type === SessionEvent.Execution.Started.type ||
    event.type === SessionEvent.Step.Started.type ||
    event.type === SessionEvent.Compaction.Started.type
  )
    return { type: "start", id: `execution:${event.data.sessionID}` }
  if (
    event.type === SessionEvent.Execution.Succeeded.type ||
    event.type === SessionEvent.Execution.Failed.type ||
    event.type === SessionEvent.Execution.Interrupted.type
  )
    return { type: "stop", id: `execution:${event.data.sessionID}` }
  if (event.type === SessionEvent.Shell.Started.type)
    return { type: "start", id: `shell:${event.data.sessionID}` }
  if (event.type === SessionEvent.Shell.Ended.type) return { type: "stop", id: `shell:${event.data.sessionID}` }
  return { type: "touch" }
}
