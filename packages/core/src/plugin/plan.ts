export * as PlanPlugin from "./plan.js"

import { Message, ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import type { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { Global } from "@opencode/util/global"
import { Effect, Schema, Stream } from "effect"
import path from "path"
import { Bus } from "../bus.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Form } from "../form.js"
import { Permission } from "../permission.js"
import { QuestionTool } from "../tool/plugin/question.js"

const plan = Agent.ID.make("plan")
const build = Agent.ID.make("build")

const enter = (directory: string) => `<system-reminder>
You are in Plan mode. Discuss the plan with the user directly in the conversation. Do not create or update plan files unless the user explicitly asks you to; when they do, write them only in:
${directory}

Do not modify any other files or ask a subagent to do so.

When the plan is ready for implementation, call plan_exit to ask the user to approve switching to Build. If the user asks you to implement changes, request that approval instead of modifying files in Plan mode. Do not ask the same approval question through the question tool.
You remain in Plan mode until the user approves plan_exit or switches agents manually.
</system-reminder>`

const leave = `<system-reminder>
You are NO LONGER in Plan mode. The previous Plan restrictions no longer apply. Any Plan mode instructions from earlier in this conversation are no longer active.
</system-reminder>`

export const Plugin = define({
  id: "opencode.plan",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    const bus = yield* Bus.Service
    const forms = yield* Form.Service
    const permission = yield* Permission.Service
    const directory = path.join(global.home, ".opencode", "plan")
    const enterReminder = enter(directory)
    const reminderLocks = yield* KeyedMutex.make<Session.ID>()
    const persistReminder = Effect.fn("Plan.persistReminder")((sessionID: Session.ID, text: string) =>
      Effect.gen(function* () {
        // The switch subscriber and context hook can observe the same transition concurrently.
        const history = yield* ctx.session.context({ sessionID })
        const saved = history.reduce<string | undefined>((found, message) => {
          if (message.type !== "synthetic") return found
          return message.text === enterReminder || message.text === leave ? message.text : found
        }, undefined)
        if (saved === text) return

        // Reminders are history, not new work: inbox admission would schedule another model step.
        yield* bus.publish(SessionEvent.Synthetic, { sessionID, text })
      }).pipe(
        reminderLocks.withLock(sessionID),
        Effect.catchCause((cause) => Effect.logWarning("failed to persist Plan mode reminder", { sessionID, cause })),
      ),
    )
    yield* ctx.agent.transform((editor) => {
      editor.update(plan, (item) => {
        item.name = Agent.Name.make("Plan")
        item.description = "Read-only agent for exploring the codebase and planning work before implementation."
        item.mode = "primary"
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
        item.permissions.push({ action: "plan_exit", resource: "*", effect: "allow" })
        item.permissions.push({ action: "edit", resource: "*", effect: "deny" })
        item.permissions.push({ action: "edit", resource: path.join(directory, "*"), effect: "allow" })
      })
    })

    yield* ctx.tool.transform((editor) => {
      editor.add({
        name: "plan_exit",
        description:
          "When the plan is ready, ask the user to approve switching this session to Build and implementing it. Approval is required; declining keeps the session in Plan. No plan file is required.",
        options: { codemode: false },
        input: Schema.Struct({}),
        output: Schema.Struct({ approved: Schema.Boolean }),
        execute: (_, context) =>
          Effect.gen(function* () {
            const session = yield* ctx.session.get({ sessionID: context.sessionID }).pipe(Effect.orDie)
            if (context.agent !== plan || session.agent !== plan || session.parentID) {
              return yield* new ToolFailure({ message: "plan_exit is only available in a top-level Plan session." })
            }
            const target = (yield* ctx.agent.list().pipe(Effect.orDie)).data.find((agent) => agent.id === build)
            if (!target || target.mode === "subagent" || target.hidden) {
              return yield* new ToolFailure({ message: "The Build agent is not available for this session." })
            }
            yield* permission
              .assert({
                action: "plan_exit",
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              .pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied: plan_exit", error })))

            // Use the existing question dock, but only the explicit approval value authorizes implementation.
            const state = yield* forms
              .ask({
                sessionID: context.sessionID,
                title: "Plan approval",
                metadata: { kind: "question", tool: { messageID: context.messageID, id: context.id } },
                fields: [
                  {
                    key: "approval",
                    type: "string",
                    title: "Build",
                    description: "Approve the plan and switch to Build to implement it?",
                    required: true,
                    options: [
                      {
                        value: "approve",
                        label: "Approve and switch to Build",
                        description: "Implement the plan in this session.",
                      },
                      {
                        value: "decline",
                        label: "Keep planning",
                        description: "Stay in Plan without modifying project files.",
                      },
                    ],
                  },
                ],
              })
              .pipe(Effect.orDie)
            if (state.status === "cancelled" && state.message !== undefined) {
              return yield* new ToolFailure({ message: state.message })
            }
            if (state.status === "cancelled") {
              // Match question dismissal: stop execution instead of inviting another confirmation.
              return yield* Effect.die(new QuestionTool.CancelledError())
            }

            const approved = state.answer.approval === "approve"
            if (approved) {
              yield* ctx.session.switchAgent({ sessionID: context.sessionID, agent: build }).pipe(Effect.orDie)
            }
            return {
              output: { approved },
              content: approved
                ? "The user approved the plan. This session is now in Build. Implement the agreed plan without asking for approval again."
                : "The user chose to keep planning. Stay in Plan and do not modify project files.",
            }
          }),
      })
    })

    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.agent !== plan) return Effect.void
      if (event.status !== "error") return Effect.void
      if (event.tool !== "edit" && event.tool !== "write" && event.tool !== "patch") return Effect.void
      if (!(event.error.error instanceof Permission.BlockedError)) return Effect.void
      event.error = new ToolFailure({
        message: `Cannot use ${event.tool} to modify files outside the Plan directory: ${directory}`,
      })
      return Effect.void
    })

    // Compaction and committed reverts can strip reminders while the session's agent stays
    // put. Reconcile per request, appending near the tail so the cached prefix stays warm.
    yield* ctx.session.hook("context", (event) => {
      if (event.agent !== plan) {
        delete event.tools.plan_exit
      }
      const reminder = lastReminder(event.messages, enterReminder)
      const missing = event.agent === plan && reminder !== enterReminder
      const stale = event.agent !== plan && reminder === enterReminder
      const text = missing ? enterReminder : stale ? leave : undefined
      if (!text) return Effect.void
      // Before the user's prompt, matching where agent-switch reminders land.
      const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length
      event.messages.splice(at, 0, Message.user(text))
      return persistReminder(event.sessionID, text)
    })

    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event): event is SessionEvent.Created | SessionEvent.AgentSelected =>
          event.type === "session.created" || event.type === "session.agent.selected",
      ),
      Stream.runForEach((event) => {
        const text = switchReminder(event, enterReminder)
        if (!text) return Effect.void
        return persistReminder(event.data.sessionID, text)
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

function switchReminder(
  event: SessionEvent.Created | SessionEvent.AgentSelected,
  enterReminder: string,
): string | undefined {
  if (event.type === "session.created") {
    if (event.data.agent !== plan) return undefined
    return enterReminder
  }
  if (event.data.agent === event.data.previous) return undefined
  if (event.data.agent === plan) return enterReminder
  if (event.data.previous === plan) return leave
  return undefined
}

function lastReminder(messages: ReadonlyArray<Message>, enterReminder: string) {
  return messages.reduce<string | undefined>((found, message) => {
    const part = message.role === "user" && message.content.length === 1 ? message.content[0] : undefined
    if (part?.type !== "text") return found
    return part.text === enterReminder || part.text === leave ? part.text : found
  }, undefined)
}
