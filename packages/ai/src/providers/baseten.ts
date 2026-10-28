import { Effect } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { SystemOne } from "../protocols/system-one.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { DecisionRoute } from "../route/decision.js"
import { Endpoint } from "../route/endpoint.js"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("baseten")
const baseURL = "https://inference.baseten.co/v1"

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }
export interface BasetenDecisionOptions {
  readonly [key: string]: unknown
  readonly max_len?: number
}

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string
    readonly baseURL?: string
  }

export const route = Route.make({
  id: "baseten-chat",
  provider: id,
  providerMetadataKey: "baseten",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

export const routes = [route]

// Baseten reads media only as parts in a user message inside `state.messages`, not in any of the System One
// placements models.dev describes, so its decision protocol fixes that placement.
const decisionProtocol = DecisionRoute.protocol({
  ...SystemOne.protocol,
  id: "baseten-system-one",
  body: {
    from: (request) =>
      SystemOne.encodeBody(request, "state.messages").pipe(
        Effect.map((body) => ({ ...body, model: request.model.id })),
      ),
  },
})

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const auth = AuthOptions.bearer(input, "BASETEN_API_KEY")
  const configured = route.with({
    ...defaults,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth,
  })
  const decisionRoute = DecisionRoute.make({
    id: decisionProtocol.id,
    provider: id,
    providerMetadataKey: "baseten",
    protocol: decisionProtocol,
    endpoint: Endpoint.path("/systemone", { baseURL: endpoint ?? baseURL }),
    auth,
    headers: input.headers,
    http: input.http,
  })
  const decision = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    decisionRoute.model<BasetenDecisionOptions>({ id: modelID, providerOptions })
  return {
    id,
    model: (modelID: string | ModelID) => configured.model<OpenAIProviderOptionsInput>({ id: modelID }),
    decision,
    configure,
  }
}

export const provider = configure()
export const decision = provider.decision

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return configure(input).decision(modelID, input.providerOptions)
}

function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}

export * as Baseten from "./baseten.js"
