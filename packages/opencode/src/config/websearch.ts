export * as ConfigWebSearch from "./websearch"
import { Schema } from "effect"

// Per-provider configuration. Every field is optional so users can override only
// specific knobs on a built-in provider (e.g. `{ "exa": { "enabled": true } }`)
// or fully define a new provider by supplying `url` + `tool` (+ optionally
// `args`, `headers`, `label`, `weight`).
export const Provider = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable this websearch provider. Built-in providers (exa, parallel) are disabled by default.",
  }),
  label: Schema.optional(Schema.String).annotate({
    description: "Display label shown in the UI. Defaults to a label derived from the provider id.",
  }),
  url: Schema.optional(Schema.String).annotate({
    description:
      "MCP endpoint URL (HTTP JSON-RPC `tools/call`). Supports `{env:NAME}` substitution. Required for user-defined providers.",
  }),
  tool: Schema.optional(Schema.String).annotate({
    description: "MCP tool name to invoke. Required for user-defined providers.",
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Optional headers to send with each request. Supports `{env:NAME}` substitution in values.",
  }),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description:
      "Mapping from normalized tool parameters to the MCP tool arguments. String values support `{query}`, `{numResults}`, `{type}`, `{livecrawl}`, `{contextMaxCharacters}`, `{sessionID}` placeholders. Required for user-defined providers.",
  }),
  weight: Schema.optional(Schema.Number).annotate({
    description:
      "Relative weight for deterministic per-session selection across enabled providers. Defaults to 1. Must be a positive integer.",
  }),
}).annotate({ identifier: "WebSearchProviderConfig" })
export type Provider = Schema.Schema.Type<typeof Provider>

export const Info = Schema.Struct({
  default: Schema.optional(Schema.String).annotate({
    description:
      "Default provider id to use when more than one provider is enabled. Overridden by the `OPENCODE_WEBSEARCH_PROVIDER` environment variable.",
  }),
  providers: Schema.optional(Schema.Record(Schema.String, Provider)).annotate({
    description:
      "Map of websearch providers keyed by id. Entries for built-in ids (exa, parallel) deep-merge over the built-in descriptor; any other key defines a new provider.",
  }),
}).annotate({ identifier: "WebSearchConfig" })
export type Info = Schema.Schema.Type<typeof Info>
