import { Effect, Schema } from "effect"
import { Protocol } from "../route/protocol.js"
import { LLMEvent, LLMRequest } from "../schema/index.js"
import type { AlibabaChat } from "./alibaba-chat.js"
import { AnthropicMessages } from "./anthropic-messages.js"
import { ProviderShared } from "./shared.js"

export type OptionsInput = {
  readonly effort?: AlibabaChat.ReasoningEffort
  readonly thinking?: {
    readonly type: "enabled" | "disabled" | (string & {})
    readonly budgetTokens?: number
    readonly budget_tokens?: number
  }
  readonly outputConfig?: AnthropicMessages.OptionsInput["outputConfig"]
}

const Options = Schema.Struct({
  effort: Schema.optional(Schema.String),
  thinking: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      budgetTokens: Schema.optional(Schema.Int),
      budget_tokens: Schema.optional(Schema.Int),
    }),
  ),
})
export const protocol = Protocol.make({
  id: "alibaba-messages",
  body: {
    schema: Schema.Struct({
      ...AnthropicMessages.AnthropicMessagesBody.fields,
      thinking: Schema.optional(Schema.Struct({ type: Schema.String, budget_tokens: Schema.optional(Schema.Int) })),
    }),
    from: Effect.fn("AlibabaMessages.fromRequest")(function* (req) {
      const opts = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(req.providerOptions ?? {})
      // Model Studio accepts enabled thinking without Anthropic's mandatory token budget.
      return {
        ...(yield* AnthropicMessages.protocol.body.from(
          LLMRequest.update(req, {
            providerOptions: { ...req.providerOptions, thinking: undefined },
          }),
        )),
        thinking:
          opts.thinking === undefined
            ? undefined
            : {
                type: opts.thinking.type,
                budget_tokens: opts.thinking.budgetTokens ?? opts.thinking.budget_tokens,
              },
      }
    }),
  },
  stream: {
    event: AnthropicMessages.protocol.stream.event,
    initial: (req) => ({ base: AnthropicMessages.protocol.stream.initial(req), called: false }),
    step: (state, event) =>
      Effect.gen(function* () {
        const next = yield* AnthropicMessages.protocol.stream.step(state.base, event)
        const called = state.called || next[1].some((item) => LLMEvent.is.toolCall(item) && !item.providerExecuted)
        return [
          { base: next[0], called },
          next[1].map((item) => {
            // Model Studio sometimes reports end_turn after a forced tool_use block.
            if (
              !called ||
              (!LLMEvent.is.finish(item) && !LLMEvent.is.stepFinish(item)) ||
              item.reason.raw !== "end_turn"
            )
              return item
            return { ...item, reason: { ...item.reason, normalized: "tool-calls" as const } }
          }),
        ] as const
      }),
  },
})

export * as AlibabaMessages from "./alibaba-messages.js"
