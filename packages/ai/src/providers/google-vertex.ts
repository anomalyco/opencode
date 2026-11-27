import { Effect, Struct } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { Gemini } from "../protocols/gemini.js"
import { GoogleEmbedContent, type VertexOptionsInput } from "../protocols/google-embed-content.js"
import { GoogleImages } from "../protocols/google-images.js"
import {
  GoogleVertexPredictEmbeddings,
  MAX_INSTANCES,
  type OptionsInput as PredictOptionsInput,
} from "../protocols/google-vertex-predict-embeddings.js"
import { ProviderShared } from "../protocols/shared.js"
import { Auth } from "../route/auth.js"
import { EmbeddingRoute } from "../route/embedding.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaRoute } from "../route/media.js"
import { Provider } from "../provider.js"
import {
  mergeTransport,
  ProviderConfigurationError,
  ProviderID,
  type ModelID,
  type ProviderOptions,
  type RequestOptions,
} from "../schema/index.js"
import { GoogleVertexShared } from "./google-vertex-shared.js"

export interface GeminiOptionsInput extends Gemini.OptionsInput {
  readonly labels?: Readonly<Record<string, string>>
}

export type GeminiProviderOptionsInput = GeminiOptionsInput

export const id = ProviderID.make("google-vertex")

export type Config = RequestOptions &
  GoogleVertexShared.ApiKeyOptions & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
    readonly providerOptions?: GeminiProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  GeminiProviderOptionsInput &
  (
    | { readonly accessToken?: string; readonly apiKey?: never }
    | { readonly accessToken?: never; readonly apiKey?: string }
  ) & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

export const gemini = Gemini.api
  .extend({
    id: "google-vertex-gemini",
    body: (request, base) =>
      base(request).pipe(
        Effect.map((body) => {
          const value = request.providerOptions?.labels
          const labels = ProviderShared.isRecord(value)
            ? Object.fromEntries(
                Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
              )
            : undefined
          return { ...Struct.omit(body, ["serviceTier"]), labels }
        }),
      ),
    path: ({ request }) => {
      const model = request.model.id
      return `/${model.startsWith("endpoints/") ? model : `models/${model}`}:streamGenerateContent?alt=sse`
    },
    headers: GoogleVertexShared.serviceTierHeader,
  })
  .configure({ metadataKey: "vertex" })

// Tuned models live under `endpoints/{id}` outside `publishers/google`, so they resolve a different base URL.
const vertex = (modelID: string) =>
  Provider.make({
    ...GoogleVertexShared.shared,
    apis: [gemini],
    settings: {
      keys: GoogleVertexShared.connectionKeys,
      patch: (values: GoogleVertexShared.ConnectionSettings): Provider.Patch => connection(values, modelID),
    },
  })

export const googleVertex = vertex("")
const tuned = vertex("endpoints/")

export type { VertexOptionsInput as GoogleVertexEmbeddingOptions } from "../protocols/google-embed-content.js"
export type { OptionsInput as GoogleVertexPredictEmbeddingOptions } from "../protocols/google-vertex-predict-embeddings.js"

const embedContentRoute = EmbeddingRoute.make({
  id: "google-vertex-embed-content",
  provider: id,
  providerMetadataKey: "vertex",
  protocol: GoogleEmbedContent.vertexProtocol,
  endpoint: Endpoint.path(({ request }) => `/models/${request.model.id}:embedContent`),
  // Vertex embedContent embeds one content per request.
  maxValues: 1,
})

const predictRoute = EmbeddingRoute.make({
  id: "google-vertex-predict-embeddings",
  provider: id,
  providerMetadataKey: "vertex",
  protocol: GoogleVertexPredictEmbeddings.protocol,
  // Tuned embedding models are deployed to `endpoints/{id}`, which serve `:predict` outside `publishers/google`.
  endpoint: Endpoint.path(({ request }) => {
    const model = request.model.id
    return `/${model.startsWith("endpoints/") ? model : `models/${model}`}:predict`
  }),
  maxValues: MAX_INSTANCES,
})

/**
 * `gemini-embedding-2*` models use `embedContent`, which takes media; every other embedding model uses the older
 * text-only `:predict` API. `gemini-embedding-001` takes one text per `:predict` request.
 */
const embeddingTarget = (modelID: string) => {
  if (modelID.startsWith("gemini-embedding-2")) return { route: embedContentRoute, embedContent: true }
  if (modelID.startsWith("gemini-embedding-001"))
    return { route: predictRoute.with({ maxValues: 1 }), embedContent: false }
  return { route: predictRoute, embedContent: false }
}

type Connection = GoogleVertexShared.ConnectionSettings & { readonly auth?: Auth.Definition }

const connection = (input: Connection, modelID: string) => {
  const apiKey = GoogleVertexShared.apiKey(input)
  const endpointModel = modelID.startsWith("endpoints/")
  if (apiKey !== undefined && endpointModel)
    throw new ProviderConfigurationError({
      provider: id,
      message: "Google Vertex tuned models do not support Express Mode API keys",
    })
  const location = GoogleVertexShared.location(input.location)
  const project = GoogleVertexShared.project(input.project)
  const baseURL =
    input.baseURL ??
    (apiKey
      ? "https://aiplatform.googleapis.com/v1/publishers/google"
      : `https://${GoogleVertexShared.host(location)}/v1beta1/projects/${GoogleVertexShared.requireProject(project)}/locations/${location}${endpointModel ? "" : "/publishers/google"}`)
  return {
    baseURL,
    auth: apiKey === undefined ? GoogleVertexShared.oauth(input, project) : Auth.header("x-goog-api-key", apiKey),
  }
}

/** Connection settings for Vertex media models. Language models come from `model`. */
export const media = (input: Config = {}) => ({
  id,
  image: (modelID: string | ModelID, providerOptions?: ProviderOptions) => {
    const target = connection(input, modelID)
    return GoogleImages.model({
      ...MediaRoute.deployment({ ...input, baseURL: target.baseURL }, target.auth),
      id: modelID,
      providerOptions,
    })
  },
  /** `gemini-embedding-2*` through `embedContent`, other models through `:predict`; see `embeddingTarget`. */
  embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) => {
    const target = connection(input, modelID)
    const selected = embeddingTarget(modelID)
    if (selected.embedContent && GoogleVertexShared.apiKey(input) !== undefined && input.baseURL === undefined)
      throw new ProviderConfigurationError({
        provider: id,
        message: "Google Vertex embedContent does not support Express Mode API keys; use project credentials",
      })
    return selected.route
      .with({
        endpoint: { baseURL: target.baseURL },
        auth: target.auth,
        ...mergeTransport(input),
      })
      .model<VertexOptionsInput & PredictOptionsInput>({ id: modelID, providerOptions })
  },
})

export const model: ProviderPackage.Model<Settings, GeminiProviderOptionsInput> = (modelID, ...settings) =>
  Provider.entrypoint<Settings, GeminiProviderOptionsInput>(modelID.startsWith("endpoints/") ? tuned : googleVertex)(
    modelID,
    ...settings,
  )
export const imageModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const embeddingModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return media(input).embedding(modelID, input.providerOptions)
}

function config({ accessToken, apiKey, baseURL, body, headers, location, project, ...providerOptions }: Settings = {}) {
  if (apiKey !== undefined && accessToken !== undefined)
    throw new ProviderConfigurationError({
      provider: id,
      message: "Google Vertex apiKey cannot be combined with accessToken or auth",
    })
  return {
    ...(apiKey === undefined ? { accessToken: accessToken } : { apiKey: apiKey }),
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    location,
    project,
    providerOptions,
  }
}
