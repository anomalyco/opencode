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
  // How long to wait for diagnostics, in milliseconds. Defaults suit servers
  // that respond quickly; a large C++ translation unit can take far longer to
  // parse than the default wait, in which case the client gives up and reports
  // no diagnostics at all — indistinguishable from a clean file.
  timeout: Schema.Struct({
    document: Schema.Number.pipe(Schema.optional),
    full: Schema.Number.pipe(Schema.optional),
  }).pipe(Schema.optional),
}) {}

export const Entry = Schema.Union([Disabled, Server])
export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)])
