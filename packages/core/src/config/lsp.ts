export * as ConfigLSP from "./lsp"

import { Schema } from "effect"

export const Disabled = Schema.Struct({
  disabled: Schema.Literal(true),
})

export class Server extends Schema.Class<Server>("ConfigV2.LSP.Server")({
  command: Schema.String.pipe(Schema.Array, Schema.optional),
  extensions: Schema.String.pipe(Schema.Array, Schema.optional),
  disabled: Schema.Boolean.pipe(Schema.optional),
  env: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  initialization: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
}) {}

export const Entry = Schema.Union([Disabled, Server])
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

export const requiresCustomServerDetails = Schema.makeFilter<
  boolean | Record<string, Schema.Schema.Type<typeof Entry>>
>((data) => {
  if (typeof data === "boolean") return undefined
  const ids = new Set(builtinServerIds)
  const ok = Object.entries(data).every(([id, config]) => {
    if ("disabled" in config && config.disabled) return true
    if (ids.has(id)) return true
    return "command" in config && Boolean(config.command) && "extensions" in config && Boolean(config.extensions)
  })
  return ok ? undefined : "For custom LSP servers, 'command' and 'extensions' are required."
})

export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)]).check(
  requiresCustomServerDetails,
)
