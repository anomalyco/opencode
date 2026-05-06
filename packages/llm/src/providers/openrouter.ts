import { Effect, Schema } from "effect"
import { Adapter, type AdapterModelInput } from "../adapter/client"
import { Endpoint } from "../adapter/endpoint"
import { Framing } from "../adapter/framing"
import { capabilities } from "../llm"
import { Provider } from "../provider"
import { Protocol } from "../adapter/protocol"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAIChat from "../protocols/openai-chat"
import { isRecord } from "../protocols/shared"

export const profile = OpenAICompatibleProfiles.profiles.openrouter
const ADAPTER = "openrouter"

export interface OpenRouterOptions {
  readonly [key: string]: unknown
  readonly usage?: boolean | Record<string, unknown>
  readonly reasoning?: Record<string, unknown>
  readonly promptCacheKey?: string
}

export type OpenRouterProviderOptionsInput = ProviderOptions & {
  readonly openrouter?: OpenRouterOptions
}

export type ModelOptions = Omit<AdapterModelInput, "id" | "providerOptions"> & {
  readonly providerOptions?: OpenRouterProviderOptionsInput
}
type ModelInput = ModelOptions & Pick<AdapterModelInput, "id">

const OpenRouterPayload = Schema.StructWithRest(Schema.Struct(OpenAIChat.payloadFields), [
  Schema.Record(Schema.String, Schema.Any),
])
export type OpenRouterPayload = Schema.Schema.Type<typeof OpenRouterPayload>

export const protocol = Protocol.define({
  ...OpenAIChat.protocol,
  id: "openrouter-chat",
  payload: OpenRouterPayload,
  toPayload: (request) => OpenAIChat.protocol.toPayload(request).pipe(
    Effect.map((payload) => ({
      ...payload,
      ...payloadOptions(request.providerOptions?.openrouter),
    }) as OpenRouterPayload),
  ),
})

const payloadOptions = (input: unknown) => {
  const openrouter = isRecord(input) ? input : {}
  return {
    ...(openrouter.usage === true ? { usage: { include: true } } : isRecord(openrouter.usage) ? { usage: openrouter.usage } : {}),
    ...(isRecord(openrouter.reasoning) ? { reasoning: openrouter.reasoning } : {}),
    ...(typeof openrouter.promptCacheKey === "string" ? { prompt_cache_key: openrouter.promptCacheKey } : {}),
  }
}

export const adapter = Adapter.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.baseURL({ default: profile.baseURL, path: "/chat/completions" }),
  framing: Framing.sse,
})

export const adapters = [adapter]

const modelRef = Adapter.model<ModelInput>(
  adapter,
  {
    provider: profile.provider,
    baseURL: profile.baseURL,
    capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
  },
)

export const model = (id: string | ModelID, options: ModelOptions = {}) => modelRef({ ...options, id })

export const provider = Provider.make({
  id: ProviderID.make(profile.provider),
  model,
})
