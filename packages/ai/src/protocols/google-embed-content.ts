import { Effect, Schema } from "effect"
import { EmbeddingResponse, EmbeddingUsage, type EmbeddingRequest } from "../embedding.js"
import { EmbeddingRoute } from "../route/embedding.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { mergeJsonRecords, type AIError, type OpenString } from "../schema/index.js"
import { GeminiGenerateContent } from "./utils/gemini-generate-content.js"

const ID = "google-embed-content"
const NAME = "Google embedContent"
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
/** `batchEmbedContents` takes at most 100 requests. */
export const MAX_BATCH = 100

export type TaskType = OpenString<
  | "RETRIEVAL_QUERY"
  | "RETRIEVAL_DOCUMENT"
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING"
  | "QUESTION_ANSWERING"
  | "FACT_VERIFICATION"
  | "CODE_RETRIEVAL_QUERY"
>

/**
 * Per-value embedding fields, sent with each value. `taskType` replaces the one `inputType` maps to; Gemini Embedding 2
 * ignores task types and documents task prefixes in the text instead (`task: search result | query: …`).
 */
export interface OptionsInput {
  readonly [key: string]: unknown
  readonly taskType?: TaskType
  readonly title?: string
}

/** Vertex `embedContentConfig` fields; Vertex alone takes `autoTruncate`, `documentOcr` and `audioTrackExtraction`. */
export interface VertexOptionsInput extends OptionsInput {
  readonly autoTruncate?: boolean
  readonly documentOcr?: boolean
  readonly audioTrackExtraction?: boolean
}

const Values = Schema.Struct({ values: Schema.Array(Schema.Number) })

const UsageMetadata = Schema.StructWithRest(Schema.Struct({ promptTokenCount: Schema.optional(Schema.Number) }), [
  Schema.Record(Schema.String, Schema.Unknown),
])

const BatchResponse = Schema.Struct({
  embeddings: Schema.Array(Values),
  usageMetadata: Schema.optional(UsageMetadata),
})

const SingleResponse = Schema.Struct({
  embedding: Values,
  usageMetadata: Schema.optional(UsageMetadata),
  truncated: Schema.optional(Schema.Boolean),
})

const TASK_TYPES = { query: "RETRIEVAL_QUERY", document: "RETRIEVAL_DOCUMENT" } as const

// Each value is its own content: several parts in one content embed into one aggregated vector.
const content = (value: EmbeddingRequest["values"][number]): Effect.Effect<{ readonly parts: [unknown] }, AIError> =>
  typeof value === "string"
    ? Effect.succeed({ parts: [{ text: value }] })
    : GeminiGenerateContent.mediaPart(NAME, value).pipe(Effect.map((part) => ({ parts: [part] })))

const config = (request: EmbeddingRequest) => ({
  ...(request.inputType === undefined ? {} : { taskType: TASK_TYPES[request.inputType] }),
  ...(request.dimensions === undefined ? {} : { outputDimensionality: request.dimensions }),
  ...request.providerOptions,
})

const identity = MediaProtocol.identity({ id: ID, name: NAME, provider: "google" })
const decodeBatch = identity.decodeJson(BatchResponse)
const decodeSingle = identity.decodeJson(SingleResponse)

const usage = (metadata: Schema.Schema.Type<typeof UsageMetadata> | undefined) =>
  metadata?.promptTokenCount === undefined ? undefined : new EmbeddingUsage({ inputTokens: metadata.promptTokenCount })

/** Gemini API `batchEmbedContents`: one request per value, so every value gets its own vector. */
export const protocol = EmbeddingRoute.protocol({
  id: ID,
  name: NAME,
  body: {
    from: Effect.fn("GoogleEmbedContent.fromRequest")(function* (request: EmbeddingRequest) {
      const contents = yield* Effect.forEach(request.values, content)
      const fields = config(request)
      return (
        mergeJsonRecords(
          { requests: contents.map((item) => ({ model: `models/${request.model.id}`, content: item, ...fields })) },
          request.http?.body,
        ) ?? {}
      )
    }),
  },
  response: {
    decode: Effect.fn("GoogleEmbedContent.decodeResponse")(function* (response, context) {
      const output = yield* decodeBatch(response)
      return new EmbeddingResponse({
        embeddings: output.value.embeddings.map((item) => item.values),
        usage: usage(output.value.usageMetadata),
        providerMetadata: {
          [context.providerMetadataKey]:
            output.value.usageMetadata === undefined ? {} : { usageMetadata: output.value.usageMetadata },
        },
      })
    }),
  },
})

/**
 * Vertex `embedContent`: one content per request, with options under `embedContentConfig`. Routes using it set
 * `maxValues: 1`.
 */
export const vertexProtocol = EmbeddingRoute.protocol({
  id: "google-vertex-embed-content",
  name: "Google Vertex embedContent",
  body: {
    from: Effect.fn("GoogleEmbedContent.vertexFromRequest")(function* (request: EmbeddingRequest) {
      const contents = yield* Effect.forEach(request.values, content)
      const fields = config(request)
      return (
        mergeJsonRecords(
          {
            content: contents[0],
            ...(Object.keys(fields).length === 0 ? {} : { embedContentConfig: fields }),
          },
          request.http?.body,
        ) ?? {}
      )
    }),
  },
  response: {
    decode: Effect.fn("GoogleEmbedContent.vertexDecodeResponse")(function* (response, context) {
      const output = yield* decodeSingle(response)
      return new EmbeddingResponse({
        embeddings: [output.value.embedding.values],
        usage: usage(output.value.usageMetadata),
        providerMetadata: {
          [context.providerMetadataKey]: {
            ...(output.value.usageMetadata === undefined ? {} : { usageMetadata: output.value.usageMetadata }),
            ...(output.value.truncated === undefined ? {} : { truncated: output.value.truncated }),
          },
        },
      })
    }),
  },
})

export const route = EmbeddingRoute.make({
  id: ID,
  provider: "google",
  protocol,
  endpoint: Endpoint.path(({ request }) => `/models/${request.model.id}:batchEmbedContents`, {
    baseURL: DEFAULT_BASE_URL,
  }),
  maxValues: MAX_BATCH,
})

export const GoogleEmbedContent = {
  protocol,
  vertexProtocol,
  route,
} as const
