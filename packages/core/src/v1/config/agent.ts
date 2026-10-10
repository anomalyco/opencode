export * as ConfigAgentV1 from "./agent.js"

import { Schema, SchemaGetter } from "effect"
import { PositiveInt } from "../../schema.js"
import { ConfigPermissionV1 } from "./permission.js"

export const ThemeColorNames = ["primary", "secondary", "accent", "success", "warning", "error", "info"] as const

// V1 accepted theme color names for an agent `color`; V2 only accepts hex. Resolve legacy names to
// the default theme's hex so agents that used them keep loading instead of being dropped or greyed out.
export const ThemeColorHex: Record<(typeof ThemeColorNames)[number], string> = {
  primary: "#fab283",
  secondary: "#5c9cf5",
  accent: "#9d7cd8",
  success: "#7fd88f",
  warning: "#f5a742",
  error: "#e06c75",
  info: "#56b6c2",
}

export function resolveThemeColor(color: string) {
  return color in ThemeColorHex ? ThemeColorHex[color as (typeof ThemeColorNames)[number]] : color
}

const Color = Schema.Union([
  Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  Schema.Literals([...ThemeColorNames]),
])

const AgentSchema = Schema.StructWithRest(
  Schema.Struct({
    model: Schema.optional(Schema.String),
    variant: Schema.optional(Schema.String).annotate({
      description: "Default model variant for this agent (applies only when using the agent's configured model).",
    }),
    temperature: Schema.optional(Schema.Finite),
    top_p: Schema.optional(Schema.Finite),
    prompt: Schema.optional(Schema.String),
    tools: Schema.optional(ConfigPermissionV1.Entries(Schema.Boolean)).annotate({
      description: "@deprecated Use 'permission' field instead",
    }),
    disable: Schema.optional(Schema.Boolean),
    description: Schema.optional(Schema.String).annotate({ description: "Description of when to use the agent" }),
    mode: Schema.optional(Schema.Literals(["subagent", "primary", "all"])),
    hidden: Schema.optional(Schema.Boolean).annotate({
      description: "Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)",
    }),
    options: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
    color: Schema.optional(Color).annotate({
      description: "Hex color code (e.g., #FF5733) or theme color (e.g., primary)",
    }),
    steps: Schema.optional(PositiveInt).annotate({
      description: "Maximum number of agentic iterations before forcing text-only response",
    }),
    maxSteps: Schema.optional(PositiveInt).annotate({ description: "@deprecated Use 'steps' field instead." }),
    permission: Schema.optional(ConfigPermissionV1.Info),
  }),
  [Schema.Record(Schema.String, Schema.Any)],
)

const KNOWN_KEYS = new Set(["name", ...Object.keys(AgentSchema.schema.fields)])

const normalize = (agent: Schema.Schema.Type<typeof AgentSchema>): Schema.Schema.Type<typeof AgentSchema> => {
  const options: Record<string, unknown> = { ...agent.options }
  for (const [key, value] of Object.entries(agent)) {
    if (!KNOWN_KEYS.has(key)) options[key] = value
  }

  // A Map keeps each key's first position when a later entry overrides it, like Object.assign.
  const permission = new Map<string, ConfigPermissionV1.Rule>()
  for (const [tool, enabled] of agent.tools ?? []) {
    const action = enabled ? "allow" : "deny"
    permission.set(tool === "write" || tool === "patch" ? "edit" : tool, action)
  }
  for (const [key, rule] of agent.permission ?? []) permission.set(key, rule)

  const steps = agent.steps ?? agent.maxSteps
  return { ...agent, options, permission: [...permission], ...(steps !== undefined ? { steps } : {}) }
}

export const Info = AgentSchema.pipe(
  Schema.decodeTo(Schema.toType(AgentSchema), {
    decode: SchemaGetter.transform(normalize),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
).annotate({ identifier: "AgentConfig" })
export type Info = Schema.Schema.Type<typeof Info>
