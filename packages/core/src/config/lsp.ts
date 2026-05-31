export * as ConfigLSP from "./lsp"

import { Schema } from "effect"

export const Disabled = Schema.Struct({
  disabled: Schema.Literal(true),
})

export class Server extends Schema.Class<Server>("ConfigV2.LSP.Server")({
  command: Schema.String.pipe(Schema.Array),
  extensions: Schema.String.pipe(Schema.Array, Schema.optional),
  disabled: Schema.Boolean.pipe(Schema.optional),
  env: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  initialization: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
}) {}

export const Entry = Schema.Union([Disabled, Server])
export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)])
