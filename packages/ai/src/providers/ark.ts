/**
 * Ark — Volcengine Ark Chat API provider.
 *
 * Shared by three provider IDs that all target the same Ark API surface:
 *   - `volcengine`              (pay-as-you-go, ark.cn-beijing.volces.com/api/v3)
 *   - `volcengine-coding-plan`  (subscription tier, ark.cn-beijing.volces.com/api/coding/v3)
 *   - `byteplus`                (overseas, ark.ap-southeast.bytepluses.com/api/v3)
 *
 * The Ark API is OpenAI Chat Completions–compatible with two extensions:
 *   1. `thinking: { type: "enabled" | "disabled" }` — a toggle for deep
 *      reasoning, used instead of the OpenAI `reasoning_effort` level.
 *      `auto` is documented but rejected by every model except
 *      doubao-seed-1-6-flash, so it is never sent.
 *   2. `reasoning_content` in the streaming response — the field that
 *      carries the reasoning trace (set via `compatibility.reasoningField`).
 *
 * The base URL below is only a fallback: the model catalog's `api.base_url`
 * names the endpoint of each provider (and each coding-plan tier), and the
 * catalog value wins over this one.
 */
import { Effect, Schema } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { ProviderShared } from "../protocols/shared.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { Route } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Protocol } from "../route/protocol.js"
import { ProviderID, type LLMRequest, type ModelID, type RequestOptions } from "../schema/index.js"
import { bearerRouteDefaults, toConfig } from "./settings.js"

export const id = ProviderID.make("ark")

const baseURL = "https://ark.cn-beijing.volces.com/api/v3"

export type ChatOptionsInput = {
  /** Ark's deep-reasoning switch. Omitted leaves the model's own default. */
  readonly thinking?: { readonly type: "enabled" | "disabled" | (string & {}) }
  readonly reasoningEffort?: string
}

export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    /** Overrides the selected API's base URL, including its version prefix. */
    readonly baseURL?: string
    readonly providerOptions?: ChatOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  ChatOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

const ChatOptions = Schema.Struct({
  thinking: Schema.optional(Schema.Struct({ type: Schema.String })),
  reasoningEffort: Schema.optional(Schema.String),
})

const chatProtocol = Protocol.make({
  id: "ark-chat",
  body: {
    schema: Schema.Struct({ ...OpenAIChat.bodyFields, thinking: ChatOptions.fields.thinking }),
    from: Effect.fn("Ark.chatFromRequest")(function* (request: LLMRequest) {
      const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(ChatOptions))(
        request.providerOptions ?? {},
      )
      return { ...(yield* OpenAIChat.protocol.body.from(request)), thinking: options.thinking }
    }),
  },
  stream: OpenAIChat.protocol.stream,
})

export const route = Route.make({
  id: "ark-chat",
  provider: id,
  providerMetadataKey: "ark",
  protocol: chatProtocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

export const routes = [route]

export const configure = (input: Config = {}) => {
  const configured = route.with(
    bearerRouteDefaults(input, ["ARK_API_KEY", "BYTEPLUS_API_KEY", "ARK_CODING_PLAN_API_KEY"], baseURL),
  )
  const chat = (modelID: string | ModelID) =>
    configured.model<ChatOptionsInput>({
      id: modelID,
      compatibility: {
        reasoningField: "reasoning_content",
        maxTokensField: "max_tokens",
      },
      capabilities: { tools: { strict: false }, promptCacheKey: true },
    })
  return { id, model: chat, chat, configure }
}

export const provider = configure()

export const model: ProviderPackage.Model<Settings, ChatOptionsInput> = (modelID, settings) =>
  configure(toConfig(settings)).model(modelID)

export const chat = provider.chat

export * as Ark from "./ark.js"
