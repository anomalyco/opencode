export * as SubagentTool from "./subagent"

import { ToolFailure } from "@opencode-ai/ai"
import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Schema, Scope } from "effect"
import { AgentV2 } from "../agent"
import { Config } from "../config"
import { PluginRuntime } from "../plugin/runtime"
import { PermissionV2 } from "../permission"
import { SessionSchema } from "../session/schema"
import { Tool } from "./tool"

export const name = "subagent"

const NO_TEXT = "Subagent completed without a text response."
const backgroundStarted = (sessionID: SessionSchema.ID) =>
  `The subagent is working in the background (id: ${sessionID}). You will be notified automatically when it finishes. DO NOT sleep, poll, or proactively check on its progress.`

export const Input = Schema.Struct({
  agent: Schema.String.annotate({ description: "The configured agent to run as the subagent" }),
  description: Schema.String.annotate({ description: "A short description of the subagent's task" }),
  prompt: Schema.String.annotate({ description: "The task for the subagent to perform" }),
  background: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes. DO NOT poll its progress.",
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  status: Schema.Literals(["completed", "running"]),
  output: Schema.String,
})

export const description = [
  "Spawn a subagent: a child session running a configured agent with fresh context.",
  "Foreground (default) runs the subagent to completion and returns its final response.",
  "Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes.",
  "Use background only for independent work that can run while you continue elsewhere.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.subagent",
  effect: Effect.fn("SubagentTool.Plugin")(function* (ctx: PluginContext) {
    const runtime = yield* PluginRuntime.Service
    const agents = yield* AgentV2.Service
    const config = yield* Config.Service
    const permission = yield* PermissionV2.Service
    const scope = yield* Scope.Scope

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

    const injectCompletion = Effect.fn("SubagentTool.injectCompletion")(function* (
      parentID: SessionSchema.ID,
      childID: SessionSchema.ID,
      agent: string,
      description: string,
      state: "completed" | "error" | "cancelled",
      text: string,
    ) {
      yield* runtime.session.synthetic({
        sessionID: parentID,
        text: `<subagent id="${childID}" state="${state}" description="${description}">\n${text}\n</subagent>`,
        description,
        metadata: { source: "subagent", childID, agent, state },
      })
    })

    const notifyWhenDone = Effect.fn("SubagentTool.notifyWhenDone")(function* (
      parentID: SessionSchema.ID,
      childID: SessionSchema.ID,
      agent: string,
      description: string,
    ) {
      yield* runtime.job.wait({ id: childID }).pipe(
        Effect.flatMap((result) => {
          if (result.info?.status === "completed")
            return injectCompletion(parentID, childID, agent, description, "completed", result.info.output ?? NO_TEXT)
          if (result.info?.status === "error")
            return injectCompletion(
              parentID,
              childID,
              agent,
              description,
              "error",
              result.info.error ?? "Subagent failed",
            )
          if (result.info?.status === "cancelled")
            return injectCompletion(parentID, childID, agent, description, "cancelled", "Subagent cancelled")
          return Effect.void
        }),
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          Tool.make({
            description,
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
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
                      callID: context.callID,
                    },
                  })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error })))

                // Model selection is policy/config/session state, not an LLM-facing tool argument.
                const model = agent.model ?? parent.model
                const child = yield* runtime.session
                  .create({
                    parentID: context.sessionID,
                    title: input.description,
                    agent: AgentV2.ID.make(input.agent),
                    model,
                    // TODO(opencode kkdvxn): derive restricted subagent permissions from the parent
                    // session (V1 deriveSubagentSessionPermission). MVP uses the agent's own permissions.
                  })
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                    ),
                  )

                const background = input.background === true
                yield* context.progress({
                  structured: { sessionID: child.id, status: "running" },
                })

                const run = Effect.gen(function* () {
                  // The child session owns its agent/model (set at create); prompt only admits input.
                  yield* runtime.session.prompt({ sessionID: child.id, text: input.prompt, resume: false })
                  yield* runtime.session.resume(child.id)
                  return yield* latestAssistantText(child.id)
                }).pipe(Effect.onInterrupt(() => runtime.session.interrupt(child.id)))

                const info = yield* runtime.job.start({
                  id: child.id,
                  type: name,
                  title: input.description,
                  metadata: {},
                  run,
                })

                if (background) {
                  yield* runtime.job.background(info.id)
                  yield* notifyWhenDone(context.sessionID, child.id, agent.name, input.description)
                  return {
                    sessionID: child.id,
                    status: "running" as const,
                    output: backgroundStarted(child.id),
                  }
                }

                const result = yield* runtime.job.block({ id: child.id, sessionID: context.sessionID }).pipe(
                  Effect.onInterrupt(() =>
                    Effect.all([runtime.session.interrupt(child.id), runtime.job.cancel(child.id)], {
                      discard: true,
                    }),
                  ),
                )
                if (result?.type === "backgrounded") {
                  yield* notifyWhenDone(context.sessionID, child.id, agent.name, input.description)
                  return {
                    sessionID: child.id,
                    status: "running" as const,
                    output: backgroundStarted(child.id),
                  }
                }
                if (result?.info.status === "error")
                  return yield* new ToolFailure({ message: result.info.error ?? "Subagent failed" })
                if (result?.info.status === "cancelled")
                  return yield* new ToolFailure({ message: "Subagent cancelled" })
                return { sessionID: child.id, status: "completed" as const, output: result?.info.output ?? NO_TEXT }
              }),
          }),
          { codemode: false },
        ),
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
              PermissionV2.evaluate(name, agent.id, selected.permissions).effect !== "deny",
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
