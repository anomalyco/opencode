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
const MetaCacheControl = Schema.Struct({
  type: Schema.tag("ephemeral"),
  ttl: Schema.optional(Schema.Literal("5m")),
})
const FunctionTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  input_schema: JsonObject,
  cache_control: Schema.optional(MetaCacheControl),
})
const Body = Schema.Struct({
  ...AnthropicMessages.AnthropicMessagesBody.fields,
  tools: optionalArray(Schema.Union([FunctionTool, WebSearch])),
})

const fromRequest = Effect.fn("MetaMessages.fromRequest")(function* (request: LLMRequest) {
  const projected = ProviderShared.flattenToolRequest(request)
  const body = yield* AnthropicMessages.protocol.body.from(projected.request)
  if (hasOneHourCacheControl(body))
    return yield* ProviderShared.invalidRequest("Meta Messages does not support 1h cache TTL")
  return {
    ...body,
    tools:
      body.tools === undefined
        ? undefined
        : yield* Effect.forEach(body.tools, (tool, index) =>
            Effect.gen(function* () {
              const native = projected.tools[index]?.native
              if (native === undefined)
                return {
                  ...tool,
                  cache_control: tool.cache_control && {
                    type: tool.cache_control.type,
                    ...(tool.cache_control.ttl === "5m" ? { ttl: "5m" as const } : {}),
                  },
                }
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

const hasOneHourCacheControl = (body: AnthropicMessages.AnthropicMessagesBody) =>
  body.cache_control?.ttl === "1h" ||
  body.system?.some((part) => part.cache_control?.ttl === "1h") ||
  body.tools?.some((tool) => tool.cache_control?.ttl === "1h") ||
  body.messages.some((message) =>
    message.content.some(
      (part) =>
        ("cache_control" in part && part.cache_control?.ttl === "1h") ||
        (part.type === "tool_result" &&
          Array.isArray(part.content) &&
          part.content.some((content) => content.cache_control?.ttl === "1h")),
    ),
  )

export const protocol = Protocol.make({
  id: "meta-messages",
  body: { schema: Body, from: fromRequest },
  stream: AnthropicMessages.protocol.stream,
})

export * as MetaMessages from "./meta-messages.js"
