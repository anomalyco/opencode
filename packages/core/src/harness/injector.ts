export * as HarnessInjector from "./injector"

import { Context, Effect, Layer, Schema } from "effect"
import { LLM, LLMError } from "@opencode-ai/llm"
import { HarnessVersion } from "./version"
import { makeLocationNode } from "../effect/app-node"

import type { Hooks } from "@opencode-ai/plugin"
import { HarnessPlugin } from "./plugin"

export const InjectedPromptResult = Schema.Struct({
  finalSystemPrompt: Schema.String,
  appliedRules: Schema.Array(Schema.String),
  activeVersionID: Schema.optional(Schema.String),
}).annotate({ identifier: "HarnessInjector.InjectedPromptResult" })

export type InjectedPromptResult = typeof InjectedPromptResult.Type

export const RefinedSubtaskPromptResult = Schema.Struct({
  subtaskContent: Schema.String,
  originalPrompt: Schema.String,
  refinedPrompt: Schema.String,
  refinementReasoning: Schema.String,
}).annotate({ identifier: "HarnessInjector.RefinedSubtaskPromptResult" })

export type RefinedSubtaskPromptResult = typeof RefinedSubtaskPromptResult.Type

export const RefineSubtaskInput = Schema.Struct({
  subtaskContent: Schema.String,
  originalPrompt: Schema.String,
  userFeedback: Schema.optional(Schema.String),
  changesRequested: Schema.optional(Schema.String),
}).annotate({ identifier: "HarnessInjector.RefineSubtaskInput" })

export type RefineSubtaskInput = typeof RefineSubtaskInput.Type

export interface Interface {
  readonly injectPrompt: (baseSystemPrompt: string, domainCategory: string) => Effect.Effect<InjectedPromptResult>
  readonly createPluginHooks: (domainCategory: string) => Effect.Effect<Hooks>
  readonly refineSubtaskPrompt: (input: RefineSubtaskInput, model: unknown) => Effect.Effect<RefinedSubtaskPromptResult, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/HarnessInjector") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const versionSvc = yield* HarnessVersion.Service
    const pluginSvc = yield* HarnessPlugin.Service

    const createPluginHooks = Effect.fn("HarnessInjector.createPluginHooks")(function* (domainCategory: string) {
      return yield* pluginSvc.createHooks(domainCategory)
    })

    // 1. Initial Prompt Injection (starts with base prompts from repo + active domain rules)
    const injectPrompt = Effect.fn("HarnessInjector.injectPrompt")(function* (baseSystemPrompt: string, domainCategory: string) {
      const activeVer = yield* versionSvc.getActiveVersion(domainCategory).pipe(Effect.orElseSucceed(() => null))

      if (!activeVer) {
        return {
          finalSystemPrompt: baseSystemPrompt,
          appliedRules: [],
          activeVersionID: undefined,
        }
      }

      const extracted = Array.isArray(activeVer.extractedRules)
        ? activeVer.extractedRules.filter((r): r is string => typeof r === "string")
        : []
      const rulesList = extracted.map((r) => `- ${r}`).join("\n")

      const injectedSection = `
\n\n=== EVOLVED HARNESS STRATEGY & RULES (${domainCategory.toUpperCase()}) ===
${activeVer.systemPrompt}

EXTRACTED LESSONS & GUIDELINES:
${rulesList || "- Adhere to project guidelines."}
=================================================
      `.trim()

      const finalSystemPrompt = `${baseSystemPrompt}\n\n${injectedSection}`

      return {
        finalSystemPrompt,
        appliedRules: extracted,
        activeVersionID: activeVer.versionID,
      }
    })

    // 2. Refine Subtask Prompt on Failure / Unsatisfactory User Feedback
    const refineSubtaskPrompt = Effect.fn("HarnessInjector.refineSubtaskPrompt")(function* (
      input: RefineSubtaskInput,
      model: unknown,
    ) {
      const res = yield* LLM.generateObject({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        model: model as Parameters<typeof LLM.generateObject>[0]["model"],
        system: "You are a Subtask Prompt Refinement Specialist. Analyze a failed subtask, the original prompt used, and the user's requested changes to generate a modified, improved subtask prompt.",
        prompt: `
Subtask: ${input.subtaskContent}
Original Prompt Used: ${input.originalPrompt}
User Feedback: ${input.userFeedback ?? "Subtask failed or needs adjustment."}
Requested Changes: ${input.changesRequested ?? "Improve accuracy and fulfill requirements."}
        `.trim(),
        schema: RefinedSubtaskPromptResult,
        generation: { temperature: 0 },
      })

      return res.object
    })

    return Service.of({ injectPrompt, createPluginHooks, refineSubtaskPrompt })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [HarnessVersion.node, HarnessPlugin.node] })
