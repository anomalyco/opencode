import { Schema } from "effect"

export const RequestSnapshotSchema = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
})
export type RequestSnapshot = Schema.Schema.Type<typeof RequestSnapshotSchema>

export const ResponseSnapshotSchema = Schema.Struct({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
  bodyEncoding: Schema.optional(Schema.Literals(["text", "base64"])),
})
export type ResponseSnapshot = Schema.Schema.Type<typeof ResponseSnapshotSchema>

export const CassetteMetadataSchema = Schema.Record(Schema.String, Schema.Unknown)
export type CassetteMetadata = Schema.Schema.Type<typeof CassetteMetadataSchema>

export const HttpInteractionSchema = Schema.Struct({
  transport: Schema.tag("http"),
  request: RequestSnapshotSchema,
  response: ResponseSnapshotSchema,
})
export type HttpInteraction = Schema.Schema.Type<typeof HttpInteractionSchema>

export const WebSocketFrameSchema = Schema.Union([
  Schema.Struct({ kind: Schema.tag("text"), body: Schema.String }),
  Schema.Struct({ kind: Schema.tag("binary"), body: Schema.String, bodyEncoding: Schema.Literal("base64") }),
])
export type WebSocketFrame = Schema.Schema.Type<typeof WebSocketFrameSchema>

export const WebSocketInteractionSchema = Schema.Struct({
  transport: Schema.tag("websocket"),
  open: Schema.Struct({
    url: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  client: Schema.Array(WebSocketFrameSchema),
  server: Schema.Array(WebSocketFrameSchema),
})
export type WebSocketInteraction = Schema.Schema.Type<typeof WebSocketInteractionSchema>

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
