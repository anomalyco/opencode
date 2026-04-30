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

/**
 * For custom (non-builtin) LSP server entries, `extensions` is required so the
 * client knows which files the server should attach to. Builtin server IDs and
 * explicitly disabled entries are exempt.
 */
export const requiresExtensionsForCustomServers = Schema.makeFilter<
  boolean | Record<string, Schema.Schema.Type<typeof Entry>>
>((data) => {
  if (typeof data === "boolean") return undefined
  const serverIds = new Set(Object.values(LSPServer).map((server) => server.id))
  const ok = Object.entries(data).every(([id, config]) => {
    if ("disabled" in config && config.disabled) return true
    if (serverIds.has(id)) return true
    return "extensions" in config && Boolean(config.extensions)
  })
  return ok ? undefined : "For custom LSP servers, 'extensions' array is required."
})

export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)])
  .check(requiresExtensionsForCustomServers)
  .pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>
