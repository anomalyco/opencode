export * as SubagentTool from "./subagent"

import { ToolFailure } from "@opencode-ai/llm"
import { DateTime, Effect, Layer, Schema, Scope } from "effect"
import { AgentV2 } from "../agent"
import { BackgroundJob } from "../background-job"
import { EventV2 } from "../event"
import { LocationServiceMap } from "../location-service-map"
import { SessionV2 } from "../session"
import { SessionEvent } from "../session/event"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { makeGlobalNode } from "../effect/app-node"
import { ApplicationTools } from "./application-tools"
import { Tool } from "./tool"

export const name = "subagent"

const NO_TEXT = "Subagent completed without a text response."
const BACKGROUND_STARTED =
  "The subagent is working in the background. You will be notified automatically when it finishes. DO NOT sleep, poll, or proactively check on its progress."

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

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* ApplicationTools.Service
    const sessions = yield* SessionV2.Service
    const jobs = yield* BackgroundJob.Service
    const events = yield* EventV2.Service
    const locations = yield* LocationServiceMap.Service
    const scope = yield* Scope.Scope

    // Concatenate the child's final completed assistant text. Distinguishes "completed with no
    // text" (generic string) from "failed" (the run effect fails, surfaced as a job error).
    const latestAssistantText = Effect.fn("SubagentTool.latestAssistantText")(function* (sessionID: SessionSchema.ID) {
      const messages = yield* sessions.messages({ sessionID, order: "desc", limit: 20 })
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
      description: string,
      state: "completed" | "error" | "cancelled",
      text: string,
    ) {
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID: parentID,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        text: `<subagent id="${childID}" state="${state}" description="${description}">\n${text}\n</subagent>`,
      })
    })

    const injectWhenDone = Effect.fn("SubagentTool.injectWhenDone")(function* (
      parentID: SessionSchema.ID,
      childID: SessionSchema.ID,
      description: string,
    ) {
      yield* jobs.wait({ id: childID }).pipe(
        Effect.flatMap((result) => {
          if (result.info?.status === "completed")
            return injectCompletion(parentID, childID, description, "completed", result.info.output ?? NO_TEXT)
          if (result.info?.status === "error")
            return injectCompletion(parentID, childID, description, "error", result.info.error ?? "Subagent failed")
          if (result.info?.status === "cancelled")
            return injectCompletion(parentID, childID, description, "cancelled", "Subagent cancelled")
          return Effect.void
        }),
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const parent = yield* sessions
                .get(context.sessionID)
                .pipe(
                  Effect.mapError(() => new ToolFailure({ message: `Parent session not found: ${context.sessionID}` })),
                )
              const agents = yield* AgentV2.Service.pipe(Effect.provide(locations.get(parent.location)))
              const agent = yield* agents.resolve(input.agent)
              if (agent === undefined) return yield* new ToolFailure({ message: `Unknown agent: ${input.agent}` })
              if (agent.mode === "primary")
                return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` })

              // Model selection is policy/config/session state, not an LLM-facing tool argument.
              const model = agent.model ?? parent.model
              const child = yield* sessions
                .create({
                  parentID: context.sessionID,
                  title: input.description,
                  agent: AgentV2.ID.make(input.agent),
                  model,
                  // TODO(opencode kkdvxn): derive restricted subagent permissions from the parent
                  // session (V1 deriveSubagentSessionPermission). MVP uses the agent's own permissions.
                })
                .pipe(
                  Effect.mapError(() => new ToolFailure({ message: `Parent session not found: ${context.sessionID}` })),
                )

              const background = input.background === true

              const run = Effect.gen(function* () {
                // The child session owns its agent/model (set at create); prompt only admits input.
                yield* sessions.prompt({ sessionID: child.id, prompt: { text: input.prompt }, resume: false })
                yield* sessions.resume(child.id)
                return yield* latestAssistantText(child.id)
              })

              const info = yield* jobs.start({
                id: child.id,
                type: name,
                title: input.description,
                metadata: {},
                onPromote: injectWhenDone(context.sessionID, child.id, input.description),
                run,
              })

              if (background) {
                if ((yield* jobs.promote(info.id)) === undefined)
                  yield* injectWhenDone(context.sessionID, child.id, input.description)
                return { sessionID: child.id, status: "running" as const, output: BACKGROUND_STARTED }
              }

              const result = yield* Effect.raceFirst(
                jobs.wait({ id: child.id }).pipe(Effect.map((waited) => waited.info)),
                jobs.waitForPromotion(child.id),
              ).pipe(
                Effect.onInterrupt(() =>
                  Effect.all([sessions.interrupt(child.id), jobs.cancel(child.id)], { discard: true }),
                ),
              )
              if (result?.metadata?.background === true)
                return { sessionID: child.id, status: "running" as const, output: BACKGROUND_STARTED }
              if (result?.status === "error")
                return yield* new ToolFailure({ message: result.error ?? "Subagent failed" })
              if (result?.status === "cancelled") return yield* new ToolFailure({ message: "Subagent cancelled" })
              return { sessionID: child.id, status: "completed" as const, output: result?.output ?? NO_TEXT }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

// Registered at the app root via ApplicationTools, not as a Location node: SessionV2 sits above
// LocationServiceMap, so a location-scoped subagent node would create a static dependency cycle.
// Agent lookup is resolved through the parent Session's location when the tool executes.
export const node = makeGlobalNode({
  name: "subagent-tool",
  layer,
  deps: [ApplicationTools.node, SessionV2.node, BackgroundJob.node, EventV2.node, LocationServiceMap.node],
})
