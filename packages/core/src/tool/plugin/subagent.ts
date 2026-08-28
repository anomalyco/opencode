export * as SubagentTool from "./subagent.js"

import { ToolFailure } from "@opencode-ai/ai"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Schema, Scope } from "effect"
import { Agent } from "../../agent.js"
import { Config } from "../../config.js"
import { PluginRuntime } from "../../plugin/runtime.js"
import { Permission } from "../../permission.js"
import { SessionSchema } from "../../session/schema.js"

export const name = "subagent"

const NO_TEXT = "Subagent completed without a text response."
const backgroundResult = (sessionID: SessionSchema.ID) => ({
  sessionID,
  status: "running" as const,
  output: [
    `The subagent is working in the background (sessionID: ${sessionID}). You will be notified automatically when it finishes.`,
    "DO NOT sleep, poll for progress, ask the subagent for status, or duplicate this subagent's work; avoid working with the same files or topics it is using.",
    "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
  ].join("\n"),
})

export const Input = Schema.Struct({
  agent: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  description: Schema.String.annotate({ description: "A short 3-5 word label for the task, displayed to the user" }),
  prompt: Schema.String.annotate({ description: "The task for the subagent to perform" }),
  sessionID: Schema.optionalKey(SessionSchema.ID).annotate({
    description:
      "Continue a specific previous subagent conversation by passing its sessionID. Calls without a sessionID start a new conversation.",
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress.",
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  status: Schema.Literals(["completed", "running"]),
  output: Schema.String,
})
export const description = [
  "Spawns an agent in a child session to work on the specified task.",
  "The output includes a sessionID you can pass back later to continue that specific conversation with the subagent.",
  "New child sessions start with fresh context, so include all relevant context and instructions when you don't pass a sessionID.",
  "Foreground (default) runs the subagent to completion and returns its final response.",
  "Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes.",
  "Use background only for independent work that can run while you continue elsewhere.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.subagent",
  effect: Effect.fn("SubagentTool.Plugin")(function* (ctx: Context) {
    const runtime = yield* PluginRuntime.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const scope = yield* Scope.Scope
    // One completion observer per job generation. Keyed by child plus start time so a fresh
    // continuation job is observable even while a settled generation's observer is finalizing.
    const notifications = new Set<string>()

    // Concatenate the child's final completed assistant text. Distinguishes "completed with no
    // text" (generic string) from "failed" (the run effect fails, surfaced as a job error).
    const latestAssistantText = Effect.fn("SubagentTool.latestAssistantText")(function* (sessionID: SessionSchema.ID) {
      const messages = yield* runtime.session.messages({ sessionID, order: "desc", limit: 20 })
      const assistant = messages.find(
        (message) =>
          message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
      )
      if (assistant === undefined || assistant.type !== "assistant") return NO_TEXT
      const text = assistant.content
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("")
      return text.length > 0 ? text : NO_TEXT
    })

    const notifyWhenDone = Effect.fn("SubagentTool.notifyWhenDone")(function* (
      parentID: SessionSchema.ID,
      childID: SessionSchema.ID,
      agent: string,
      description: string,
      startedAt: number,
    ) {
      const key = `${childID}:${startedAt}`
      if (notifications.has(key)) return
      notifications.add(key)
      yield* Effect.gen(function* () {
        const info = (yield* runtime.job.wait({ id: childID })).info
        if (!info || info.status === "running") return
        const text =
          info.status === "completed"
            ? (info.output ?? NO_TEXT)
            : info.status === "error"
              ? (info.error ?? "Subagent failed")
              : "Subagent cancelled"
        yield* runtime.session.synthetic({
          ...(info.notificationID ? { id: info.notificationID } : {}),
          sessionID: parentID,
          text: `<subagent sessionID="${childID}" state="${info.status}" description="${description}">\n${text}\n</subagent>`,
          description,
          metadata: { source: "subagent", childID, agent, state: info.status },
        })
        if (info.notificationID) yield* runtime.job.completeBackground(info.notificationID)
      }).pipe(
        Effect.ensuring(Effect.sync(() => notifications.delete(key))),
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    yield* ctx.tool
      .transform((draft) =>
        draft.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const parent = yield* runtime.session
                .get(context.sessionID)
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                  ),
                )
              let current = parent
              let depth = 0
              while (current.parentID) {
                depth++
                current = yield* runtime.session
                  .get(current.parentID)
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Parent session not found: ${current.parentID}`, error }),
                    ),
                  )
              }
              const limit = Config.latest(yield* config.entries(), "experimental")?.subagent_depth ?? 1
              if (depth >= limit)
                return yield* new ToolFailure({
                  message: `Subagent depth limit reached (${limit}). Increase "experimental.subagent_depth" to allow nested subagents.`,
                })
              const agent = yield* agents.resolve(input.agent)
              if (agent === undefined) return yield* new ToolFailure({ message: `Unknown agent: ${input.agent}` })
              if (agent.mode === "primary")
                return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` })
              yield* permission
                .assert({
                  action: name,
                  resources: [agent.id],
                  save: [agent.id],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: {
                    type: "tool",
                    messageID: context.messageID,
                    id: context.id,
                  },
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error })))

              const existing =
                input.sessionID === undefined
                  ? undefined
                  : yield* runtime.session
                      .get(input.sessionID)
                      .pipe(
                        Effect.mapError(
                          (error) =>
                            new ToolFailure({ message: `Subagent session not found: ${input.sessionID}`, error }),
                        ),
                      )
              if (existing !== undefined && existing.parentID !== context.sessionID)
                return yield* new ToolFailure({
                  message: `Session ${existing.id} is not a child of the current session`,
                })
              // Continuing with a different agent switches the child, mirroring create semantics
              // where the agent's configured model wins over the inherited one.
              if (existing !== undefined && existing.agent !== agent.id) {
                yield* runtime.session.switchAgent({ sessionID: existing.id, agent: agent.id }).pipe(
                  Effect.andThen(
                    agent.model === undefined
                      ? Effect.void
                      : runtime.session.switchModel({ sessionID: existing.id, model: agent.model }),
                  ),
                  Effect.mapError(
                    (error) =>
                      new ToolFailure({ message: `Failed to switch subagent session agent: ${existing.id}`, error }),
                  ),
                )
              }

              // Model selection is policy/config/session state, not an LLM-facing tool argument.
              const model = agent.model ?? parent.model
              const child =
                existing ??
                (yield* runtime.session
                  .create({
                    parentID: context.sessionID,
                    title: input.description,
                    agent: Agent.ID.make(input.agent),
                    model,
                  })
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                    ),
                  ))

              const background = input.background === true
              yield* context.progress({ sessionID: child.id, status: "running" })

              // Standard prompt admission outside the job: Job.start joining a running child skips
              // its run effect, and the default wake starts an idle child or steers a running one.
              yield* runtime.session
                .prompt({
                  sessionID: child.id,
                  text:
                    existing === undefined
                      ? ["You are a subagent spawned by another session.", input.prompt].join("\n")
                      : input.prompt,
                  ...(background && existing === undefined ? { resume: false } : {}),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error }),
                  ),
                )

              const info = yield* runtime.job.start({
                id: child.id,
                type: name,
                title: input.description,
                metadata: {},
                recovery: {
                  kind: "subagent",
                  parentSessionID: context.sessionID,
                  childSessionID: child.id,
                  agent: agent.name,
                  description: input.description,
                },
                run: runtime.session.resume(child.id).pipe(Effect.andThen(latestAssistantText(child.id))),
              })

              if (background) {
                yield* runtime.job.background(info.id)
                yield* notifyWhenDone(context.sessionID, child.id, agent.name, input.description, info.started_at)
                return backgroundResult(child.id)
              }

              const result = yield* runtime.job.block({ id: child.id, sessionID: context.sessionID }).pipe(
                Effect.onInterrupt(() =>
                  Effect.all([runtime.session.interrupt(child.id), runtime.job.cancel(child.id)], {
                    discard: true,
                  }),
                ),
              )
              if (result?.type === "backgrounded") {
                yield* notifyWhenDone(
                  context.sessionID,
                  child.id,
                  agent.name,
                  input.description,
                  result.info.started_at,
                )
                return backgroundResult(child.id)
              }
              // Failure surfaces keep the sessionID visible so the model can continue the child.
              if (result?.info.status === "error")
                return yield* new ToolFailure({
                  message: `Subagent failed (sessionID: ${child.id}): ${result.info.error ?? "unknown error"}`,
                })
              if (result?.info.status === "cancelled")
                return yield* new ToolFailure({ message: `Subagent cancelled (sessionID: ${child.id})` })
              return { sessionID: child.id, status: "completed" as const, output: result?.info.output ?? NO_TEXT }
            }).pipe(
              Effect.map((output) => ({
                output,
                content:
                  output.status === "completed"
                    ? `<subagent sessionID="${output.sessionID}" state="completed">\n${output.output}\n</subagent>`
                    : output.output,
                metadata: { sessionID: output.sessionID, status: output.status },
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        const selected = yield* agents.resolve(event.agent)
        if (!selected) return
        const available = (yield* agents.list())
          .filter(
            (agent) =>
              agent.mode !== "primary" &&
              !agent.hidden &&
              Permission.evaluate(name, agent.id, selected.permissions).effect !== "deny",
          )
          .toSorted((a, b) => a.id.localeCompare(b.id))
        if (available.length === 0) return
        tool.description = [
          tool.description,
          "",
          "Available subagents:",
          ...available.map(
            (agent) =>
              `- ${agent.id}: ${agent.description ?? "This subagent should only be called when explicitly requested."}`,
          ),
        ].join("\n")
      }),
    )
  }),
}
