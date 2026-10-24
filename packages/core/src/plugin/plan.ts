export * as PlanPlugin from "./plan.js"

import { Message, ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Global } from "@opencode/util/global"
import { Effect, Stream } from "effect"
import path from "path"
import { Permission } from "../permission.js"

const plan = Agent.ID.make("plan")

const enter = (directory: string) => `<system-reminder>
You are in Plan mode. Discuss the plan with the user directly in the conversation. Do not create or update plan files unless the user explicitly asks you to; when they do, write them only in:
${directory}

Do not modify any other files or ask a subagent to do so.

You remain in Plan mode until the user switches agents. If the user asks you to implement changes, do not do so. Tell them they need to switch agents.
</system-reminder>`

const leave = `<system-reminder>
You are NO LONGER in Plan mode. The previous Plan restrictions no longer apply. Any Plan mode instructions from earlier in this conversation are no longer active.
</system-reminder>`

export const Plugin = define({
  id: "opencode.plan",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    const directory = path.join(global.home, ".opencode", "plan")
    const enterReminder = enter(directory)
    yield* ctx.agent.transform((editor) => {
      editor.update(plan, (item) => {
        item.name = Agent.Name.make("Plan")
        item.description = "Read-only agent for exploring the codebase and planning work before implementation."
        item.mode = "primary"
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
        item.permissions.push({ action: "edit", resource: "*", effect: "deny" })
        item.permissions.push({ action: "edit", resource: path.join(directory, "*"), effect: "allow" })
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
      const reminder = lastReminder(event.messages, enterReminder)
      const missing = event.agent === plan && reminder !== enterReminder
      const stale = event.agent !== plan && reminder === enterReminder
      const text = missing ? enterReminder : stale ? leave : undefined
      // A reminder alone as the final user turn makes some models refuse the request, which is what an
      // agent switch mid-turn produces: the transcript ends on a tool result. Re-place a reminder an
      // earlier request left there, then keep any reminder ahead of that trailing assistant/tool run so
      // the request still ends where the model expects to continue.
      const moved = tailReminder(event.messages, enterReminder)
      if (!text && moved === undefined) return Effect.void
      if (moved !== undefined) {
        event.messages.splice(event.messages.length - 1, 1)
        event.messages.splice(reminderPoint(event.messages), 0, Message.user(moved))
      }
      if (!text) return Effect.void
      event.messages.splice(reminderPoint(event.messages), 0, Message.user(text))
      return ctx.session
        .synthetic({ sessionID: event.sessionID, text, resume: false })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to persist Plan mode reminder", { sessionID: event.sessionID, cause }),
          ),
        )
    })

    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event): event is SessionEvent.Created | SessionEvent.AgentSelected =>
          event.type === "session.created" || event.type === "session.agent.selected",
      ),
      Stream.runForEach((event) => {
        const text = switchReminder(event, enterReminder)
        if (!text) return Effect.void
        return ctx.session
          .synthetic({
            sessionID: event.data.sessionID,
            text,
            resume: false,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to inject Plan mode reminder", { sessionID: event.data.sessionID, cause }),
            ),
          )
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

/** The reminder text when a message is a user turn holding nothing but that reminder. */
function reminderText(message: Message, enterReminder: string) {
  if (message.role !== "user" || message.content.length !== 1) return undefined
  const part = message.content[0]
  if (part?.type !== "text") return undefined
  return part.text === enterReminder || part.text === leave ? part.text : undefined
}

function lastReminder(messages: ReadonlyArray<Message>, enterReminder: string) {
  return messages.reduce<string | undefined>(
    (found, message) => reminderText(message, enterReminder) ?? found,
    undefined,
  )
}

/** The reminder a previous request left as the final turn, which only an agent switch mid-turn produces. */
function tailReminder(messages: ReadonlyArray<Message>, enterReminder: string) {
  if (messages.length < 2) return undefined
  return reminderText(messages.at(-1)!, enterReminder)
}

/**
 * Where a reminder belongs: before the user's prompt when one ends the request, otherwise ahead of the
 * trailing assistant/tool run, so the request keeps ending on the turn the model continues from.
 */
function reminderPoint(messages: ReadonlyArray<Message>) {
  if (messages.at(-1)?.role === "user") return messages.length - 1
  return messages.findLastIndex((message) => message.role === "user") + 1
}
