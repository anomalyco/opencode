import { Effect, Schema } from "effect"
import { Route, type RouteDefaultsInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import { profiles } from "./openai-compatible-profile"
import { OpenAIChat } from "../protocols/openai-chat"
import { isRecord } from "../protocols/shared"

export const profile = profiles.requesty
export const id = ProviderID.make(profile.provider)
const ADAPTER = "requesty"

export interface RequestyOptions {
  readonly [key: string]: unknown
  readonly reasoningEffort?: string
  readonly includeReasoning?: boolean
  readonly user?: string
  readonly extraBody?: Record<string, unknown>
}

export type RequestyProviderOptionsInput = ProviderOptions & {
  readonly requesty?: RequestyOptions
}

export type ModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: RequestyProviderOptionsInput
  }

const RequestyBody = Schema.StructWithRest(Schema.Struct(OpenAIChat.bodyFields), [
  Schema.Record(Schema.String, Schema.Any),
])
export type RequestyBody = Schema.Schema.Type<typeof RequestyBody>

export const protocol = Protocol.make({
  id: "requesty-chat",
  body: {
    schema: RequestyBody,
    from: (request) =>
      OpenAIChat.protocol.body.from(request).pipe(
        Effect.map(
          (body) =>
            ({
              ...body,
              ...bodyOptions(request.providerOptions?.requesty),
            }) as RequestyBody,
        ),
      ),
  },
  stream: OpenAIChat.protocol.stream,
})

// Requesty accepts flat `reasoning_effort` / `include_reasoning` rather than
// OpenRouter's nested `reasoning` object. Any remaining keys are gateway
// metadata (e.g. `auto_cache`) and belong under a root-level `requesty` object.
const bodyOptions = (input: unknown) => {
  const { reasoningEffort, includeReasoning, user, extraBody, ...metadata } = isRecord(input) ? input : {}
  return {
    ...(typeof reasoningEffort === "string" ? { reasoning_effort: reasoningEffort } : {}),
    ...(typeof includeReasoning === "boolean" ? { include_reasoning: includeReasoning } : {}),
    ...(typeof user === "string" ? { user } : {}),
    ...(isRecord(extraBody) ? extraBody : {}),
    ...(Object.keys(metadata).length > 0 ? { requesty: metadata } : {}),
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
    auth: AuthOptions.bearer(input, "REQUESTY_API_KEY"),
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
