import { Effect, Schema } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { ProviderShared } from "../protocols/shared.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Protocol } from "../route/protocol.js"
import { ProviderID, type ModelID, type LLMRequest } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export const id = ProviderID.make("groq")
const baseURL = "https://api.groq.com/openai/v1"

export type ProviderOptions = Pick<OpenAIProviderOptionsInput, "reasoningEffort"> & {
  /** Controls visible reasoning on GPT-OSS; other models always use parsed reasoning. */
  readonly includeReasoning?: boolean
  readonly parallelToolCalls?: boolean
  readonly serviceTier?: "on_demand" | "flex" | "auto" | "performance" | (string & {})
  readonly user?: string
}

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptions | OpenResponsesProviderOptionsInput
  }

export type Settings<Options = ProviderOptions> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

const Options = Schema.Struct({
  includeReasoning: Schema.optional(Schema.Boolean),
  user: Schema.optional(Schema.String),
})

export const protocol = Protocol.make({
  id: "groq-chat",
  body: {
    schema: Schema.Struct({
      ...OpenAIChat.bodyFields,
      reasoning_format: Schema.optional(Schema.Literal("parsed")),
      include_reasoning: Schema.optional(Schema.Boolean),
      user: Schema.optional(Schema.String),
    }),
    from: Effect.fn("Groq.fromRequest")(function* (request: LLMRequest) {
      const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(
        request.providerOptions ?? {},
      )
      const gptOSS = request.model.id.startsWith("openai/gpt-oss-")
      return {
        ...(yield* OpenAIChat.fromRequest(request)),
        reasoning_format: gptOSS ? undefined : ("parsed" as const),
        include_reasoning: gptOSS ? options.includeReasoning : undefined,
        user: options.user,
      }
    }),
  },
  stream: OpenAIChat.protocol.stream,
})

export const route = Route.make({
  id: "groq-chat",
  provider: id,
  providerMetadataKey: "groq",
  protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

// Groq's Responses API is stateless and rejects `include`, so reasoning is not replayed as encrypted content.
const responsesRoute = Route.make({
  id: "groq-responses",
  provider: id,
  providerMetadataKey: "groq",
  protocol: OpenResponses.protocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  transport: OpenResponses.httpTransport,
  defaults: { providerOptions: { store: false } },
})

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const options = {
    ...defaults,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth: AuthOptions.bearer(input, "GROQ_API_KEY"),
  }
  const configured = route.with(options)
  const configuredResponses = responsesRoute.with(options)
  return {
    id,
    model: (modelID: string | ModelID) =>
      configured.model<ProviderOptions>({
        id: modelID,
        compatibility: {
          maxTokensField: "max_completion_tokens",
          reasoningField: "reasoning",
          requireReasoning: false,
          supportsStrictMode: false,
        },
      }),
    responses: (modelID: string | ModelID) =>
      configuredResponses.model<OpenResponsesProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const responses = provider.responses

export const model: ProviderPackage.Model<Settings, ProviderOptions> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const responsesModel: ProviderPackage.Model<
  Settings<OpenResponsesProviderOptionsInput>,
  OpenResponsesProviderOptionsInput
> = (modelID, settings) => configure(config(settings)).responses(modelID)

function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings<Config["providerOptions"]> = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}

export * as Groq from "./groq.js"
