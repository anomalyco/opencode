export * as ConfigLSPV1 from "./lsp"

import { Schema } from "effect"

export const Disabled = Schema.Struct({
  disabled: Schema.Literal(true),
}).pipe((schema) => schema)

export const Entry = Schema.Union([
  Disabled,
  Schema.Struct({
    command: Schema.mutable(Schema.Array(Schema.String)),
    extensions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    disabled: Schema.optional(Schema.Boolean),
    env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    initialization: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
]).pipe((schema) => schema)

// Keep this list aligned with the builtin servers in opencode's LSP runtime.
// Custom servers must declare extensions because the runtime cannot infer them.
export const builtinServerIds = [
  "deno",
  "typescript",
  "vue",
  "eslint",
  "oxlint",
  "biome",
  "gopls",
  "ruby-lsp",
  "ty",
  "pyright",
  "elixir-ls",
  "zls",
  "csharp",
  "razor",
  "fsharp",
  "sourcekit-lsp",
  "rust",
  "clangd",
  "svelte",
  "astro",
  "jdtls",
  "kotlin-ls",
  "yaml-ls",
  "lua-ls",
  "php intelephense",
  "prisma",
  "dart",
  "ocaml-lsp",
  "bash",
  "terraform",
  "texlab",
  "dockerfile",
  "gleam",
  "clojure-lsp",
  "nixd",
  "tinymist",
  "haskell-language-server",
  "julials",
]

export const requiresExtensionsForCustomServers = Schema.makeFilter<
  boolean | Record<string, Schema.Schema.Type<typeof Entry>>
>((data) => {
  if (typeof data === "boolean") return undefined
  const ids = new Set(builtinServerIds)
  const ok = Object.entries(data).every(([id, config]) => {
    if ("disabled" in config && config.disabled) return true
    if (ids.has(id)) return true
    return "extensions" in config && Boolean(config.extensions)
  })
  return ok ? undefined : "For custom LSP servers, 'extensions' array is required."
})

export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)])
  .check(requiresExtensionsForCustomServers)
  .pipe((schema) => schema)

export type Info = Schema.Schema.Type<typeof Info>
