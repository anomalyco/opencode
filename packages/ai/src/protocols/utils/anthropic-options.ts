import { Effect, Schema } from "effect"
import type { LLMRequest } from "../../schema"
import { ProviderShared } from "../shared"

export const ThinkingSchema = Schema.Union([
  Schema.Struct({
    type: Schema.tag("enabled"),
    budget_tokens: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.tag("adaptive"),
    display: Schema.optional(Schema.Literals(["summarized", "omitted"])),
  }),
  Schema.Struct({
    type: Schema.tag("disabled"),
  }),
])
export type Thinking = Schema.Schema.Type<typeof ThinkingSchema>

export interface Resolved {
  readonly thinking?: Thinking
  readonly effort?: string
}

export const resolve = Effect.fn("AnthropicOptions.resolve")(function* (request: LLMRequest) {
  const input = request.providerOptions?.anthropic
  return {
    thinking: yield* resolveThinking(input?.thinking),
    effort: typeof input?.effort === "string" ? input.effort : undefined,
  } satisfies Resolved
})

const resolveThinking = Effect.fn("AnthropicOptions.resolveThinking")(function* (input: unknown) {
  if (!ProviderShared.isRecord(input)) return undefined
  if (input.type === "adaptive") {
    const display =
      input.display === "summarized"
        ? ("summarized" as const)
        : input.display === "omitted"
          ? ("omitted" as const)
          : undefined
    return { type: "adaptive" as const, ...(display === undefined ? {} : { display }) }
  }
  if (input.type === "disabled") return { type: "disabled" as const }
  if (input.type !== "enabled") return undefined
  const budget =
    typeof input.budgetTokens === "number"
      ? input.budgetTokens
      : typeof input.budget_tokens === "number"
        ? input.budget_tokens
        : undefined
  if (budget === undefined)
    return yield* ProviderShared.invalidRequest("Anthropic thinking provider option requires budgetTokens")
  return { type: "enabled" as const, budget_tokens: budget }
})

export * as AnthropicOptions from "./anthropic-options"
