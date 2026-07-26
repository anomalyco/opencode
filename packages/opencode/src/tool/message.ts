import { Effect, Option, Schema, Scope } from "effect"
import * as Tool from "./tool"
import { Messaging } from "../messaging"
import { Session } from "@/session/session"
import { BackgroundJob } from "@/background/job"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, PartID, SessionID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import type { TaskPromptOps } from "./task"
import DESCRIPTION from "./message.txt"

const MAX_BODY_LENGTH = 16000

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

export type MessageMarkerPeer = "parent" | "subagent"

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

      if (params.body.length > MAX_BODY_LENGTH)
        return yield* Effect.fail(
          new Error(`message body exceeds maximum length of ${MAX_BODY_LENGTH} characters (got ${params.body.length})`),
        )

      if (params.target === "subagent") {
        if (!params.task_id)
          return yield* Effect.fail(new Error('message(target:"subagent") requires task_id'))
        const childID = SessionID.make(params.task_id)
        yield* messaging
          .reply({
            childSessionID: childID,
            body: params.body,
            callerSessionID: ctx.sessionID,
          })
          .pipe(
            Effect.catchTag("Messaging.NotFoundError", () =>
              Effect.fail(new Error(`No subagent is awaiting a reply for task_id ${params.task_id}`)),
            ),
          )
        // Visible "✉ Reply from parent" marker in the SUBAGENT transcript.
        // No parent-side echo: the message tool call already shows what was sent.
        // Best-effort: a marker write failure must not undo the delivered reply.
        yield* writeMarker(sessions, {
          sessionID: childID,
          peer: "parent",
          body: params.body,
        }).pipe(Effect.ignore)
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

      // Fail fast if the injection channel (Channel B) will be needed but ops is absent.
      // Channel A (background.message) does not need ops; Channel B (inject) does.
      // We check here so delivery setup failures surface via the outer orDie, not silently.
      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined

      // Channel selection: wake the parked parent only for expect_reply while the
      // parent is still foreground-parked on this child (un-messaged, un-promoted);
      // everything else (fire-and-forget, or an already-backgrounded child) injects.
      const job = yield* background.get(ctx.sessionID)
      const parked = !!job && job.metadata?.messaged !== true && job.metadata?.background !== true
      const useChannelB = !(expectReply && parked)

      if (useChannelB && !ops)
        return yield* Effect.fail(new Error("message tool requires promptOps in ctx.extra"))

      const payload = {
        childSessionID: ctx.sessionID,
        parentSessionID: parentID,
        body: params.body,
        expectReply,
      }

      // inject() returns Effect<void>. The only async failure is the forked ops.prompt call,
      // which is intentionally ignored (fire-and-forget injection). The ops-presence check is
      // hoisted above so inject() itself cannot fail for that reason.
      //
      // We push TWO parts to the parent's new user message:
      //   1. synthetic <agent_message> frame — the model reads this and is told how to reply.
      //   2. non-synthetic ✉ Message marker — the human reading the TUI sees a distinct line.
      // The TUI's UserMessage filters synthetic parts out of the prose memo and routes the
      // metadata.message-tagged part into a separate muted marker row (mirrors interrupt UX).
      const inject = Effect.fn("MessageTool.inject")(function* () {
        const parent = yield* sessions.get(parentID)
        const parentMessages = yield* sessions.messages({ sessionID: parentID }).pipe(Effect.option)
        if (Option.isNone(parentMessages)) return
        const { user: lastUser } = MessageV2.latest(parentMessages.value)
        if (!lastUser) return
        yield* ops!
          .prompt({
            sessionID: parentID,
            agent: parent.agent ?? ctx.agent,
            model: {
              providerID: lastUser.model.providerID,
              modelID: lastUser.model.modelID,
            },
            variant: lastUser.model.variant,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: renderInbound(ctx.sessionID, params.body, expectReply),
              },
              {
                type: "text",
                text: renderMarker({ peer: "subagent", body: params.body, expectReply }),
                metadata: { message: { peer: "subagent", expectReply } },
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })

      // deliver: Effect<void, never> — delivery setup failures die (surface via outer orDie).
      // Channel A: background.message (synchronous wake, no ops needed).
      // Channel B: inject() (async injection, ops already validated above).
      const deliver: Effect.Effect<void> = expectReply && parked
        ? background.message(ctx.sessionID, payload).pipe(Effect.asVoid)
        : inject().pipe(Effect.orDie)

      const result = yield* messaging
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

      return {
        title: result.title,
        metadata: result.metadata,
        output: result.output,
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

// Escape untrusted subagent body to prevent XML tag breakout in rendered framing.
// Parent must treat subagent message bodies as untrusted input.
export function escapeBody(body: string) {
  return body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function renderInbound(childSessionID: SessionID, body: string, expectReply: boolean) {
  return [
    `<agent_message from="${childSessionID}" expects_reply="${expectReply}">`,
    escapeBody(body),
    expectReply
      ? `</agent_message>\nReply with: message(target:"subagent", task_id:"${childSessionID}", body:"...")`
      : `</agent_message>`,
  ].join("\n")
}

// Build the user-visible transcript marker for a message-tool event.
// Bodies travel into the model too (the marker is non-synthetic and non-ignored
// so the TUI can render it without changing the visibility predicate), so the
// untrusted body is XML-escaped with the same scheme as the synthetic frame.
export function renderMarker(input: { peer: MessageMarkerPeer; body: string; expectReply?: boolean }) {
  const verb = renderVerb(input)
  return `✉ ${verb}: ${escapeBody(input.body)}`
}

function renderVerb(input: { peer: MessageMarkerPeer; expectReply?: boolean }) {
  if (input.peer === "subagent")
    return input.expectReply ? "Message from subagent (awaiting your reply)" : "Message from subagent"
  return "Reply from parent"
}

// Write a visible ✉ marker into a session's transcript as a new user-role message
// carrying a single non-synthetic text part tagged with metadata.message. Mirrors
// the abortChild pattern in interrupt.ts: derive agent/model from the most recent
// user message of the target session (real subagent sessions have no session.model
// — the model lives on user messages), and skip cleanly when the session has no
// prior user message (a session must have at least one user message to render
// anything; this guards purely defensively).
export const writeMarker = (
  sessions: Session.Interface,
  input: {
    sessionID: SessionID
    peer: MessageMarkerPeer
    body: string
    expectReply?: boolean
  },
) =>
  Effect.gen(function* () {
    const messages = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.option)
    if (Option.isNone(messages)) return
    const { user: lastUser } = MessageV2.latest(messages.value)
    if (!lastUser) return
    const msg: SessionV1.User = {
      id: MessageID.ascending(),
      sessionID: input.sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: lastUser.agent,
      model: lastUser.model,
    }
    yield* sessions.updateMessage(msg)
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: msg.id,
      sessionID: input.sessionID,
      type: "text",
      text: renderMarker(input),
      synthetic: false,
      metadata: {
        message: {
          peer: input.peer,
          ...(input.expectReply !== undefined ? { expectReply: input.expectReply } : {}),
        },
      },
    } satisfies SessionV1.TextPart)
  })
