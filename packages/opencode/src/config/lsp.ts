export * as ConfigLSP from "./lsp"

import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import * as LSPServer from "../lsp/server"

export const Disabled = Schema.Struct({
  disabled: Schema.Literal(true),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export const Entry = Schema.Union([
  Disabled,
  Schema.Struct({
    command: Schema.mutable(Schema.Array(Schema.String)),
    extensions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    disabled: Schema.optional(Schema.Boolean),
    env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    initialization: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
]).pipe(withStatics((s) => ({ zod: zod(s) })))

export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)]).pipe(
  withStatics((s) => ({
    zod: zod(s).refine(
      (data) => {
        if (typeof data === "boolean") return true
        const serverIds = new Set(Object.values(LSPServer).map((server) => server.id))

        return Object.entries(data).every(([id, config]) => {
          if (config.disabled) return true
          if (serverIds.has(id)) return true
          return Boolean(config.extensions)
        })
      },
      {
        error: "For custom LSP servers, 'extensions' array is required.",
      },
    ),
  })),
)

export type Info = Schema.Schema.Type<typeof Info>
