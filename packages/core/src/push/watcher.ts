export * as PushWatcher from "./watcher.js"

import { Effect, Layer, Option, Schema, Stream } from "effect"
import { Form } from "@opencode/schema/form"
import { Permission } from "@opencode/schema/permission"
import { SessionEvent } from "@opencode/schema/session-event"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Session } from "../session.js"
import { PushList } from "./list.js"
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
    const stepped = new Set<Session.ID>()
    // Permission requests each session is waiting on. An interrupted request gets no reply, so the end of the
    // session's execution clears its notification instead.
    const asking = new Map<Session.ID, Set<string>>()


    const topLevel = Effect.fn("PushWatcher.topLevel")(function* (sessionID: Session.ID) {
      let session = yield* sessions.get(sessionID)
      while (session.parentID) session = yield* sessions.get(session.parentID)
      return session
    })

    const finished = Effect.fn("PushWatcher.finished")(function* (sessionID: Session.ID, outcome: keyof typeof bodies) {
      if (!(yield* list.hasDevices())) return
      const session = yield* sessions.get(sessionID)
      if (session.parentID) return
      yield* sender.send({
        id: sessionID,
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
      if (!(yield* list.hasDevices())) return
      const session = yield* topLevel(sessionID.value)
      const field = form.fields[0]
      yield* sender.send({
        id: form.id,
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
      if (!(yield* list.hasDevices())) return
      const session = yield* topLevel(request.sessionID)
      asking.set(request.sessionID, (asking.get(request.sessionID) ?? new Set()).add(request.id))
      yield* sender.send({
        id: request.id,
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

    // An answer on any client makes the notification stale, and so does a new prompt for a finished turn.
    yield* bus
      .subscribe([Permission.Event.Replied, Form.Event.Replied, Form.Event.Cancelled, SessionEvent.InboxEnqueued])
      .pipe(
        Stream.runForEach((event) => {
          if (event.type === "permission.replied") {
            asking.get(event.data.sessionID)?.delete(event.data.requestID)
            return sender.clear([event.data.requestID])
          }
          if (event.type !== "session.inbox.enqueued") return sender.clear([event.data.id])
          if (event.data.item.type !== "user") return Effect.void
          return sender.clear([event.data.sessionID])
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
          const unanswered = Array.from(asking.get(sessionID) ?? [])
          asking.delete(sessionID)
          if (event.type === "session.execution.interrupted") return sender.clear(unanswered)
          if (event.type === "session.execution.succeeded" && !ran) return sender.clear(unanswered)
          const outcome = event.type === "session.execution.succeeded" ? "succeeded" : "failed"
          return sender
            .clear(unanswered)
            .pipe(
              Effect.andThen(finished(sessionID, outcome)),
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
  deps: [Bus.node, PushList.node, PushSender.node, Session.node],
})
