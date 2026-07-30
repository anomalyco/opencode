import { ProviderID, type ModelID } from "../schema"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import { Route, type RouteDefaultsInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import * as OpenAIChat from "../protocols/openai-chat"

export const id = ProviderID.make("prism-router")

export type ModelOptions = RouteDefaultsInput & ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
}

export const route = Route.make({
  id: "prism-router-chat",
  provider: "prism-router",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: "https://prism-router-production.up.railway.app/v1" }),
  framing: Framing.sse,
})

export const routes = [route]

const configuredRoute = (input: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return route.with({
    ...rest,
    endpoint: { baseURL: baseURL ?? "https://prism-router-production.up.railway.app/v1" },
    auth: AuthOptions.bearer(input, []),
  })
}

export const configure = (input: ModelOptions = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model({
      id: modelID,
      provider: ProviderID.make("prism-router"),
    }),
    configure,
  }
}

export const provider = configure()
export const model = provider.model
