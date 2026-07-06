import { Schema } from "effect"
import type { CassetteMetadata, JsonValue } from "../api.js"
import { HttpInteractionSchema } from "../http/model.js"
import { WebSocketInteractionSchema } from "../websocket/model.js"

export type { CassetteMetadata, JsonValue } from "../api.js"

const JsonValueSchema = Schema.suspend(
  (): Schema.Codec<JsonValue> =>
    Schema.Union([
      Schema.Null,
      Schema.Boolean,
      Schema.Number,
      Schema.String,
      Schema.Array(JsonValueSchema),
      Schema.Record(Schema.String, JsonValueSchema),
    ]),
)

export const CassetteMetadataSchema = Schema.Record(Schema.String, JsonValueSchema)

export const InteractionSchema = Schema.Union([HttpInteractionSchema, WebSocketInteractionSchema]).pipe(
  Schema.toTaggedUnion("transport"),
)
export type Interaction = Schema.Schema.Type<typeof InteractionSchema>

export const isHttpInteraction = InteractionSchema.guards.http
export const isWebSocketInteraction = InteractionSchema.guards.websocket
export const httpInteractions = (interactions: ReadonlyArray<Interaction>) => interactions.filter(isHttpInteraction)
export const webSocketInteractions = (interactions: ReadonlyArray<Interaction>) =>
  interactions.filter(isWebSocketInteraction)

export const CassetteSchema = Schema.Struct({
  version: Schema.Literal(1),
  metadata: Schema.optional(CassetteMetadataSchema),
  interactions: Schema.Array(InteractionSchema),
})
export type Cassette = Schema.Schema.Type<typeof CassetteSchema>

export const decodeCassette = Schema.decodeUnknownSync(CassetteSchema)
export const encodeCassette = Schema.encodeSync(CassetteSchema)

export * as CassetteModel from "./model.js"
