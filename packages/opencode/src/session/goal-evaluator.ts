export * as GoalEvaluator from "./goal-evaluator"

import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LLM } from "./llm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LLMEvent } from "@opencode-ai/llm"
import * as Stream from "effect/Stream"

export const EvaluationResult = Schema.Struct({
  met: Schema.Boolean.annotate({ description: "Whether the goal condition is met" }),
  reason: Schema.String.annotate({ description: "Short reason for the decision" }),
}).annotate({ identifier: "GoalEvaluator.Result" })
export type EvaluationResult = typeof EvaluationResult.Type

export interface Interface {
  readonly evaluate: (input: {
    readonly condition: string
    readonly messages: ReadonlyArray<SessionV1.WithParts>
    readonly evaluatorModel?: { providerID: string; modelID: string }
    readonly defaultProviderID: ProviderV2.ID
    readonly defaultModelID: ModelV2.ID
  }) => Effect.Effect<EvaluationResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GoalEvaluator") {}

const EVALUATION_PROMPT = `You are an objective evaluator. Your task is to determine if a goal condition has been met based on the conversation transcript.

RULES:
1. Only judge based on what is explicitly shown in the transcript
2. Do NOT assume or infer outcomes not demonstrated
3. If the transcript shows the condition is satisfied, return met: true
4. If the transcript does NOT demonstrate the condition is met, return met: false
5. Be strict - the condition must be clearly demonstrated, not just attempted

RESPOND WITH EXACTLY THIS FORMAT (no other text):
{"met": true/false, "reason": "brief explanation"}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const llm = yield* LLM.Service

    const evaluate = Effect.fn("GoalEvaluator.evaluate")(function* (input: {
      readonly condition: string
      readonly messages: ReadonlyArray<SessionV1.WithParts>
      readonly evaluatorModel?: { providerID: string; modelID: string }
      readonly defaultProviderID: ProviderV2.ID
      readonly defaultModelID: ModelV2.ID
    }) {
      const modelID = input.evaluatorModel
        ? ModelV2.ID.make(input.evaluatorModel.modelID)
        : input.defaultModelID
      const providerID = input.evaluatorModel
        ? ProviderV2.ID.make(input.evaluatorModel.providerID)
        : input.defaultProviderID

      const transcript = input.messages
        .map((msg) => {
          const role = msg.info.role === "user" ? "User" : "Assistant"
          const textParts = msg.parts
            .filter((p): p is SessionV1.TextPart => p.type === "text" && !p.synthetic)
            .map((p) => p.text)
          const toolParts = msg.parts
            .filter((p): p is SessionV1.ToolPart => p.type === "tool")
            .map((p) => {
              if (p.state.status === "completed" && p.state.output) {
                return `[Tool: ${p.tool}] ${p.state.output}`
              }
              if (p.state.status === "running") {
                return `[Tool: ${p.tool}] Running...`
              }
              return `[Tool: ${p.tool}] ${p.state.status}`
            })
          return `${role}: ${[...textParts, ...toolParts].join("\n")}`
        })
        .join("\n\n")

      const userMessage = `Goal condition: ${input.condition}

Conversation transcript:
${transcript}

Has the goal condition been met? Respond with JSON only.`

      const result = yield* llm
        .stream({
          agent: { name: "goal-evaluator", permission: [] },
          user: { role: "user", content: userMessage } as any,
          system: [{ role: "system", content: EVALUATION_PROMPT }],
          small: true,
          tools: {},
          model: { providerID, modelID },
          sessionID: "goal-evaluation",
          retries: 1,
          messages: [{ role: "user", content: userMessage }],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )

      const cleaned = result.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return { met: false, reason: "Failed to parse evaluator response" }
      }

      try {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          met: parsed.met === true,
          reason: typeof parsed.reason === "string" ? parsed.reason : "No reason provided",
        }
      } catch {
        return { met: false, reason: "Invalid JSON in evaluator response" }
      }
    })

    return Service.of({ evaluate })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(LLM.defaultLayer))

export const node = LayerNode.make(layer, [LLM.node])
