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
const Body = Schema.Struct({
  ...AnthropicMessages.AnthropicMessagesBody.fields,
  thinking: Schema.optional(Schema.Struct({ type: Schema.String, budget_tokens: Schema.optional(Schema.Int) })),
})

const fromRequest = Effect.fn("AlibabaMessages.fromRequest")(function* (request: LLMRequest) {
  const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(request.providerOptions ?? {})
  // Model Studio accepts enabled thinking without Anthropic's mandatory token budget.
  const body = yield* AnthropicMessages.protocol.body.from(
    LLMRequest.update(request, {
      providerOptions: { ...request.providerOptions, thinking: undefined },
    }),
  )
  return {
    ...body,
    thinking:
      options.thinking === undefined
        ? undefined
        : {
            type: options.thinking.type,
            budget_tokens: options.thinking.budgetTokens ?? options.thinking.budget_tokens,
          },
  }
})

export const protocol = Protocol.make({
  id: "alibaba-messages",
  body: { schema: Body, from: fromRequest },
  stream: {
    event: AnthropicMessages.protocol.stream.event,
    initial: (request) => ({ delegate: AnthropicMessages.protocol.stream.initial(request), hasToolCall: false }),
    step: (state, event) =>
      Effect.gen(function* () {
        const result = yield* AnthropicMessages.protocol.stream.step(state.delegate, event)
        const hasToolCall =
          state.hasToolCall || result[1].some((item) => LLMEvent.is.toolCall(item) && !item.providerExecuted)
        return [
          { delegate: result[0], hasToolCall },
          result[1].map((item) => {
            // Model Studio sometimes reports end_turn after a forced tool_use block.
            if (
              !hasToolCall ||
              (!LLMEvent.is.finish(item) && !LLMEvent.is.stepFinish(item)) ||
              item.reason.raw !== "end_turn"
            )
              return item
            const reason = { ...item.reason, normalized: "tool-calls" as const }
            return LLMEvent.is.finish(item)
              ? LLMEvent.finish({ ...item, reason })
              : LLMEvent.stepFinish({ ...item, reason })
          }),
        ] as const
      }),
  },
})

export * as AlibabaMessages from "./alibaba-messages.js"
