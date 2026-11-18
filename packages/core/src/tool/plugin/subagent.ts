export * as SubagentTool from "./subagent.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect, Predicate, Schema } from "effect"
import { Agent } from "../../agent.js"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { Job } from "../../job.js"
import { Model } from "../../model.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { SessionEvent } from "../../session/event.js"
import { SessionMessage } from "../../session/message.js"
import { SubagentRecovery } from "../../session/subagent-recovery.js"
import { SubagentCompletion } from "../../session/subagent-completion.js"
import { SubagentDepth } from "../../session/subagent-depth.js"
import { SubagentJob } from "../../session/subagent-job.js"

export const name = "subagent"

export const backgroundResult = (sessionID: SessionSchema.ID) => ({
  sessionID,
  status: "running" as const,
  output: [
    `The subagent is working in the background (sessionID: ${sessionID}). You will receive a <subagent> message when it goes idle, and again after each later round of work.`,
    "DO NOT sleep, poll, proactively check on its progress, or duplicate this subagent's work.",
    "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
    "To send it follow-ups or change its instructions while it runs, call subagent again with this sessionID.",
  ].join("\n"),
})

export const Input = Schema.Struct({
  agent: Schema.String.annotate({
    description:
      "The type of specialized agent to use for this task. If the user asks for a subagent by a name that is not one of the available subagents, they most likely mean a model: pick a suitable agent and pass the name through the model parameter instead.",
  }),
  description: Schema.String.annotate({ description: "A short 3-5 word label for the task, displayed to the user" }),
  prompt: Schema.String.annotate({ description: "The task for the subagent to perform" }),
  model: Schema.optionalKey(Schema.String).annotate({
    description:
      'NEVER set this unless the user explicitly asks for a particular model or variant. It must be a chat model; image and decision models can\'t run subagents. The value is written as "providerID/modelID", or "providerID/modelID#variant" to include a variant. Do not guess the ID: look the model up with the models tool, filtering to your own provider first.',
  }),
  sessionID: Schema.optionalKey(SessionSchema.ID).annotate({
    description: "Send a follow-up to an existing subagent, running or finished. Omit to start a new one.",
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  status: Schema.Literal("running"),
  output: Schema.String,
})
export const description = [
  "Spawns an agent in a child session to work on the specified task.",
  "Subagents always run in the background: the call returns immediately with a sessionID, and you receive a `<subagent>` message each time the child goes idle, including after later work.",
  "Keep working on non-overlapping tasks, or briefly tell the user what you launched and end your response. Do not sleep, poll, or proactively check on the child's progress.",
  "New child sessions start with fresh context, so include all relevant context and instructions when you don't pass a sessionID.",
  "Pass the returned sessionID to continue that specific child conversation. A follow-up to a running child joins its current run.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.subagent",
  effect: Effect.fn("SubagentTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const bus = yield* Bus.Service
    const jobs = yield* Job.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const models = yield* Model.Service
    const subagents = yield* SubagentJob.Service

    const resolveModel = Effect.fn("SubagentTool.resolveModel")(function* (input: string) {
      const ref = yield* Effect.try({
        try: () => Model.Ref.parse(input),
        catch: () =>
          new ToolFailure({
            message: `Invalid model "${input}". Use "providerID/modelID" or "providerID/modelID#variant".`,
          }),
      })
      const model = (yield* models.available()).find(
        (model) => model.providerID === ref.providerID && model.id === ref.id,
      )
      if (model === undefined) {
        const other = (yield* models.available(["image", "decision"])).find(
          (model) => model.providerID === ref.providerID && model.id === ref.id,
        )
        return yield* new ToolFailure({
          message: other
            ? `Model "${ref.providerID}/${ref.id}" is ${other.type === "image" ? "an image" : "a decision"} model; subagents need a chat model. Use the models tool to find one.`
            : `Model "${ref.providerID}/${ref.id}" is not available. Use the models tool to see what is available.`,
        })
      }
      if (ref.variant !== undefined && !model.variants.some((variant) => variant.id === ref.variant))
        return yield* new ToolFailure({
          message:
            model.variants.length === 0
              ? `Model "${ref.providerID}/${ref.id}" has no variants. Omit the variant.`
              : `Variant "${ref.variant}" is not available for "${ref.providerID}/${ref.id}". Available: ${model.variants.map((variant) => variant.id).join(", ")}.`,
        })
      return ref
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const parent = yield* sessions
                .get(context.sessionID)
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                  ),
                )
              const message = yield* sessions.message({ sessionID: context.sessionID, messageID: context.messageID })
              const call =
                message?.type === "assistant"
                  ? message.content.find((item) => item.type === "tool" && item.id === context.id)
                  : undefined
              const prior = yield* sessions.subagentOperation({
                sessionID: context.sessionID,
                assistantMessageID: context.messageID,
                callID: context.id,
              })
              if (
                prior &&
                (call?.type !== "tool" || call.name !== name || prior.input_digest !== SubagentRecovery.digest(input))
              )
                return yield* new ToolFailure({ message: `Subagent operation identity mismatch: ${context.id}` })
              if (prior?.status === "failed" && call?.type === "tool" && call.state.status === "error")
                return yield* new ToolFailure({ message: call.state.error.message })
              if (prior?.status === "completed" && call?.type === "tool" && call.state.status === "completed") {
                if (call.state.metadata?.sessionID !== prior.child_session_id)
                  return yield* new ToolFailure({ message: `Subagent result identity mismatch: ${context.id}` })
                return backgroundResult(prior.child_session_id)
              }
              if (prior?.status !== undefined && (call?.type !== "tool" || call.state.status !== "running"))
                return yield* new ToolFailure({ message: `Subagent operation state mismatch: ${context.id}` })
              const limit = yield* SubagentDepth.reached(parent, sessions, config).pipe(
                Effect.mapError(
                  (error) => new ToolFailure({ message: `Parent session not found: ${error.sessionID}`, error }),
                ),
              )
              if (limit !== undefined)
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
                  ...Permission.invocation(context),
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error })))

              const existing =
                input.sessionID === undefined
                  ? undefined
                  : yield* sessions
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
              const override = input.model === undefined ? undefined : yield* resolveModel(input.model)
              const model = override ?? agent.model ?? parent.model
              const confirmed = call?.type === "tool" && call.name === name && call.state.status === "running"
              const recorded = confirmed ? SubagentRecovery.prepared(call) : undefined
              if (confirmed && SubagentRecovery.digest(input) !== SubagentRecovery.digest(call.state.input))
                return yield* new ToolFailure({ message: `Subagent operation input changed: ${context.id}` })
              if (confirmed && call.state.metadata.recovery !== undefined && !recorded)
                return yield* new ToolFailure({ message: `Subagent operation identity mismatch: ${context.id}` })
              const reservedModel =
                confirmed && !recorded ? (model ?? (yield* agents.select(parent.agent)).info?.model) : undefined
              const operation = confirmed
                ? (recorded ?? {
                    childSessionID: existing?.id ?? SessionSchema.ID.create(),
                    inboxID: SessionMessage.ID.create(),
                    inputDigest: SubagentRecovery.digest(call.state.input),
                    agent: agent.id,
                    // Projected tool metadata must be JSON, so a catalog-default child omits the key.
                    ...(reservedModel === undefined ? {} : { model: reservedModel }),
                  })
                : undefined
              if (
                recorded &&
                (recorded.agent !== agent.id || recorded.childSessionID !== (existing?.id ?? recorded.childSessionID))
              )
                return yield* new ToolFailure({ message: `Subagent operation changed on replay: ${context.id}` })

              // Continuing with a different agent switches the child, mirroring create semantics
              // where an explicit model wins over the agent's configured model, which wins over the inherited one.
              if (existing !== undefined && !recorded) {
                const switched = existing.agent !== agent.id
                const model = override ?? (switched ? agent.model : undefined)
                yield* Effect.all([
                  switched ? sessions.switchAgent({ sessionID: existing.id, agent: agent.id }) : Effect.void,
                  model === undefined ? Effect.void : sessions.switchModel({ sessionID: existing.id, model }),
                ]).pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to switch subagent session: ${existing.id}`, error }),
                  ),
                )
              }
              if (operation && recorded === undefined)
                yield* bus.publish(SessionEvent.Tool.SubagentPrepared, {
                  sessionID: context.sessionID,
                  assistantMessageID: context.messageID,
                  id: context.id,
                  recovery: operation,
                })

              const child =
                existing ??
                (yield* sessions
                  .create({
                    ...(operation ? { id: operation.childSessionID } : {}),
                    parentID: context.sessionID,
                    title: input.description,
                    agent: operation?.agent ?? agent.id,
                    model: operation?.model ?? model ?? (yield* agents.select(parent.agent)).info?.model,
                  })
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                    ),
                  ))
              if (child.parentID !== context.sessionID)
                return yield* new ToolFailure({ message: `Session ${child.id} is not a child of the current session` })

              // A child that is not draining yet must be admitted without waking: the job's resume
              // owns the start, so the period cannot run before its boundary is registered.
              const running =
                existing !== undefined &&
                ((yield* sessions.active).has(existing.id) || (yield* jobs.get(existing.id))?.status === "running")
              yield* context.progress({ sessionID: child.id, status: "running" })

              yield* sessions
                .prompt({
                  ...(operation ? { id: operation.inboxID } : {}),
                  sessionID: child.id,
                  text:
                    existing === undefined
                      ? ["You are a subagent spawned by another session.", input.prompt].join("\n")
                      : input.prompt,
                  ...(running ? {} : { resume: false }),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error }),
                  ),
                )

              const settled = operation
                ? yield* SubagentRecovery.settled(sessions, child.id, operation.inboxID).pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Failed to inspect subagent: ${child.id}`, error }),
                    ),
                  )
                : undefined
              if (settled && operation) {
                yield* SubagentCompletion.deliver(sessions, jobs, {
                  status:
                    settled.status === "succeeded"
                      ? "completed"
                      : settled.status === "interrupted"
                        ? "cancelled"
                        : "error",
                  output: settled.output,
                  error: settled.status,
                  notificationID: SubagentRecovery.notificationID(operation),
                  recovery: {
                    kind: "subagent",
                    parentSessionID: context.sessionID,
                    childSessionID: child.id,
                    agent: agent.name,
                    description: input.description,
                  },
                  resume: false,
                }).pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to notify subagent completion: ${child.id}`, error }),
                  ),
                )
                return backgroundResult(child.id)
              }
              const recovery = {
                kind: "subagent" as const,
                parentSessionID: context.sessionID,
                childSessionID: child.id,
                agent: agent.name,
                description: input.description,
              }
              yield* subagents.start(recovery, operation ? SubagentRecovery.notificationID(operation) : undefined)
              return backgroundResult(child.id)
            }).pipe(
              Effect.map((output) => ({
                output,
                content: output.output,
                metadata: { sessionID: output.sessionID, status: output.status },
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.sync(() => {
        if (event.tool !== name || !Predicate.isObject(event.input)) return
        if (event.input.model !== "" && event.input.sessionID !== "") return
        const input = { ...event.input }
        if (input.model === "") delete input.model
        if (input.sessionID === "") delete input.sessionID
        event.input = input
      }),
    )

    const hook = (event: SessionHooks["context"]) =>
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
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
