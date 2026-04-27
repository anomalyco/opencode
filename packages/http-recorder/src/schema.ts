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

export const InteractionSchema = Schema.Struct({
  request: RequestSnapshotSchema,
  response: ResponseSnapshotSchema,
})
export type Interaction = Schema.Schema.Type<typeof InteractionSchema>

export const CassetteMetadataSchema = Schema.Record(Schema.String, Schema.Unknown)
export type CassetteMetadata = Schema.Schema.Type<typeof CassetteMetadataSchema>

export const CassetteSchema = Schema.Struct({
  version: Schema.Literal(1),
  metadata: Schema.optional(CassetteMetadataSchema),
  interactions: Schema.Array(InteractionSchema),
})
export type Cassette = Schema.Schema.Type<typeof CassetteSchema>

export const decodeCassette = Schema.decodeUnknownSync(CassetteSchema)
export const encodeCassette = Schema.encodeSync(CassetteSchema)
