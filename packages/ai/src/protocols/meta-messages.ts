import { Effect, Schema } from "effect"
import { Api } from "../api.js"
import { Capabilities } from "../capabilities.js"
import { Protocol } from "../route/protocol.js"
import { CacheTTL, type LLMRequest } from "../schema/index.js"
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
  ttl: Schema.optional(CacheTTL),
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
  const body = yield* AnthropicMessages.protocol.body.from(request)
  const definitions = ProviderShared.flattenTools(request.tools)
  return {
    ...body,
    messages: body.messages.map((message) => {
      if (message.role !== "user") return message
      const videos: Array<(typeof message.content)[number]> = []
      const content = message.content.map((block) => {
        if (block.type !== "tool_result" || typeof block.content === "string") return block
        videos.push(...block.content.filter((item) => item.type === "video"))
        return { ...block, content: block.content.filter((item) => item.type !== "video") }
      })
      return videos.length === 0 ? message : { ...message, content: [...content, ...videos] }
    }),
    tools:
      body.tools === undefined
        ? undefined
        : yield* Effect.forEach(body.tools, (tool, index) =>
            Effect.gen(function* () {
              const native = definitions[index]?.native
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

const protocol = Protocol.make({
  id: "meta-messages",
  body: { schema: Body, from: fromRequest },
  stream: AnthropicMessages.protocol.stream,
  supportsEffortUpdates: AnthropicMessages.protocol.supportsEffortUpdates,
  toolUpdates: AnthropicMessages.protocol.toolUpdates,
})

/** Meta's Messages dialect: native web search, and no version header. */
export const api = Api.make({
  name: "messages",
  id: "meta-messages",
  protocol,
  path: AnthropicMessages.PATH,
  framing: AnthropicMessages.framing,
  capabilities: Capabilities.defaults<Capabilities.Messages>({ cache: { markers: true } }),
})

export * as MetaMessages from "./meta-messages.js"
