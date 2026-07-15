export * as AutoDebug from "./auto-debug"

import { LLM, LLMClient, Message, Model, SystemPart, type LLMClientShape, type TextPart as LLMTextPart } from "@opencode-ai/llm"
import { Context, Effect, Layer, Schema } from "effect"
import { Catalog } from "../../catalog"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { SessionRunnerModel } from "./model"

const ANALYSIS_PROMPT = `You are a debugging assistant. Analyze the error and suggest a fix.

Output a JSON object with these fields:
- "rootCause": string — what caused the error
- "relevantFile": string — the file most likely responsible (or "")
- "suggestedFix": string — what change would fix the issue (or "")
- "confidence": "low" | "medium" | "high"

Be concise and specific. Only suggest a fix if confident.`

export const DebugAnalysis = Schema.Struct({
  rootCause: Schema.String,
  relevantFile: Schema.String,
  suggestedFix: Schema.String,
  confidence: Schema.Literals(["low", "medium", "high"]),
})
export type DebugAnalysis = typeof DebugAnalysis.Type

export interface Interface {
  readonly analyze: (input: {
    readonly sessionID: string
    readonly toolName: string
    readonly toolInput: Record<string, unknown>
    readonly errorMessage: string
    readonly errorOutput: string
  }) => Effect.Effect<DebugAnalysis | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AutoDebug") {}

const callLLM = (model: Model, system: string, context: string, llm: LLMClientShape) =>
  Effect.gen(function* () {
    const request = LLM.request({
      model,
      system: SystemPart.make(system),
      messages: [Message.user(context)],
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

const parseJson = (text: string): DebugAnalysis | undefined => {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1) return
  try {
    return Schema.decodeUnknownSync(DebugAnalysis)(JSON.parse(text.slice(start, end + 1))) as DebugAnalysis
  } catch {
    return
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const llm = yield* LLMClient.Service
    const catalog = yield* Catalog.Service

    const resolveModel = (): Effect.Effect<Model | undefined> =>
      Effect.gen(function* () {
        const all = yield* catalog.model.available()
        const best = all.find((m: any) =>
          m.api?.type === "aisdk" &&
          (m.api.package === "@ai-sdk/openai" || m.api.package === "@ai-sdk/anthropic"),
        ) ?? all[0]
        if (!best) return
        return yield* SessionRunnerModel.fromCatalogModel(best).pipe(
          Effect.catch(() => Effect.succeed(undefined as Model | undefined)),
        )
      })

    const runAnalyze = (input: Parameters<Interface["analyze"]>[0]): ReturnType<Interface["analyze"]> =>
      Effect.gen(function* () {
        const model = yield* resolveModel()
        if (!model) return
        const text = yield* callLLM(
          model,
          ANALYSIS_PROMPT,
          [
            `Tool: ${input.toolName}`,
            `Input: ${JSON.stringify(input.toolInput)}`,
            `Error: ${input.errorMessage}`,
            `Output: ${input.errorOutput.slice(0, 2000)}`,
            "\nAnalyze this error, find the root cause, and suggest a fix.",
          ].join("\n"),
          llm,
        )
        if (!text) return
        return parseJson(text)
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))

    return Service.of({ analyze: runAnalyze })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [llmClient, SessionRunnerModel.node, Catalog.node],
})
