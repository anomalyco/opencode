/// <reference path="../../markdown.d.ts" />

export * as CodeModeAgentsPlugin from "./codemode-agents.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect, Result, type Schema } from "effect"
import { Agent } from "../../agent.js"
import { CodeModeAgents } from "../../codemode/agents.js"
import { Config } from "../../config.js"
import { Flag } from "../../flag.js"
import { Job } from "../../job.js"
import { Model } from "../../model.js"
import { Permission } from "../../permission.js"
import { AbsolutePath } from "../../schema.js"
import { Session } from "../../session.js"
import type { SessionMessage } from "../../session/message.js"
import { SessionSchema } from "../../session/schema.js"
import { SubagentCompletion } from "../../session/subagent-completion.js"
import { SubagentDepth } from "../../session/subagent-depth.js"
import { toSessionError } from "../../session/to-session-error.js"
import { Skill } from "../../skill.js"
import { resolveModelRef } from "./subagent.js"
import skillContent from "./codemode-agents.md" with { type: "text" }

/** The tool an agent() child with a schema returns its result through. Only those children see it. */
export const OUTPUT_TOOL = CodeModeAgents.OUTPUT_TOOL

const DEFAULT_AGENT = "general"
const LLM_ATTEMPTS = 3

export const SkillDescription =
  "Read before writing a Code Mode script that calls agent() or llm(): the full API, schemas, limits, and patterns for fanning work out, verifying it and combining the results."

export const Plugin = {
  id: "opencode.tool.codemode-agents",
  effect: Effect.fn("CodeModeAgentsPlugin")(function* (ctx: Context) {
    if (!(yield* Flag.enabled("codemode_agents"))) return
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const models = yield* Model.Service
    const registry = yield* CodeModeAgents.Service
    const skills = yield* Skill.Service
    const jobs = yield* Job.Service

    const expectedOutput = (sessionID: SessionSchema.ID) =>
      sessions.get(sessionID).pipe(
        Effect.map((session) => {
          const marker = CodeModeAgents.sessionMarker(session.id, session.metadata)
          if (!marker?.structured || marker.schema === undefined) return undefined
          return { schema: marker.schema, wrapped: marker.wrapped === true }
        }),
        Effect.orElseSucceed(() => undefined),
      )

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: OUTPUT_TOOL,
          options: { codemode: false },
          description:
            "Return your final result to the script that started you. Call it once when your work is done; your turn ends immediately once the result is accepted.",
          // Each child is shown its own schema by the context hook below; the result is checked against it here.
          input: { type: "object" },
          execute: (input: unknown, context) =>
            Effect.gen(function* () {
              const expected = yield* expectedOutput(context.sessionID)
              if (expected === undefined)
                return yield* new ToolFailure({
                  message: `${OUTPUT_TOOL} only works in an agent started by a Code Mode script with a schema.`,
                })
              const compiled = CodeModeAgents.compile(expected.schema, expected.wrapped)
              if (Result.isFailure(compiled))
                return yield* new ToolFailure({ message: `Invalid stored output schema: ${compiled.failure}` })
              const checked = CodeModeAgents.check(compiled.success, input)
              if (Result.isFailure(checked))
                return yield* new ToolFailure({
                  message: `The result does not match the required schema:\n${checked.failure}\n\nCall ${OUTPUT_TOOL} again with a corrected result.`,
                })
              return { content: "Result recorded and returned to the script." }
            }),
        }),
      )
      .pipe(Effect.orDie)

    const shape = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[OUTPUT_TOOL]
        if (tool === undefined) return
        const expected = yield* expectedOutput(event.sessionID)
        if (expected === undefined) {
          delete event.tools[OUTPUT_TOOL]
          return
        }
        tool.input = expected.schema
      })
    yield* ctx.session.hook("context", shape)
    yield* ctx.session.hook("compaction", shape)
    yield* ctx.session.hook("generate", shape)

    // Runs the child until it goes idle, stopping it when the script stops waiting.
    const drain = (childID: SessionSchema.ID, text: string): Effect.Effect<SessionMessage.Info | undefined, unknown> =>
      Effect.gen(function* () {
        yield* sessions.prompt({ sessionID: childID, text, resume: false })
        yield* sessions.resume(childID).pipe(Effect.onInterrupt(() => sessions.interrupt(childID)))
        const [last] = yield* sessions.messages({ sessionID: childID, limit: 1, order: "desc", type: "assistant" })
        if (last?.type === "assistant" && last.error !== undefined)
          return yield* new CodeModeAgents.CallError({
            message: `${last.error.message} (session ${childID})`,
            limit: isLimit(last.error.type),
          })
        return last
      })

    // The script has the child's result, or has stopped waiting for it, so nothing the child left running has anyone
    // to report to: its background commands and its own subagents stop with the call. Jobs are cancelled before the
    // interrupt so none finishes in between and wakes the child, and after it for any the last step started.
    const stop = (sessionID: SessionSchema.ID): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* jobs.cancelSession(sessionID)
        yield* sessions.interrupt(sessionID)
        yield* jobs.cancelSession(sessionID)
        const children = yield* sessions.list({ parentID: sessionID, limit: 1000 }).pipe(Effect.orDie)
        yield* Effect.forEach(children.data, (child) => stop(child.id), { discard: true })
      })

    const recordedOutput = (childID: SessionSchema.ID, output: CodeModeAgents.Output) =>
      sessions.messages({ sessionID: childID, order: "desc", type: "assistant" }).pipe(
        Effect.map((messages) => {
          for (const message of messages) {
            if (message.type !== "assistant") continue
            for (const part of [...message.content].reverse()) {
              if (part.type !== "tool" || part.name !== OUTPUT_TOOL || part.state.status !== "completed") continue
              const checked = CodeModeAgents.check(output, part.state.input)
              if (Result.isSuccess(checked)) return { value: checked.success }
            }
          }
          return undefined
        }),
      )

    const agent = Effect.fn("CodeModeAgents.agent")(function* (
      input: CodeModeAgents.AgentInput,
      execution: Parameters<CodeModeAgents.Implementation["agent"]>[1],
    ): Effect.fn.Return<unknown, unknown> {
      const parent = yield* sessions.get(execution.sessionID)
      const depth = yield* SubagentDepth.reached(parent, sessions, config)
      if (depth !== undefined)
        return yield* fail(
          `agent() cannot start agents this deep (limit ${depth}). Increase "experimental.subagent_depth" to allow nested agents.`,
        )
      const info = yield* agents.resolve(input.agent ?? DEFAULT_AGENT)
      if (info === undefined) return yield* fail(`Unknown agent: ${input.agent ?? DEFAULT_AGENT}`)
      if (info.mode === "primary") return yield* fail(`Agent ${info.id} cannot run as a subagent`)
      yield* permission.assert({
        action: "subagent",
        resources: [info.id],
        save: [info.id],
        ...Permission.invocation(execution),
      })
      const baseModel =
        input.model === undefined ? (info.model ?? parent.model) : yield* resolveModelRef(models, input.model)
      const model = yield* applyEffort(models, baseModel, input.effort, false)
      const output = input.output
      const id = SessionSchema.ID.create()
      // Stored durably on the child so schema validation and restart handling never depend on process memory.
      const marker: Record<string, Schema.Json> =
        output === undefined
          ? { childID: id, structured: false }
          : { childID: id, structured: true, schema: output.json as Schema.Json, wrapped: output.wrapped }
      const child = yield* sessions.create({
        id,
        parentID: parent.id,
        title: input.label ?? title(input.prompt),
        agent: info.id,
        model,
        metadata: { ...(parent.metadata ?? {}), [CodeModeAgents.METADATA_KEY]: marker },
        // Deny-by-default subagents such as `explore` strip tools outside their allowlist; let them return their answer.
        ...(output === undefined
          ? {}
          : { permissions: [...(parent.permissions ?? []), { action: OUTPUT_TOOL, resource: "*", effect: "allow" }] }),
      })
      return yield* Effect.gen(function* () {
        if (output === undefined) return SubagentCompletion.text(yield* drain(child.id, frame(input.prompt, false)))
        yield* drain(child.id, frame(input.prompt, true))
        const first = yield* recordedOutput(child.id, output)
        if (first !== undefined) return first.value
        // One reminder: a model that answered in text usually calls the tool when told.
        yield* drain(
          child.id,
          `You ended without calling ${OUTPUT_TOOL}. Call it now with your result, and do nothing else.`,
        )
        const second = yield* recordedOutput(child.id, output)
        if (second === undefined)
          return yield* fail(
            `The agent finished without returning a result that matches the schema (session ${child.id}).`,
          )
        return second.value
      }).pipe(Effect.ensuring(stop(child.id)))
    })

    const llm = Effect.fn("CodeModeAgents.llm")(function* (
      input: CodeModeAgents.LlmInput,
      execution: Parameters<CodeModeAgents.Implementation["llm"]>[1],
    ): Effect.fn.Return<unknown, unknown> {
      const parent = yield* sessions.get(execution.sessionID)
      const baseModel = input.model === undefined ? parent.model : yield* resolveModelRef(models, input.model)
      // llm() defaults to lower reasoning effort unless the caller asked for a specific effort or #variant.
      const model = yield* applyEffort(
        models,
        baseModel,
        input.effort,
        input.effort === undefined && baseModel?.variant === undefined,
      )
      const request = {
        sessionID: execution.sessionID,
        history: false,
        ...(input.system === undefined ? {} : { system: input.system }),
        ...(model === undefined ? {} : { model }),
      }
      const output = input.output
      if (output === undefined) return (yield* sessions.generate({ ...request, prompt: input.prompt })).text
      // Each attempt tells the model what was wrong with the last answer.
      const attempt = (issues: string | undefined, remaining: number): Effect.Effect<unknown, unknown> =>
        Effect.gen(function* () {
          const result = yield* sessions.generate({
            ...request,
            output: output.json,
            prompt:
              issues === undefined
                ? input.prompt
                : `${input.prompt}\n\nYour previous answer did not match the required schema:\n${issues}\nAnswer again, fixing these.`,
          })
          const checked =
            result.output === undefined
              ? Result.fail("- the answer did not use the required output tool")
              : CodeModeAgents.check(output, result.output)
          if (Result.isSuccess(checked)) return checked.success
          if (remaining > 1) return yield* attempt(checked.failure, remaining - 1)
          return yield* fail(
            `llm() did not return a value that matches the schema after ${LLM_ATTEMPTS} attempts:\n${checked.failure}`,
          )
        })
      return yield* attempt(undefined, LLM_ATTEMPTS)
    })

    yield* registry.register({
      agent: (input, execution) => agent(input, execution).pipe(Effect.mapError(callError)),
      llm: (input, execution) => llm(input, execution).pipe(Effect.mapError(callError)),
    })

    yield* skills.transform((editor) => {
      editor.add(
        Skill.Info.make({
          id: Skill.ID.make("codemode-agents"),
          name: Skill.Name.make("Code Mode agents"),
          description: SkillDescription,
          path: AbsolutePath.make("skill://codemode-agents/SKILL.md"),
          content: skillContent,
        }),
      )
    })
  }),
}

// Maps a requested effort level onto the model's supported variants (exact match, else nearest lower variant).
// For `defaultLow`, prefers `low` (then `minimal`/`none`) so fast `llm()` calls don't burn heavy reasoning tokens.
const applyEffort = Effect.fn("CodeModeAgents.applyEffort")(function* (
  models: Model.Interface,
  ref: Model.Ref | undefined,
  effort: CodeModeAgents.Effort | undefined,
  defaultLow: boolean,
) {
  if (ref === undefined) return undefined
  if (effort === undefined && !defaultLow) return ref
  const info = yield* models.get(ref.providerID, ref.id)
  if (info === undefined || info.variants.length === 0) return ref
  const available = new Set<string>(info.variants.map((item) => item.id))
  const pick =
    effort !== undefined
      ? (CodeModeAgents.EFFORTS.slice(0, CodeModeAgents.EFFORTS.indexOf(effort) + 1)
          .toReversed()
          .find((candidate) => available.has(candidate)) ??
        CodeModeAgents.EFFORTS.slice(CodeModeAgents.EFFORTS.indexOf(effort) + 1).find((candidate) =>
          available.has(candidate),
        ))
      : (["low", "minimal", "none"] as const).find((candidate) => available.has(candidate))
  if (pick === undefined) return ref
  return Model.Ref.make({ providerID: ref.providerID, id: ref.id, variant: Model.VariantID.make(pick) })
})

const fail = (message: string) => Effect.fail(new CodeModeAgents.CallError({ message, limit: false }))

const isLimit = (type: string) => /rate-limit|quota|-limit$/.test(type)

const callError = (error: unknown) => {
  if (error instanceof CodeModeAgents.CallError) return error
  const session = toSessionError(error)
  return new CodeModeAgents.CallError({ message: session.message, limit: isLimit(session.type) })
}

const title = (prompt: string) => {
  const line = prompt.trim().split("\n", 1)[0] ?? ""
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

const frame = (prompt: string, structured: boolean) =>
  [
    "You are a subagent started by a Code Mode script. The script reads your result as data; no person reads it.",
    "- Do the task below, and only that task.",
    "- Wait for every command you start: anything still running in the background when you finish is stopped.",
    structured
      ? `- When you are done, call the \`${OUTPUT_TOOL}\` tool once with your result. Its input schema is the shape the script needs; your turn ends as soon as it is accepted. Do not put the result in a text reply.`
      : "- End with the result itself as your final message: no greetings, confirmations or summary of what you did. If asked for JSON, reply with only the JSON, with no code fence.",
    "",
    "Task:",
    prompt,
  ].join("\n")
