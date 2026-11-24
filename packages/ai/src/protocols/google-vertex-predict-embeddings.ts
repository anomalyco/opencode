import { Effect, Schema } from "effect"
import { EmbeddingResponse, EmbeddingUsage, type EmbeddingRequest } from "../embedding.js"
import { EmbeddingRoute } from "../route/embedding.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { AIError, UnsupportedOperationError, mergeJsonRecords } from "../schema/index.js"
import type { TaskType } from "./google-embed-content.js"

const ID = "google-vertex-predict-embeddings"
const NAME = "Google Vertex text embeddings"
/** `text-embedding-005` and `text-multilingual-embedding-002` take up to 250 instances per request. */
export const MAX_INSTANCES = 250

/**
 * The same option names as `embedContent`, so a model can move between the two APIs: `taskType` and `title` go on
 * each instance (`task_type`, `title`), and `autoTruncate` and anything else go under `parameters`.
 */
export interface OptionsInput {
  readonly [key: string]: unknown
  readonly taskType?: TaskType
  readonly title?: string
  readonly autoTruncate?: boolean
}

const Statistics = Schema.StructWithRest(
  Schema.Struct({ token_count: Schema.optional(Schema.Number), truncated: Schema.optional(Schema.Boolean) }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const Response = Schema.Struct({
  predictions: Schema.Array(
    Schema.Struct({
      embeddings: Schema.Struct({ values: Schema.Array(Schema.Number), statistics: Schema.optional(Statistics) }),
    }),
  ),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

const TASK_TYPES = { query: "RETRIEVAL_QUERY", document: "RETRIEVAL_DOCUMENT" } as const

const fromRequest = Effect.fn("GoogleVertexPredictEmbeddings.fromRequest")(function* (request: EmbeddingRequest) {
  const contents = request.values.filter((value) => typeof value === "string")
  if (contents.length !== request.values.length)
    return yield* new AIError({
      reason: new UnsupportedOperationError({
        operation: "embedding.media",
        provider: request.model.provider,
        route: request.model.route.id,
        message: `${request.model.id} on Vertex :predict embeds text only; use gemini-embedding-2 for media values`,
      }),
    })
  const { taskType, title, ...parameters } = request.providerOptions ?? {}
  const instance = {
    ...(taskType === undefined
      ? request.inputType === undefined
        ? {}
        : { task_type: TASK_TYPES[request.inputType] }
      : { task_type: taskType }),
    ...(title === undefined ? {} : { title }),
  }
  const merged = {
    ...(request.dimensions === undefined ? {} : { outputDimensionality: request.dimensions }),
    ...parameters,
  }
  return (
    mergeJsonRecords(
      {
        instances: contents.map((content) => ({ content, ...instance })),
        ...(Object.keys(merged).length === 0 ? {} : { parameters: merged }),
      },
      request.http?.body,
    ) ?? {}
  )
})

const decodeDocument = MediaProtocol.identity({ id: ID, name: NAME, provider: "google-vertex" }).decodeJson(Response)

export const protocol = EmbeddingRoute.protocol({
  id: ID,
  name: NAME,
  body: { from: fromRequest },
  response: {
    decode: Effect.fn("GoogleVertexPredictEmbeddings.decodeResponse")(function* (response, context) {
      const output = yield* decodeDocument(response)
      const statistics = output.value.predictions.map((prediction) => prediction.embeddings.statistics ?? {})
      const tokens = statistics.map((item) => item.token_count)
      return new EmbeddingResponse({
        embeddings: output.value.predictions.map((prediction) => prediction.embeddings.values),
        usage: tokens.every((count) => count !== undefined)
          ? new EmbeddingUsage({ inputTokens: tokens.reduce((sum, count) => sum + count, 0) })
          : undefined,
        providerMetadata: {
          [context.providerMetadataKey]: {
            statistics,
            ...(output.value.metadata === undefined ? {} : { metadata: output.value.metadata }),
          },
        },
      })
    }),
  },
})

export const GoogleVertexPredictEmbeddings = {
  protocol,
} as const
