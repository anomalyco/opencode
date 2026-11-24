export * as PushWatcher from "./watcher.js"

import { Effect, Layer, Stream } from "effect"
import { SessionEvent } from "@opencode/schema/session-event"
import type { Session as SessionSchema } from "@opencode/schema/session"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Session } from "../session.js"
import { PushOptions } from "./options.js"
import { PushSender } from "./sender.js"

const bodies = {
  succeeded: "Finished",
  failed: "Failed",
  interrupted: "Stopped",
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service
    const sender = yield* PushSender.Service
    const options = yield* PushOptions.Service

    const finished = Effect.fn("PushWatcher.finished")(function* (
      sessionID: SessionSchema.ID,
      outcome: keyof typeof bodies,
    ) {
      const current = yield* options.get()
      if (!current.enabled) return
      const session = yield* sessions.get(sessionID)
      if (session.parentID) return
      yield* sender.send({
        type: "session.idle",
        sessionID,
        title: session.title ?? "OpenCode",
        body: bodies[outcome],
        data: { outcome },
        attention: false,
      })
    })

    yield* bus
      .subscribe([SessionEvent.Execution.Succeeded, SessionEvent.Execution.Failed, SessionEvent.Execution.Interrupted])
      .pipe(
        Stream.runForEach((event) => {
          if (event.type === "session.execution.succeeded")
            return finished(event.data.sessionID, "succeeded").pipe(Effect.ignore)
          if (event.type === "session.execution.failed")
            return finished(event.data.sessionID, "failed").pipe(Effect.ignore)
          if (event.data.reason !== "inactivity") return Effect.void
          return finished(event.data.sessionID, "interrupted").pipe(Effect.ignore)
        }),
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
)

export const node = makeGlobalNode({
  name: "push-watcher",
  layer,
  deps: [Bus.node, PushOptions.node, PushSender.node, Session.node],
})
