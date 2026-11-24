import { Effect, Schema } from "effect"
import { Base64 } from "effect/encoding"
import { EmbeddingResponse, EmbeddingUsage, type EmbeddingRequest } from "../embedding.js"
import { EmbeddingRoute } from "../route/embedding.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { AIError, UnsupportedOperationError, mergeJsonRecords, type OpenString } from "../schema/index.js"

const ID = "openai-embeddings"
const NAME = "OpenAI Embeddings"
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/embeddings"

/** Sent as given; anything else a host accepts (`input_type`, `truncate`, …) goes alongside. */
export interface OptionsInput {
  readonly [key: string]: unknown
  readonly user?: string
  readonly encoding_format?: OpenString<"float" | "base64">
}

const Response = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      index: Schema.optional(Schema.Int),
      // `base64` encoding returns little-endian float32 bytes instead of a number list.
      embedding: Schema.Union([Schema.Array(Schema.Number), Schema.String]),
    }),
  ),
  model: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({ prompt_tokens: Schema.optional(Schema.Number), total_tokens: Schema.optional(Schema.Number) }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  ),
})

// `inputType` has no field here; OpenAI's models embed queries and documents the same way.
const fromRequest = Effect.fn("OpenAIEmbeddings.fromRequest")(function* (request: EmbeddingRequest) {
  const input = request.values.filter((value) => typeof value === "string")
  if (input.length !== request.values.length)
    return yield* new AIError({
      reason: new UnsupportedOperationError({
        operation: "embedding.media",
        provider: request.model.provider,
        route: request.model.route.id,
        message: `${NAME} embeds text only; pass media values to a host with a multimodal embedding API`,
      }),
    })
  return {
    ...mergeJsonRecords({ encoding_format: "float", ...request.providerOptions }, request.http?.body),
    model: request.model.id,
    input,
    ...(request.dimensions === undefined ? {} : { dimensions: request.dimensions }),
  }
})

const decodeDocument = MediaProtocol.identity({ id: ID, name: NAME, provider: "openai" }).decodeJson(Response)

export const protocol = EmbeddingRoute.protocol({
  id: ID,
  name: NAME,
  body: { from: fromRequest },
  response: {
    decode: Effect.fn("OpenAIEmbeddings.decodeResponse")(function* (response, context) {
      const output = yield* decodeDocument(response)
      const embeddings = yield* Effect.forEach(
        output.value.data
          .map((item, position) => ({ index: item.index ?? position, embedding: item.embedding }))
          .toSorted((a, b) => a.index - b.index),
        (item) =>
          typeof item.embedding !== "string"
            ? Effect.succeed(item.embedding)
            : Effect.fromResult(Base64.decode(item.embedding)).pipe(
                Effect.map((bytes) => Array.from(new Float32Array(bytes.slice().buffer))),
                Effect.mapError((cause) => output.invalid(`${NAME} returned an invalid base64 embedding`, cause)),
              ),
      )
      const usage = output.value.usage
      return new EmbeddingResponse({
        embeddings,
        usage:
          usage?.prompt_tokens === undefined ? undefined : new EmbeddingUsage({ inputTokens: usage.prompt_tokens }),
        providerMetadata: {
          [context.providerMetadataKey]: {
            ...(output.value.model === undefined ? {} : { model: output.value.model }),
            ...(usage === undefined ? {} : { usage }),
          },
        },
      })
    }),
  },
})

export const route = EmbeddingRoute.make({
  id: ID,
  provider: "openai",
  protocol,
  endpoint: Endpoint.path(PATH, { baseURL: DEFAULT_BASE_URL }),
})

export const OpenAIEmbeddings = {
  protocol,
  route,
} as const
