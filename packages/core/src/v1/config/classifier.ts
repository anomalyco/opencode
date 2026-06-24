export * as ConfigClassifierV1 from "./classifier"

import { Schema } from "effect"

/**
 * Which backend evaluates gated tool calls.
 * - `own`: the user's configured model (default; zero extra dependency).
 * - `og-local`: a locally-served OpenGuardrails model over HTTP (e.g. Ollama).
 * - `og-saas`: the OpenGuardrails hosted API.
 */
export const Backend = Schema.Literals(["own", "og-local", "og-saas"]).annotate({
  identifier: "ClassifierBackend",
})
export type Backend = Schema.Schema.Type<typeof Backend>

/**
 * `classifier` config — an LLM "auto mode" command-approval classifier (after
 * Claude Code's auto mode). Gates what would otherwise auto-approve; never
 * overrides an explicit user `deny`/`ask`.
 */
export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable the LLM command-approval classifier. Off by default.",
  }),
  backend: Schema.optional(Backend).annotate({
    description: "Which classifier backend to use. Defaults to 'own' (the user's configured model).",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model for backend='own' as provider/model (e.g. anthropic/claude-haiku-4-5). Defaults to the main model.",
  }),
  endpoint: Schema.optional(Schema.String).annotate({
    description: "HTTP endpoint for backend='og-local' (e.g. http://localhost:11434).",
  }),
  apiKey: Schema.optional(Schema.String).annotate({
    description: "API key for backend='og-saas'.",
  }),
  twoStage: Schema.optional(Schema.Boolean).annotate({
    description: "Run a fast single-token pass, then a chain-of-thought pass only on blocks. backend='own' only.",
  }),
  environment: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Prose descriptions of trusted infrastructure. Anything outside is treated as exfiltration risk.",
  }),
  allow: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Exceptions to the block rules. A provided list replaces the whole default list (copy-then-edit).",
  }),
  soft_deny: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Block rules. A provided list replaces the whole default list (copy-then-edit).",
  }),
}).annotate({ identifier: "ClassifierConfig" })
export type Info = Schema.Schema.Type<typeof Info>
