export * as MetaCognition from "./meta"

import { LLM, LLMClient, Message, Model, SystemPart, type LLMClientShape, type TextPart as LLMTextPart } from "@opencode-ai/llm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Catalog } from "../../catalog"
import { EventV2 } from "../../event"
import { ModelV2 } from "../../model"
import { DependencyTracker } from "../dep-tracker"
import { SessionEvent } from "../event"
import { SessionKnowledge } from "../knowledge"
import { SessionSchema } from "../schema"
import { SessionRunnerModel } from "./model"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"

const PLANNER_PROMPT = `You are a planning assistant for an AI coding agent. Before the agent starts writing code, analyze the user's request and produce a structured plan.

Output a JSON object with these fields:
- "intent": one sentence describing what the user wants
- "files": array of { "path": string, "relevance": "read" | "modify" | "create" }
- "risks": array of { "description": string, "severity": "low" | "medium" | "high" }
- "approach": array of { "step": number, "description": string }
- "missingContext": array of string

Be concise. Focus on actionable analysis.`

const VERIFIER_PROMPT = `You are a verification assistant for an AI coding agent. After the agent completes a step, analyze the changes and verify correctness.

Output a JSON object with these fields:
- "passed": boolean
- "issues": array of { "type": string, "description": string, "file"?: string, "severity": "suggestion" | "warning" | "error" }
- "summary": string
- "suggestions": array of string (optional)

Be thorough but concise. Focus on detecting real problems.`

const REFLECTOR_PROMPT = `You are a reflection assistant for an AI coding agent. After a series of steps, extract lessons and insights.

Output a JSON object with these fields:
- "insights": array of { "type": "architecture" | "pattern" | "constraint" | "decision" | "user-preference", "content": string, "context"?: string }
- "summary": string

Be concise. Extract durable knowledge that applies beyond the current interaction.`

export const Plan = Schema.Struct({
  intent: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String, relevance: Schema.String })),
  risks: Schema.Array(Schema.Struct({ description: Schema.String, severity: Schema.String })),
  approach: Schema.Array(Schema.Struct({ step: Schema.Number, description: Schema.String })),
  missingContext: Schema.Array(Schema.String).pipe(Schema.optional),
})
export type Plan = typeof Plan.Type

export const Verification = Schema.Struct({
  passed: Schema.Boolean,
  issues: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      description: Schema.String,
      file: Schema.String.pipe(Schema.optional),
      severity: Schema.String,
    }),
  ),
  summary: Schema.String,
  suggestions: Schema.Array(Schema.String).pipe(Schema.optional),
})
export type Verification = typeof Verification.Type

export const Reflection = Schema.Struct({
  insights: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      content: Schema.String,
      context: Schema.String.pipe(Schema.optional),
    }),
  ),
  summary: Schema.String,
})
export type Reflection = typeof Reflection.Type

export interface Interface {
  readonly plan: (input: {
    readonly sessionID: SessionSchema.ID
    readonly userMessage: string
    readonly context: ReadonlyArray<Record<string, unknown>>
    readonly predictedFiles?: ReadonlyArray<{ filePath: string; reason: string }>
  }) => Effect.Effect<Plan | undefined>
  readonly verify: (input: {
    readonly sessionID: SessionSchema.ID
    readonly finishReason: string
    readonly changes: ReadonlyArray<string>
    readonly errors: ReadonlyArray<string>
    readonly dependencies?: ReadonlyArray<{ name: string; kind: string; usageCount: number }>
  }) => Effect.Effect<Verification | undefined>
  readonly reflect: (input: {
    readonly sessionID: SessionSchema.ID
    readonly steps: number
    readonly finishedSuccessfully: boolean
    readonly errors: ReadonlyArray<string>
    readonly changedFiles: ReadonlyArray<string>
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/MetaCognition") {}

const callFastLLM = Effect.fn("MetaCognition.fastLLM")(function* (
  model: Model,
  system: string,
  context: ReadonlyArray<{ role: string; content: string }>,
  llm: LLMClientShape,
) {
  const request = LLM.request({
    model,
    system: SystemPart.make(system),
    messages: context.map((m) => (m.role === "user" ? Message.user(m.content) : Message.assistant(m.content))),
    generation: { maxTokens: 1024, temperature: 0 },
  })
  const response = yield* LLMClient.generate(request).pipe(Effect.timeout("10 seconds"))
  if (!response) return
  const last = response.message
  if (last.role !== "assistant") return
  return last.content
    .filter((c): c is LLMTextPart => c.type === "text")
    .map((c) => c.text)
    .join("")
})

const parseJson = <A>(text: string, decoder: (value: unknown) => A): A | undefined => {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1) return
  try {
    return decoder(JSON.parse(text.slice(start, end + 1)))
  } catch {
    return
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const catalog = yield* Catalog.Service
    const knowledge = yield* SessionKnowledge.Service
    const depTracker = yield* DependencyTracker.Service
    const llm = yield* LLMClient.Service

    const resolveModel = (): Effect.Effect<Model | undefined> =>
      Effect.gen(function* () {
        const all = yield* catalog.model.available()
        const selected = yield* catalog.model.default().pipe(
          Effect.map((m) => (m && SessionRunnerModel.supported(m) ? m : undefined)),
        )
        const best: ModelV2.Info | undefined = selected ?? all.find(SessionRunnerModel.supported)
        if (!best) return
        return yield* SessionRunnerModel.fromCatalogModel(best).pipe(
          Effect.catch(() => Effect.succeed(undefined as Model | undefined)),
        )
      })

    const runPlan = (input: Parameters<Interface["plan"]>[0]): ReturnType<Interface["plan"]> =>
      Effect.gen(function* () {
        const model = yield* resolveModel()
        if (!model) return
        const history: ReadonlyArray<{ role: string; content: string }> = input.context.map((m) => {
          const msg = m as Record<string, unknown>
          if (msg.type === "user" || msg.type === "synthetic")
            return { role: "user" as const, content: typeof msg.text === "string" ? msg.text : "" }
          if (msg.type === "assistant") {
            const content = (msg.content as ReadonlyArray<Record<string, unknown>>) ?? []
            const text = content
              .filter((c): c is Record<string, unknown> => c.type === "text")
              .map((c) => (typeof c.text === "string" ? c.text : ""))
              .join("\n")
            return { role: "assistant" as const, content: `[assistant attempt]\n${text}` }
          }
          return { role: "user" as const, content: "[internal update]" }
        })
        const predictionsNote = input.predictedFiles && input.predictedFiles.length > 0
          ? `\n\nLikely relevant files:\n${input.predictedFiles.map((p) => `  - ${p.filePath} (${p.reason})`).join("\n")}`
          : ""
        const text = yield* callFastLLM(model, PLANNER_PROMPT, [
          ...history.slice(-5),
          { role: "user", content: `Analyze this request:${predictionsNote}\n\n${input.userMessage}` },
        ], llm)
        if (!text) return
        const plan = parseJson(text, Schema.decodeUnknownSync(Plan))
        if (!plan) return
        yield* events.publish(SessionEvent.Cognition.Planned, {
          sessionID: input.sessionID as any,
          timestamp: yield* DateTime.now,
          intent: plan.intent,
          files: plan.files.map((f) => f.path),
          risks: plan.risks.map((r) => r.description),
          approach: plan.approach.map((a) => `${a.step}: ${a.description}`).join(" | "),
        })
        return plan
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))

    const runVerify = (input: Parameters<Interface["verify"]>[0]): ReturnType<Interface["verify"]> =>
      Effect.gen(function* () {
        if (input.changes.length === 0 && input.errors.length === 0) return
        const model = yield* resolveModel()
        if (!model) return
        const extNames = input.changes
          .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
          .map((f) => ({ name: f.replace(/.*[/\\]/, "").replace(/\.[^.]+$/, ""), kind: "export" }))
        const deps = extNames.length > 0
          ? yield* depTracker.findUsages({
              directory: process.cwd(),
              names: extNames.slice(0, 5),
            }).pipe(Effect.catch(() => Effect.succeed([])))
          : []
        const depsNote = deps.length > 0
          ? `\n\nDependencies affected:\n${deps.map(
              (d) => `  - ${d.name} (${d.kind}, ${d.callers.length + d.testFiles.length} usages)`,
            ).join("\n")}`
          : ""
        const text = yield* callFastLLM(model, VERIFIER_PROMPT, [
          {
            role: "user",
            content: [
              "Review the results of the last coding step.",
              ...(input.changes.length > 0 ? [`\nChanges:\n${input.changes.join("\n")}`] : []),
              ...(input.errors.length > 0 ? [`\nErrors:\n${input.errors.join("\n")}`] : []),
              depsNote,
              `\nFinish reason: ${input.finishReason}`,
              "\nDid this step succeed? Identify any issues.",
            ].join(""),
          },
        ], llm)
        if (!text) return
        const verification = parseJson(text, Schema.decodeUnknownSync(Verification))
        if (!verification) return
        yield* events.publish(SessionEvent.Cognition.Verified, {
          sessionID: input.sessionID as any,
          timestamp: yield* DateTime.now,
          passed: verification.passed,
          issues: verification.issues,
          summary: verification.summary,
        })
        return verification
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))

    const runReflect = (input: Parameters<Interface["reflect"]>[0]): ReturnType<Interface["reflect"]> =>
      Effect.gen(function* () {
        if (input.steps === 0) return
        const model = yield* resolveModel()
        if (!model) return
        const text = yield* callFastLLM(model, REFLECTOR_PROMPT, [
          {
            role: "user",
            content: [
              `The agent completed ${input.steps} step(s).`,
              `Finished successfully: ${input.finishedSuccessfully}`,
              ...(input.errors.length > 0 ? [`\nErrors: ${input.errors.join("; ")}`] : []),
              ...(input.changedFiles.length > 0 ? [`\nFiles changed: ${input.changedFiles.join(", ")}`] : []),
              "\nWhat insights should the agent remember for future work?",
            ].join(""),
          },
        ], llm)
        if (!text) return
        const reflection = parseJson(text, Schema.decodeUnknownSync(Reflection))
        if (!reflection) return
        yield* events.publish(SessionEvent.Cognition.Reflected, {
          sessionID: input.sessionID as any,
          timestamp: yield* DateTime.now,
          insights: reflection.insights,
          summary: reflection.summary,
        })
        for (const insight of reflection.insights) {
          yield* knowledge.record({
            sessionID: input.sessionID,
            type: insight.type as any,
            content: insight.content,
            context: insight.context ?? input.changedFiles.slice(0, 3).join(", "),
          }).pipe(Effect.catch(() => Effect.void))
        }
      }).pipe(Effect.catch(() => Effect.void))

    return Service.of({
      plan: runPlan,
      verify: runVerify,
      reflect: runReflect,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [EventV2.node, Catalog.node, SessionRunnerModel.node, llmClient, SessionKnowledge.node, DependencyTracker.node],
})
