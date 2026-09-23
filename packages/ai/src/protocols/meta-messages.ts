import { Effect, Schema } from "effect"
import { Protocol } from "../route/protocol.js"
import type { LLMRequest } from "../schema/index.js"
import { AnthropicMessages } from "./anthropic-messages.js"
import { MetaResponses } from "./meta-responses.js"
import { JsonObject, optionalArray, ProviderShared } from "./shared.js"

const WebSearch = Schema.Struct({
  type: Schema.Literal("web_search"),
  name: Schema.Literal("web_search"),
  user_location: MetaResponses.WebSearch.fields.user_location,
})
const Body = Schema.Struct({
  ...AnthropicMessages.AnthropicMessagesBody.fields,
  tools: optionalArray(
    Schema.Union([
      Schema.Struct({ name: Schema.String, description: Schema.String, input_schema: JsonObject }),
      WebSearch,
    ]),
  ),
})

const fromRequest = Effect.fn("MetaMessages.fromRequest")(function* (request: LLMRequest) {
  const projected = ProviderShared.flattenToolRequest(request)
  const body = yield* AnthropicMessages.protocol.body.from(projected.request)
  return {
    ...body,
    tools:
      body.tools === undefined
        ? undefined
        : yield* Effect.forEach(body.tools, (tool, index) =>
            Effect.gen(function* () {
              const native = projected.tools[index]?.native
              if (native === undefined) return tool
              const search = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(MetaResponses.WebSearch))(
                native.meta,
              )
              if (search.search_context_size !== undefined)
                return yield* ProviderShared.invalidRequest("Meta Messages does not support searchContextSize")
              return { type: "web_search" as const, name: "web_search" as const, user_location: search.user_location }
            }),
          ),
  }
})

export const protocol = Protocol.make({
  id: "meta-messages",
  body: { schema: Body, from: fromRequest },
  stream: AnthropicMessages.protocol.stream,
})

export * as MetaMessages from "./meta-messages.js"
