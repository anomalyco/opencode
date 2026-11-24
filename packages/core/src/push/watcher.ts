export * as PushWatcher from "./watcher.js"

import { Effect, Layer, Option, Schema, Stream } from "effect"
import { Form } from "@opencode/schema/form"
import { Permission } from "@opencode/schema/permission"
import { SessionEvent } from "@opencode/schema/session-event"
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

    const topLevel = Effect.fn("PushWatcher.topLevel")(function* (sessionID: Session.ID) {
      let session = yield* sessions.get(sessionID)
      while (session.parentID) session = yield* sessions.get(session.parentID)
      return session
    })

    const finished = Effect.fn("PushWatcher.finished")(function* (
      sessionID: Session.ID,
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

    const question = Effect.fn("PushWatcher.question")(function* (form: Form.Info) {
      if (form.metadata?.kind !== "question") return
      const sessionID = Schema.decodeUnknownOption(Session.ID)(form.sessionID)
      if (Option.isNone(sessionID)) return
      const current = yield* options.get()
      if (!current.enabled) return
      const session = yield* topLevel(sessionID.value)
      const field = form.fields[0]
      yield* sender.send({
        type: "question",
        sessionID: session.id,
        title: session.title ?? "OpenCode",
        body: field.description ?? field.title ?? form.title,
        data: { formID: form.id },
        attention: true,
      })
    })

    const permission = Effect.fn("PushWatcher.permission")(function* (request: Permission.Request) {
      const current = yield* options.get()
      if (!current.enabled) return
      const session = yield* topLevel(request.sessionID)
      yield* sender.send({
        type: "permission",
        sessionID: session.id,
        title: session.title ?? "OpenCode",
        body: `Needs permission: ${request.action}`,
        data: { requestID: request.id, action: request.action },
        attention: true,
      })
    })

    yield* bus.subscribe([Form.Event.Created, Permission.Event.Asked]).pipe(
      Stream.runForEach((event) => {
        if (event.type === "form.created") return question(event.data.form).pipe(Effect.ignore)
        return permission(event.data).pipe(Effect.ignore)
      }),
      Effect.forkScoped({ startImmediately: true }),
    )

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
