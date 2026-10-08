export * as CompanionTools from "./companion.js"

import { Message, ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Agent } from "@opencode/schema/agent"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Effect, Predicate, Schema } from "effect"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { ShellTool } from "./shell.js"

export const agent = Agent.ID.make("companion")

const names = ["main_status", "main_read", "main_send", "main_cancel", "main_interrupt"]

// User config rules apply after the companion's own, but never beyond these actions.
const actions = new Set(["read", "grep", "glob", "webfetch", "websearch", "shell", "external_directory", ...names])

// One read-only git command with no shell operators. The shell parser also drops redirects that
// follow `&&` or `||` from permission resources, so the companion's rules alone cannot enforce this.
const readOnlyGit = /^git (?:(?:status|diff|log|show)(?: [^;&|<>$`\n]*)?|branch(?: --show-current| -a| -r| -vv?)?)$/

const ReadInput = Schema.Struct({
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))).annotate({
    description: "Number of most recent messages to return. Defaults to 12.",
  }),
})

const SendInput = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "A clear, self-contained instruction for the main session's agent.",
  }),
  delivery: Schema.optionalKey(SessionInbox.Delivery).annotate({
    description:
      "steer (default) delivers at the main session's next safe boundary, or starts it when idle. queue waits until the main session finishes its current work.",
  }),
})

const CancelInput = Schema.Struct({
  inboxID: SessionMessage.ID.annotate({ description: "ID of a pending inbox item from main_status." }),
})

const InterruptInput = Schema.Struct({
  resume: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Resume pending steering prompts after the interrupt. Defaults to false.",
  }),
})

/** Tools that let a companion observe and steer its main Session. Only companion Sessions may call them. */
export const Plugin = {
  id: "opencode.tool.companion",
  effect: Effect.fn("CompanionTools.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const permission = yield* Permission.Service

    const mainOf = Effect.fn("CompanionTools.mainOf")(function* (sessionID: SessionSchema.ID) {
      const self = yield* sessions
        .get(sessionID)
        .pipe(Effect.mapError((error) => new ToolFailure({ message: `Session not found: ${sessionID}`, error })))
      if (self.kind !== "companion" || !self.parentID)
        return yield* new ToolFailure({ message: "Only a companion session can use this tool" })
      return yield* sessions
        .get(self.parentID)
        .pipe(
          Effect.mapError((error) => new ToolFailure({ message: `Main session not found: ${self.parentID}`, error })),
        )
    })

    const status = Effect.fn("CompanionTools.status")(function* (main: SessionSchema.Info) {
      const [active, inbox, permissions] = yield* Effect.all(
        [sessions.active, sessions.inbox(main.id).pipe(Effect.orElseSucceed(() => [])), permission.forSession(main.id)],
        { concurrency: "unbounded" },
      )
      const pending = inbox.flatMap((item) =>
        item.type === "user" || item.type === "synthetic"
          ? [`- ${item.id} [${item.delivery}] ${clip(item.payload.text, 200)}`]
          : [],
      )
      const asked = permissions.map(
        (request) => `- ${request.action}: ${clip(request.message ?? request.resources.join(", "), 200)}`,
      )
      return [
        `Main session: ${main.title ?? "Untitled"} (${main.id})`,
        `Status: ${active.has(main.id) ? "running" : "idle"}${main.outcome ? ` (last run ${main.outcome})` : ""}`,
        `Agent: ${main.agent ?? "default"}${main.model ? ` · Model: ${main.model.providerID}/${main.model.id}` : ""}`,
        pending.length > 0 ? ["Pending inbox:", ...pending].join("\n") : "Pending inbox: none",
        asked.length > 0 ? ["Waiting for user permission:", ...asked].join("\n") : undefined,
      ]
        .filter((line) => line !== undefined)
        .join("\n")
    })

    const recent = Effect.fn("CompanionTools.recent")(function* (main: SessionSchema.Info, limit: number) {
      const messages = yield* sessions
        .messages({ sessionID: main.id, order: "desc", limit })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to read the main session", error })))
      return messages.toReversed().flatMap(describe)
    })

    yield* ctx.tool
      .transform((draft) => {
        draft.namespace({
          name: "main",
          description: "Observe and steer the main session this companion is attached to.",
        })
        draft.add({
          name: "status",
          description:
            "Report whether the main session is running, which prompts are waiting in its inbox, and whether it waits for a permission decision.",
          input: Schema.Struct({}),
          options: { namespace: "main", codemode: false },
          execute: (_input, context) =>
            mainOf(context.sessionID).pipe(
              Effect.flatMap(status),
              Effect.map((content) => ({ content })),
            ),
        })
        draft.add({
          name: "read",
          description:
            "Read the main session's most recent messages as compact text, including the step that is still running.",
          input: ReadInput,
          options: { namespace: "main", codemode: false },
          execute: (input, context) =>
            Effect.gen(function* () {
              const main = yield* mainOf(context.sessionID)
              const lines = yield* recent(main, input.limit ?? 12)
              return { content: lines.length > 0 ? lines.join("\n\n") : "The main session has no messages yet." }
            }),
        })
        draft.add({
          name: "send",
          description:
            "Send a prompt to the main session's agent. Use it to steer, correct, or give the main session follow-up work. The user sees the prompt in the main session.",
          input: SendInput,
          options: { namespace: "main", codemode: false },
          execute: (input, context) =>
            Effect.gen(function* () {
              const main = yield* mainOf(context.sessionID)
              const delivery = input.delivery ?? "steer"
              const item = yield* sessions
                .prompt({
                  sessionID: main.id,
                  text: input.text,
                  delivery,
                  metadata: { source: "companion", companionID: context.sessionID },
                })
                .pipe(
                  Effect.mapError((error) => new ToolFailure({ message: "Unable to prompt the main session", error })),
                )
              return {
                content: `Sent to the main session as ${delivery} (inbox item ${item.id}).`,
                metadata: { inboxID: item.id, delivery },
              }
            }),
        })
        draft.add({
          name: "cancel",
          description: "Cancel a prompt that is still waiting in the main session's inbox.",
          input: CancelInput,
          options: { namespace: "main", codemode: false },
          execute: (input, context) =>
            Effect.gen(function* () {
              const main = yield* mainOf(context.sessionID)
              yield* sessions
                .cancelInbox({ sessionID: main.id, inboxID: input.inboxID })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Unable to cancel inbox item ${input.inboxID}`, error }),
                  ),
                )
              return { content: `Cancelled inbox item ${input.inboxID}.` }
            }),
        })
        draft.add({
          name: "interrupt",
          description:
            "Stop the main session's current work. Use it only when the user wants the main session to stop.",
          input: InterruptInput,
          options: { namespace: "main", codemode: false },
          execute: (input, context) =>
            Effect.gen(function* () {
              const main = yield* mainOf(context.sessionID)
              const interrupted = yield* sessions.interrupt(main.id, { resume: input.resume === true })
              return {
                content: interrupted ? "Interrupted the main session." : "The main session was already idle.",
                metadata: { interrupted },
              }
            }),
        })
      })
      .pipe(Effect.orDie)

    // No client shows companion permission prompts, so asks become denials too.
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        if (event.agent !== agent) return
        if (!actions.has(event.action)) {
          event.effect = "deny"
          event.message = `The companion cannot use ${event.action}`
          return
        }
        if (event.effect !== "ask") return
        event.effect = "deny"
        event.message = "The companion cannot ask for permission"
      }),
    )

    yield* ctx.tool.hook("execute.before", (event) => {
      if (event.agent !== agent || event.tool !== ShellTool.name || !Predicate.isObject(event.input)) return Effect.void
      const command = typeof event.input.command === "string" ? event.input.command.trim() : ""
      if (readOnlyGit.test(command) && !command.includes("--output")) return Effect.void
      return Effect.fail(
        new Tool.Error({ message: "The companion can only run one read-only git command, without shell operators" }),
      )
    })

    // Companion tools stay out of every other agent's catalog.
    const hide = (event: SessionHooks["context"]) =>
      Effect.sync(() => {
        if (event.agent === agent) return
        names.forEach((name) => delete event.tools[name])
      })
    yield* ctx.session.hook("compaction", hide)
    yield* ctx.session.hook("generate", hide)
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        yield* hide(event)
        if (event.agent !== agent || event.messages.at(-1)?.role !== "user") return
        const self = yield* sessions.get(event.sessionID).pipe(Effect.orElseSucceed(() => undefined))
        if (self?.kind !== "companion" || !self.parentID) return
        const main = yield* sessions.get(self.parentID).pipe(Effect.orElseSucceed(() => undefined))
        if (!main) return
        const digest = yield* Effect.all([status(main), recent(main, 6)]).pipe(Effect.orElseSucceed(() => undefined))
        if (!digest) return
        // Unpersisted and placed before the newest prompt, so earlier turns keep their cached prefix.
        event.messages.splice(
          event.messages.length - 1,
          0,
          Message.user(
            [
              "<main-session>",
              digest[0],
              "",
              "Recent activity:",
              ...digest[1].map((line) => clip(line, 600)),
              "</main-session>",
            ].join("\n"),
          ),
        )
      }),
    )
  }),
}

function describe(message: SessionMessage.Info): string[] {
  if (message.type === "user")
    return [`[user${message.metadata?.source === "companion" ? " via companion" : ""}] ${clip(message.text, 1500)}`]
  if (message.type === "synthetic") return [`[note] ${clip(message.text, 600)}`]
  if (message.type === "shell") return [`[shell ${message.status}] ${clip(message.command, 300)}`]
  if (message.type === "compaction") return [`[compaction ${message.status}]`]
  if (message.type === "idle") return [`[main session went idle: ${message.outcome}]`]
  if (message.type === "agent-switched") return [`[switched to agent ${message.agent}]`]
  if (message.type !== "assistant") return []
  const content = message.content.flatMap((part) => {
    if (part.type === "text") return part.text.trim() ? [`[assistant] ${clip(part.text, 1500)}`] : []
    if (part.type === "reasoning") return []
    const input = part.state.status === "streaming" ? part.state.input : JSON.stringify(part.state.input)
    const result =
      part.state.status === "completed" || part.state.status === "error"
        ? (part.state.content ?? []).flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
        : ""
    return [`[tool ${part.name} ${part.state.status}] ${clip(input, 200)}${result ? `\n→ ${clip(result, 300)}` : ""}`]
  })
  if (message.error) content.push(`[error] ${clip(message.error.message, 300)}`)
  return content
}

function clip(text: string, limit: number) {
  const flat = text.trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit)}…`
}
