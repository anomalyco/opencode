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

export const profile = OpenAICompatibleProfiles.profiles.edenai
export const id = ProviderID.make(profile.provider)
const ADAPTER = "edenai"

export interface EdenAIOptions {
  readonly [key: string]: unknown
  // Ordered list of `provider/model` fallbacks tried if the primary model fails.
  readonly fallbacks?: ReadonlyArray<string>
  // Restrict the `@edenai` smart router to a subset of candidate models.
  readonly routerCandidates?: ReadonlyArray<string>
}

export type EdenAIProviderOptionsInput = ProviderOptions & {
  readonly edenai?: EdenAIOptions
}

export type ModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: EdenAIProviderOptionsInput
  }

const EdenAIBody = Schema.StructWithRest(Schema.Struct(OpenAIChat.bodyFields), [
  Schema.Record(Schema.String, Schema.Any),
])
export type EdenAIBody = Schema.Schema.Type<typeof EdenAIBody>

export const protocol = Protocol.make({
  id: "edenai-chat",
  body: {
    schema: EdenAIBody,
    from: (request) =>
      OpenAIChat.protocol.body.from(request).pipe(
        Effect.map(
          (body) =>
            ({
              ...body,
              ...bodyOptions(request.providerOptions?.edenai),
            }) as EdenAIBody,
        ),
      ),
  },
  stream: OpenAIChat.protocol.stream,
})

const bodyOptions = (input: unknown) => {
  const edenai = isRecord(input) ? input : {}
  return {
    ...(Array.isArray(edenai.fallbacks) ? { fallbacks: edenai.fallbacks } : {}),
    ...(Array.isArray(edenai.routerCandidates) ? { router_candidates: edenai.routerCandidates } : {}),
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
    auth: AuthOptions.bearer(input, "EDENAI_API_KEY"),
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
