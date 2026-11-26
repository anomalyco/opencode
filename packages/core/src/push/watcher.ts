export * as PushWatcher from "./watcher.js"

import { Effect, Layer, Option, Schema, Stream } from "effect"
import { Form } from "@opencode/schema/form"
import { Permission } from "@opencode/schema/permission"
import { SessionError } from "@opencode/schema/session-error"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "@opencode/schema/session-message"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Session } from "../session.js"
import { PushList } from "./list.js"
import { PushSender } from "./sender.js"

// A client with the session already open reports the view the moment the turn ends, whether or not anyone is
// looking. Only a later view counts as the user having seen it.
const viewedAfter = 5_000

const bodies = {
  succeeded: "Finished",
  failed: "Failed",
}

// The tool call a question form was asked from, as the question tool records it.
const Tool = Schema.Struct({ messageID: Schema.String, id: Schema.String })

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

    const finished = Effect.fn("PushWatcher.finished")(function* (
      sessionID: Session.ID,
      outcome: keyof typeof bodies,
      ran: boolean,
      time: number,
      idleMessageID: SessionMessage.ID,
      error?: SessionError.Error,
    ) {
      if (!(yield* list.hasDevices())) return
      const session = yield* sessions.get(sessionID)
      if (session.parentID) return
      // The newest assistant message is the turn's last step, so only read it when this turn ran one.
      const [last] = ran
        ? yield* sessions
            .messages({ sessionID, type: "assistant", order: "desc", limit: 1 })
            .pipe(Effect.orElseSucceed(() => []))
        : []
      const text = Array.from(
        (last?.type === "assistant" ? last.content : [])
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n")
          .trim(),
      )
        .slice(-500)
        .join("")
      yield* sender.send({
        id: sessionID,
        type: "session.idle",
        sessionID,
        directory: session.location.directory,
        time,
        title: session.title || "OpenCode",
        body: bodies[outcome],
        data: {
          outcome,
          ...(last && { messageID: last.id }),
          idleMessageID,
          ...(text && { text }),
          ...(error && {
            error: {
              type: error.type,
              ...(error.message && { message: error.message }),
              status: error.status,
              retryAfterMs: error.retryAfterMs,
            },
          }),
        },
        attention: false,
      })
    })

    const question = Effect.fn("PushWatcher.question")(function* (form: Form.Info, time: number) {
      const kind = form.metadata?.kind
      if (kind !== "question") return
      const sessionID = Schema.decodeUnknownOption(Session.ID)(form.sessionID)
      if (Option.isNone(sessionID)) return
      if (!(yield* list.hasDevices())) return
      const session = yield* topLevel(sessionID.value)
      const field = form.fields[0]
      const choices = field.type === "string" || field.type === "multiselect" ? field : undefined
      const options = choices?.options ?? []
      // A string field without options takes typed text too.
      const custom = choices?.custom || (field.type === "string" && !field.options)
      // Rules on the answer that the message doesn't carry, so the phone can't check them.
      const rules =
        choices?.type === "string"
          ? [choices.required, choices.format, choices.minLength, choices.maxLength, choices.pattern]
          : [choices?.required, choices?.minItems, choices?.maxItems]
      const inlineReply =
        choices &&
        form.fields.length === 1 &&
        (custom || options.length > 0) &&
        rules.every((rule) => rule === undefined || rule === false)
      const tool = Schema.decodeUnknownOption(Tool)(form.metadata?.tool)
      yield* sender.send({
        id: form.id,
        type: "form",
        sessionID: session.id,
        directory: session.location.directory,
        time,
        title: session.title || "OpenCode",
        body: field.description || field.title || form.title || "Question",
        // The top-level session is the one to open and the one bells apply to; the form belongs to this one.
        data: {
          formID: form.id,
          replySessionID: sessionID.value,
          kind,
          count: form.fields.length,
          ...(inlineReply && { inlineReply: true }),
          ...(Option.isSome(tool) && { source: { type: "tool", ...tool.value } }),
          fields: [
            {
              key: field.key,
              type: field.type,
              ...(field.title && { title: field.title }),
              ...(field.description && { description: field.description }),
              ...(custom && { custom: true }),
              ...(options.length > 0 && {
                options: options.map((option) => ({
                  label: option.label,
                  ...(option.value !== option.label && { value: option.value }),
                  ...(option.description && { description: option.description }),
                })),
              }),
              ...(field.type === "external" && { url: field.url }),
            },
          ],
        },
        attention: true,
      })
    })

    const permission = Effect.fn("PushWatcher.permission")(function* (request: Permission.Request, time: number) {
      if (!(yield* list.hasDevices())) return
      const session = yield* topLevel(request.sessionID)
      asking.set(request.sessionID, (asking.get(request.sessionID) ?? new Set()).add(request.id))
      yield* sender.send({
        id: request.id,
        type: "permission",
        sessionID: session.id,
        directory: session.location.directory,
        time,
        title: session.title || "OpenCode",
        body: `Needs permission: ${request.action}`,
        // A reply has to name the session that asked, which may be a subagent's.
        data: {
          requestID: request.id,
          replySessionID: request.sessionID,
          action: request.action,
          resources: request.resources,
          ...(request.save?.length && { save: request.save }),
          decisions: request.save?.length ? ["once", "always", "reject"] : ["once", "reject"],
          ...(request.message && { message: request.message }),
          source: request.source,
        },
        attention: true,
      })
    })

    yield* bus.subscribe([Form.Event.Created, Permission.Event.Asked]).pipe(
      Stream.runForEach((event) => {
        const notify =
          event.type === "form.created"
            ? question(event.data.form, event.created)
            : permission(event.data, event.created)
        return notify.pipe(Effect.ignoreCause({ log: "Warn", message: "Failed to notify phones" }))
      }),
      Effect.forkScoped({ startImmediately: true }),
    )

    // An answer on any client makes the notification stale, and so does a new prompt or a view for a finished turn.
    // A deleted session has nothing left to open, and an archived one has been dealt with.
    yield* bus
      .subscribe([
        Permission.Event.Replied,
        Form.Event.Replied,
        Form.Event.Cancelled,
        SessionEvent.InboxEnqueued,
        SessionEvent.Viewed,
        SessionEvent.Deleted,
        SessionEvent.Archived,
      ])
      .pipe(
        Stream.runForEach((event) => {
          if (event.type === "session.archived") return sender.clearSession(event.data.sessionID, event.created)
          if (event.type === "session.deleted") {
            stepped.delete(event.data.sessionID)
            asking.delete(event.data.sessionID)
            return sender.clearSession(event.data.sessionID, event.created)
          }
          if (event.type === "permission.replied") {
            asking.get(event.data.sessionID)?.delete(event.data.requestID)
            return sender.clear([event.data.requestID], event.created)
          }
          if (event.type === "session.viewed") {
            if (event.created - event.data.idle < viewedAfter) return Effect.void
            return sender.clear([event.data.sessionID], event.created)
          }
          if (event.type !== "session.inbox.enqueued") return sender.clear([event.data.id], event.created)
          if (event.data.item.type !== "user") return Effect.void
          return sender.clear([event.data.sessionID], event.created)
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
          if (event.type === "session.execution.interrupted") return sender.clear(unanswered, event.created)
          if (event.type === "session.execution.succeeded" && !ran) return sender.clear(unanswered, event.created)
          const outcome = event.type === "session.execution.succeeded" ? "succeeded" : "failed"
          const error = event.type === "session.execution.failed" ? event.data.error : undefined
          return sender
            .clear(unanswered, event.created)
            .pipe(
              Effect.andThen(
                finished(sessionID, outcome, ran, event.created, SessionMessage.ID.fromEvent(event.id), error),
              ),
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
