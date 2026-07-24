import type { ProviderOptions } from "../schema"

export type AnthropicThinkingInput =
  | {
      readonly type: "adaptive"
      readonly display?: "summarized" | "omitted"
    }
  | {
      readonly type: "disabled"
    }
  | ({ readonly type: "enabled" } & (
      | { readonly budgetTokens: number; readonly budget_tokens?: number }
      | { readonly budgetTokens?: number; readonly budget_tokens: number }
    ))

export interface AnthropicOptionsInput {
  readonly [key: string]: unknown
  readonly thinking?: AnthropicThinkingInput
  readonly effort?: string
}

export type AnthropicProviderOptionsInput = ProviderOptions & {
  readonly anthropic?: AnthropicOptionsInput
}

export * as AnthropicProviderOptions from "./anthropic-options"
