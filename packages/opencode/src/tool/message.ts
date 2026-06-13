import { Effect, Schema, Scope, Option } from "effect"
import * as Tool from "./tool"
import { Messaging } from "../messaging"
import { Session } from "@/session/session"
import { BackgroundJob } from "@/background/job"
import { SessionID } from "../session/schema"
import type { TaskPromptOps } from "./task"
import DESCRIPTION from "./message.txt"

export const Parameters = Schema.Struct({
  target: Schema.Literals(["parent", "subagent"]).annotate({
    description: "Who to message: 'parent' (the agent that spawned you) or 'subagent' (reply to one you spawned)",
  }),
  body: Schema.String.annotate({ description: "The message or question text" }),
  expect_reply: Schema.optional(Schema.Boolean).annotate({
    description: "When true (default) and target is 'parent', block until the parent replies or a timeout elapses",
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description: "Required when target is 'subagent': the task_id of the subagent awaiting your reply",
  }),
})

type Metadata = {
  target: string
  expect_reply: boolean
}

export const MessageTool = Tool.define<
  typeof Parameters,
  Metadata,
  Messaging.Service | Session.Service | BackgroundJob.Service | Scope.Scope
>(
  "message",
  Effect.gen(function* () {
    const messaging = yield* Messaging.Service
    const sessions = yield* Session.Service
    const background = yield* BackgroundJob.Service
    const scope = yield* Scope.Scope

    const run = Effect.fn("MessageTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<Metadata>,
    ) {
      const expectReply = params.expect_reply ?? true

      if (params.target === "subagent") {
        if (!params.task_id)
          return yield* Effect.fail(new Error('message(target:"subagent") requires task_id'))
        yield* messaging
          .reply({
            childSessionID: SessionID.make(params.task_id),
            body: params.body,
            callerSessionID: ctx.sessionID,
          })
          .pipe(
            Effect.catchTag("Messaging.NotFoundError", () =>
              Effect.fail(new Error(`No subagent is awaiting a reply for task_id ${params.task_id}`)),
            ),
          )
        return {
          title: "Replied to subagent",
          metadata: { target: params.target, expect_reply: false },
          output: "Reply delivered to the subagent.",
        }
      }

      // target === "parent"
      const self = yield* sessions.get(ctx.sessionID)
      const parentID = self.parentID
      if (!parentID)
        return yield* Effect.fail(
          new Error('message(target:"parent") failed: this session has no parent agent to receive the message'),
        )

      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined

      // Channel selection: wake the parked parent only for expect_reply while the
      // parent is still foreground-parked on this child (un-messaged, un-promoted);
      // everything else (fire-and-forget, or an already-backgrounded child) injects.
      const job = yield* background.get(ctx.sessionID)
      const parked = !!job && job.metadata?.messaged !== true && job.metadata?.background !== true

      const payload = {
        childSessionID: ctx.sessionID,
        parentSessionID: parentID,
        body: params.body,
        expectReply,
      }

      const inject = Effect.fn("MessageTool.inject")(function* () {
        if (!ops) return yield* Effect.fail(new Error("message tool requires promptOps in ctx.extra"))
        const parent = yield* sessions.get(parentID)
        yield* ops
          .prompt({
            sessionID: parentID,
            agent: parent.agent ?? ctx.agent,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: renderInbound(ctx.sessionID, params.body, expectReply),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })

      const deliver = (
        expectReply && parked ? background.message(ctx.sessionID, payload).pipe(Effect.asVoid) : inject()
      ).pipe(Effect.ignore)

      return yield* messaging
        .send({
          childSessionID: ctx.sessionID,
          parentSessionID: parentID,
          body: params.body,
          expectReply,
          deliver,
        })
        .pipe(
          Effect.map((reply) => ({
            title: expectReply ? "Sent message to parent (awaiting reply)" : "Sent message to parent",
            metadata: { target: params.target, expect_reply: expectReply },
            output: Option.match(reply, {
              onNone: () => "Message delivered to the parent agent.",
              onSome: (text) => `Parent replied: ${text}`,
            }),
          })),
          // Timeout and parent-gone are non-fatal: the subagent continues.
          Effect.catchTags({
            "Messaging.ReplyTimeoutError": () =>
              Effect.succeed({
                title: "Parent did not reply",
                metadata: { target: params.target, expect_reply: expectReply },
                output: "Parent did not reply within the timeout; proceeding without an answer.",
              }),
            "Messaging.RejectedError": () =>
              Effect.succeed({
                title: "Parent unavailable",
                metadata: { target: params.target, expect_reply: expectReply },
                output: "Parent agent is no longer available; proceeding without an answer.",
              }),
          }),
        )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

function renderInbound(childSessionID: SessionID, body: string, expectReply: boolean) {
  return [
    `<agent_message from="${childSessionID}" expects_reply="${expectReply}">`,
    body,
    expectReply
      ? `</agent_message>\nReply with: message(target:"subagent", task_id:"${childSessionID}", body:"...")`
      : `</agent_message>`,
  ].join("\n")
}
