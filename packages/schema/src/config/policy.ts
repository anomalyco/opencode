export * as ConfigPolicy from "./policy.js"

import { Schema, SchemaGetter } from "effect"

export const Effect = Schema.Literals(["allow", "deny"])
export type Effect = typeof Effect.Type

/**
 * - `provider.use`: resource is a provider ID.
 * - `tool.use`: resource is `<tool>:<input>`, such as `shell:git *`.
 * - `integration.connect`: resource is an integration ID; controls which integrations can be listed and connected.
 * - `integration.use`: resource is `<integration>#<account>`, or the bare integration ID when the providers, models,
 *   web search, MCP servers, or config an integration supplies come from no account (env keys, local config, the
 *   signed-out free tier).
 * - `mcp.use`, `skill.use`, `plugin.use`: resource is an MCP server name, skill ID, or plugin target.
 */
export const Action = Schema.Literals([
  "provider.use",
  "tool.use",
  "integration.connect",
  "integration.use",
  "mcp.use",
  "skill.use",
  "plugin.use",
])
export type Action = typeof Action.Type

const Statement = Schema.Struct({
  action: Action,
  resource: Schema.String,
  effect: Effect,
})

// Before `mcp.use`, `skill.use` and `plugin.use` existed, `integration.use` covered them with a resource prefix.
// Every policy source decodes through this schema, so this is the only place that knows the legacy form. Only prefixed
// resources convert: a bare `integration.use` `*` keeps its action and now covers providers and accounts.
const legacy = new Map<string, Action>([
  ["mcp", "mcp.use"],
  ["skill", "skill.use"],
  ["plugin", "plugin.use"],
])

export const Info = Statement.pipe(
  Schema.decodeTo(Schema.toType(Statement), {
    decode: SchemaGetter.transform((policy) => {
      if (policy.action !== "integration.use") return policy
      const separator = policy.resource.indexOf(":")
      const action = separator === -1 ? undefined : legacy.get(policy.resource.slice(0, separator))
      if (!action) return policy
      return { ...policy, action, resource: policy.resource.slice(separator + 1) }
    }),
    encode: SchemaGetter.passthrough(),
  }),
)
export type Info = typeof Info.Type
