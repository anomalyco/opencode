import { Effect, Schema } from "effect"
import { Route, type RouteModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Provider } from "../provider"
import { Protocol } from "../route/protocol"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAIChat from "../protocols/openai-chat"
import { isRecord } from "../protocols/shared"

export const profile = OpenAICompatibleProfiles.profiles.openrouter
export const id = ProviderID.make(profile.provider)
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

export type ModelOptions = Omit<RouteModelInput, "id" | "baseURL" | "providerOptions"> & {
  readonly baseURL?: string
  readonly providerOptions?: OpenRouterProviderOptionsInput
}
type ModelInput = ModelOptions & Pick<RouteModelInput, "id">

const OpenRouterBody = Schema.StructWithRest(Schema.Struct(OpenAIChat.bodyFields), [
  Schema.Record(Schema.String, Schema.Any),
])
export type OpenRouterBody = Schema.Schema.Type<typeof OpenRouterBody>

export const protocol = Protocol.make({
  id: "openrouter-chat",
  body: {
    schema: OpenRouterBody,
    from: (request) =>
      OpenAIChat.protocol.body.from(request).pipe(
        Effect.map(
          (body) =>
            ({
              ...body,
              ...bodyOptions(request.providerOptions?.openrouter),
            }) as OpenRouterBody,
        ),
      ),
  },
  stream: OpenAIChat.protocol.stream,
})

const bodyOptions = (input: unknown) => {
  const openrouter = isRecord(input) ? input : {}
  return {
    ...(openrouter.usage === true
      ? { usage: { include: true } }
      : isRecord(openrouter.usage)
        ? { usage: openrouter.usage }
        : {}),
    ...(isRecord(openrouter.reasoning) ? { reasoning: openrouter.reasoning } : {}),
    ...(typeof openrouter.promptCacheKey === "string" ? { prompt_cache_key: openrouter.promptCacheKey } : {}),
  }
}

export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: Framing.sse,
})

export const routes = [route]

const modelRef = Route.model<ModelInput>(route, {
  provider: profile.provider,
  baseURL: profile.baseURL,
})

export const model = (id: string | ModelID, options: ModelOptions = {}) => modelRef({ ...options, id })

export const provider = Provider.make({
  id,
  model,
})
