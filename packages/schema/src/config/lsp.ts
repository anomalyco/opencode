export * as ConfigLSP from "./lsp.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export const Disabled = Schema.Struct({
  disabled: Schema.Literal(true),
})

export class Server extends Schema.Class<Server>("Config.LSP.Server")({
  command: Schema.String.pipe(Schema.Array),
  extensions: Schema.String.pipe(Schema.Array, optional),
  disabled: Schema.Boolean.pipe(optional),
  env: Schema.Record(Schema.String, Schema.String).pipe(optional),
  initialization: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}) {}

export const Entry = Schema.Union([Disabled, Server])
export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)])
