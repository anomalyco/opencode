import { Effect, Schema } from "effect"
import { Adapter, type AdapterModelInput } from "../adapter"
import { Endpoint } from "../endpoint"
import { Framing } from "../framing"
import { capabilities } from "../llm"
import { payload as payloadPatch } from "../patch"
import { Protocol } from "../protocol"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAIChat from "../protocols/openai-chat"
import { isRecord } from "../protocols/shared"

export const profile = OpenAICompatibleProfiles.profiles.openrouter
const ADAPTER = "openrouter"

export interface OpenRouterOptions {
  readonly usage?: boolean | Record<string, unknown>
  readonly reasoning?: Record<string, unknown>
  readonly promptCacheKey?: string
}

export type ModelOptions = Omit<AdapterModelInput, "id"> & OpenRouterOptions

const OpenRouterPayload = Schema.StructWithRest(Schema.Struct(OpenAIChat.payloadFields), [
  Schema.Record(Schema.String, Schema.Any),
])
export type OpenRouterPayload = Schema.Schema.Type<typeof OpenRouterPayload>

export const protocol = Protocol.define({
  ...OpenAIChat.protocol,
  id: "openrouter-chat",
  payload: OpenRouterPayload,
  toPayload: (request) => OpenAIChat.protocol.toPayload(request).pipe(
    Effect.map((payload) => payload as OpenRouterPayload),
  ),
})

const payloadOptions = (input: unknown) => {
  const openrouter = isRecord(input) ? input : {}
  return {
    ...(openrouter.usage === true ? { usage: { include: true } } : isRecord(openrouter.usage) ? { usage: openrouter.usage } : {}),
    ...(isRecord(openrouter.reasoning) ? { reasoning: openrouter.reasoning } : {}),
    ...(typeof openrouter.promptCacheKey === "string" ? { prompt_cache_key: openrouter.promptCacheKey } : {}),
    ...(typeof openrouter.prompt_cache_key === "string" ? { prompt_cache_key: openrouter.prompt_cache_key } : {}),
  }
}

const nativeOptions = (options: ModelOptions) => {
  const openrouter = payloadOptions({
    ...(isRecord(options.native?.openrouter) ? options.native.openrouter : {}),
    usage: options.usage,
    reasoning: options.reasoning,
    promptCacheKey: options.promptCacheKey,
  })
  if (Object.keys(openrouter).length === 0) return options.native
  return { ...options.native, openrouter }
}

export const applyOptions = payloadPatch<OpenRouterPayload>("openrouter.options", {
  reason: "apply OpenRouter provider options to the Chat payload",
  when: (context) => context.model.provider === profile.provider && Object.keys(payloadOptions(context.model.native?.openrouter)).length > 0,
  apply: (payload, context) => {
    const options = payloadOptions(context.model.native?.openrouter)
    if (Object.keys(options).length === 0) return payload
    return { ...payload, ...options }
  },
})

export const adapter = Adapter.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.baseURL({ default: profile.baseURL, path: "/chat/completions" }),
  framing: Framing.sse,
  patches: [applyOptions],
})

export const adapters = [adapter]

const modelRef = Adapter.model<AdapterModelInput>(adapter, {
  provider: profile.provider,
  baseURL: profile.baseURL,
  capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
})

export const model = (id: string, options: ModelOptions = {}) =>
  modelRef({ ...options, id, native: nativeOptions(options) })
