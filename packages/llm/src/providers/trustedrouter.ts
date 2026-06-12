import { Effect, Schema } from "effect"
import { Route, type RouteDefaultsInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAIChat from "../protocols/openai-chat"
import { isRecord } from "../protocols/shared"

export const profile = OpenAICompatibleProfiles.profiles.trustedrouter
export const id = ProviderID.make(profile.provider)
const ADAPTER = "trustedrouter"

export interface TrustedRouterOptions {
  readonly [key: string]: unknown
  readonly usage?: boolean | Record<string, unknown>
  readonly reasoning?: Record<string, unknown>
  readonly promptCacheKey?: string
}

export type TrustedRouterProviderOptionsInput = ProviderOptions & {
  readonly trustedrouter?: TrustedRouterOptions
}

export type ModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: TrustedRouterProviderOptionsInput
  }

const TrustedRouterBody = Schema.StructWithRest(Schema.Struct(OpenAIChat.bodyFields), [
  Schema.Record(Schema.String, Schema.Any),
])
export type TrustedRouterBody = Schema.Schema.Type<typeof TrustedRouterBody>

export const protocol = Protocol.make({
  id: "trustedrouter-chat",
  body: {
    schema: TrustedRouterBody,
    from: (request) =>
      OpenAIChat.protocol.body.from(request).pipe(
        Effect.map(
          (body) =>
            ({
              ...body,
              ...bodyOptions(request.providerOptions?.trustedrouter),
            }) as TrustedRouterBody,
        ),
      ),
  },
  stream: OpenAIChat.protocol.stream,
})

const bodyOptions = (input: unknown) => {
  const trustedrouter = isRecord(input) ? input : {}
  return {
    ...(trustedrouter.usage === true
      ? { usage: { include: true } }
      : isRecord(trustedrouter.usage)
        ? { usage: trustedrouter.usage }
        : {}),
    ...(isRecord(trustedrouter.reasoning) ? { reasoning: trustedrouter.reasoning } : {}),
    ...(typeof trustedrouter.promptCacheKey === "string" ? { prompt_cache_key: trustedrouter.promptCacheKey } : {}),
  }
}

export const route = Route.make({
  id: ADAPTER,
  provider: profile.provider,
  protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: profile.baseURL }),
  framing: Framing.sse,
})

export const routes = [route]

const configuredRoute = (input: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return route.with({
    ...rest,
    endpoint: { baseURL: baseURL ?? profile.baseURL },
    auth: AuthOptions.bearer(input, "TRUSTEDROUTER_API_KEY"),
  })
}

export const configure = (input: ModelOptions = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model = provider.model
