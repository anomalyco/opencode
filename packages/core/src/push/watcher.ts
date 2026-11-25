export * as PushWatcher from "./watcher.js"

import { Effect, Layer, Option, Schema, Stream } from "effect"
import { Form } from "@opencode/schema/form"
import { Permission } from "@opencode/schema/permission"
import { SessionEvent } from "@opencode/schema/session-event"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Session } from "../session.js"
import { PushList } from "./list.js"
import { PushOptions } from "./options.js"
import { PushSender } from "./sender.js"

const bodies = {
  succeeded: "Finished",
  failed: "Failed",
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service
    const list = yield* PushList.Service
    const sender = yield* PushSender.Service
    const options = yield* PushOptions.Service
    const stepped = new Set<Session.ID>()

    // Reading the flag starts the configuration's Location, so a server with no phones never does.
    const wanted = Effect.gen(function* () {
      if (!(yield* list.hasDevices())) return false
      return yield* options.enabled()
    })

    const topLevel = Effect.fn("PushWatcher.topLevel")(function* (sessionID: Session.ID) {
      let session = yield* sessions.get(sessionID)
      while (session.parentID) session = yield* sessions.get(session.parentID)
      return session
    })

    const finished = Effect.fn("PushWatcher.finished")(function* (sessionID: Session.ID, outcome: keyof typeof bodies) {
      if (!(yield* wanted)) return
      const session = yield* sessions.get(sessionID)
      if (session.parentID) return
      yield* sender.send({
        type: "session.idle",
        sessionID,
        title: session.title || "OpenCode",
        body: bodies[outcome],
        data: { outcome },
        attention: false,
      })
    })

    const question = Effect.fn("PushWatcher.question")(function* (form: Form.Info) {
      if (form.metadata?.kind !== "question") return
      const sessionID = Schema.decodeUnknownOption(Session.ID)(form.sessionID)
      if (Option.isNone(sessionID)) return
      if (!(yield* wanted)) return
      const session = yield* topLevel(sessionID.value)
      const field = form.fields[0]
      yield* sender.send({
        type: "question",
        sessionID: session.id,
        title: session.title || "OpenCode",
        body: field.description || field.title || form.title,
        // The top-level session is the one to open and the one bells apply to; the form belongs to this one.
        data: { formID: form.id, sessionID: sessionID.value },
        attention: true,
      })
    })

    const permission = Effect.fn("PushWatcher.permission")(function* (request: Permission.Request) {
      if (!(yield* wanted)) return
      const session = yield* topLevel(request.sessionID)
      yield* sender.send({
        type: "permission",
        sessionID: session.id,
        title: session.title || "OpenCode",
        body: `Needs permission: ${request.action}`,
        // A reply has to name the session that asked, which may be a subagent's.
        data: { requestID: request.id, sessionID: request.sessionID, action: request.action },
        attention: true,
      })
    })

    yield* bus.subscribe([Form.Event.Created, Permission.Event.Asked]).pipe(
      Stream.runForEach((event) => {
        const notify = event.type === "form.created" ? question(event.data.form) : permission(event.data)
        return notify.pipe(Effect.ignoreCause({ log: "Warn", message: "Failed to notify phones" }))
      }),
      Effect.forkScoped({ startImmediately: true }),
    )

    // A busy period without a model step (a move, a revert, a manual compaction) is not a finished turn.
    yield* bus
      .subscribe([
        SessionEvent.Step.Started,
        SessionEvent.Execution.Succeeded,
        SessionEvent.Execution.Failed,
        SessionEvent.Execution.Interrupted,
      ])
      .pipe(
        Stream.runForEach((event) => {
          const sessionID = event.data.sessionID
          if (event.type === "session.step.started") {
            stepped.add(sessionID)
            return Effect.void
          }
          const ran = stepped.delete(sessionID)
          if (event.type === "session.execution.interrupted") return Effect.void
          if (event.type === "session.execution.succeeded" && !ran) return Effect.void
          const outcome = event.type === "session.execution.succeeded" ? "succeeded" : "failed"
          return finished(sessionID, outcome).pipe(
            Effect.ignoreCause({ log: "Warn", message: "Failed to notify phones" }),
          )
        }),
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
)

export const node = makeGlobalNode({
  name: "push-watcher",
  layer,
  deps: [Bus.node, PushList.node, PushOptions.node, PushSender.node, Session.node],
})
