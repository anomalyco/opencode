import { Effect, Schema } from "effect"
import { Api } from "../api.js"
import { Capabilities } from "../capabilities.js"
import { Framing } from "../route/framing.js"
import { Protocol } from "../route/protocol.js"
import { AnthropicMessages } from "./anthropic-messages.js"
import { ProviderShared } from "./shared.js"
import { OpenResponsesOptions } from "./utils/open-responses-options.js"

const Options = Schema.Struct({
  effort: Schema.optional(OpenResponsesOptions.ReasoningEffort),
  thinking: Schema.optional(
    Schema.Struct({
      type: ProviderShared.knownString<"enabled" | "disabled">(),
      budgetTokens: Schema.optional(Schema.Int),
      budget_tokens: Schema.optional(Schema.Int),
    }),
  ),
})
export type OptionsInput = typeof Options.Type & Pick<AnthropicMessages.OptionsInput, "outputConfig">
const protocol = Protocol.make({
  id: "alibaba-messages",
  body: {
    schema: Schema.Struct({
      ...AnthropicMessages.AnthropicMessagesBody.fields,
      thinking: Schema.optional(Schema.Struct({ type: Schema.String, budget_tokens: Schema.optional(Schema.Int) })),
    }),
    from: Effect.fn("AlibabaMessages.fromRequest")(function* (req) {
      const opts = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(req.providerOptions ?? {})
      // Model Studio accepts enabled thinking without Anthropic's mandatory token budget.
      const body = yield* AnthropicMessages.protocol.body.from({
        ...req,
        providerOptions: { ...req.providerOptions, thinking: undefined },
      })
      const budget = opts.thinking?.budgetTokens ?? opts.thinking?.budget_tokens
      return {
        ...body,
        thinking:
          opts.thinking === undefined
            ? undefined
            : {
                type: opts.thinking.type,
                budget_tokens:
                  budget === undefined ? undefined : ProviderShared.fitThinkingBudget(budget, body.max_tokens),
              },
      }
    }),
  },
  stream: AnthropicMessages.protocol.stream,
  supportsEffortUpdates: AnthropicMessages.protocol.supportsEffortUpdates,
  toolUpdates: AnthropicMessages.protocol.toolUpdates,
})

/** Model Studio's Messages dialect. */
export const api = Api.make({
  name: "messages",
  id: "alibaba-messages",
  protocol,
  path: AnthropicMessages.PATH,
  framing: Framing.sse,
  headers: () => ({ "anthropic-version": "2023-06-01" }),
  capabilities: Capabilities.defaults<Capabilities.Messages>({ cache: { markers: true } }),
})

export * as AlibabaMessages from "./alibaba-messages.js"
