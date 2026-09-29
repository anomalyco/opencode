export * as ConfigHitlV1 from "./hitl"

import { Schema } from "effect"

export const Level = Schema.Literals(["AUTO", "SAFE", "BALANCED", "STRICT", "CUSTOM"]).annotate({
  identifier: "HumanInTheLoopLevel",
  description:
    "Human-in-the-loop confirmation level. AUTO grants maximum autonomy within permissions, SAFE confirms destructive actions, BALANCED confirms moderate-risk actions, STRICT confirms almost every relevant action, and CUSTOM follows only the configured policy.",
})
export type Level = Schema.Schema.Type<typeof Level>

export const Risk = Schema.Literals(["readonly", "routine", "moderate", "destructive"]).annotate({
  identifier: "HumanInTheLoopRisk",
  description: "Risk classification assigned to an operation before confirmation levels are evaluated.",
})
export type Risk = Schema.Schema.Type<typeof Risk>

export const Action = Schema.Literals(["allow", "ask"]).annotate({
  identifier: "HumanInTheLoopAction",
  description: "Confirmation decision produced by a human-in-the-loop policy rule.",
})
export type Action = Schema.Schema.Type<typeof Action>

export const Rule = Schema.Struct({
  tool: Schema.optional(Schema.String).annotate({ description: 'Tool name glob, for example "bash"' }),
  file: Schema.optional(Schema.String).annotate({ description: "File glob matched against the requested pattern" }),
  directory: Schema.optional(Schema.String).annotate({
    description: "Directory glob matched against the requested pattern and paths under it",
  }),
  command: Schema.optional(Schema.String).annotate({
    description: "Command glob matched against the full command line",
  }),
  agent: Schema.optional(Schema.String).annotate({ description: "Agent name glob" }),
  provider: Schema.optional(Schema.String).annotate({ description: "Provider ID glob" }),
  workspace: Schema.optional(Schema.String).annotate({
    description: "Workspace glob matched against the session worktree",
  }),
  operation: Schema.optional(Schema.String).annotate({ description: 'Permission glob, for example "bash" or "edit"' }),
  risk: Schema.optional(Risk).annotate({ description: "Risk level the operation must classify as" }),
  action: Action,
}).annotate({ identifier: "HumanInTheLoopRule" })
export type Rule = Schema.Schema.Type<typeof Rule>

export const Info = Schema.Struct({
  level: Schema.optional(Level).annotate({ description: "Confirmation level. Defaults to AUTO." }),
  policy: Schema.optional(Schema.mutable(Schema.Array(Rule))).annotate({
    description: "Policy rules evaluated before the level threshold; the last matching rule wins.",
  }),
}).annotate({ identifier: "HumanInTheLoopConfig" })
export type Info = Schema.Schema.Type<typeof Info>
