import { Effect } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { SystemOne } from "../protocols/system-one.js"
import { Provider } from "../provider.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { DecisionRoute } from "../route/decision.js"
import { Endpoint } from "../route/endpoint.js"
import { mergeTransport, ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { toConfig } from "./settings.js"

const id = ProviderID.make("baseten")
const baseURL = "https://inference.baseten.co/v1"

/** Connection settings for Baseten's decision models. Language models come from `baseten`. */
export type Config = Omit<RequestOptions, "providerOptions"> &
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
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const baseten = Provider.make({
  id,
  baseURL,
  auth: Provider.apiKey("BASETEN_API_KEY"),
  apis: [OpenAIChat.api],
})

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

export const media = (input: Config = {}) => {
  const decisionRoute = DecisionRoute.make({
    id: decisionProtocol.id,
    provider: id,
    providerMetadataKey: "baseten",
    protocol: decisionProtocol,
    endpoint: Endpoint.path("/systemone", { baseURL: input.baseURL ?? baseURL }),
    auth: AuthOptions.bearer(input, "BASETEN_API_KEY"),
    ...mergeTransport(input),
  })
  return {
    id,
    decision: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      decisionRoute.model<BasetenDecisionOptions>({ id: modelID, providerOptions }),
  }
}

export const decision = media().decision

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(baseten)

export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).decision(modelID, input.providerOptions)
}

export * as Baseten from "./baseten.js"
