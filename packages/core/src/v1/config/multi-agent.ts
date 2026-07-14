export * as ConfigMultiAgentV1 from "./multi-agent"

import { Effect, Schema } from "effect"
import { NonNegativeInt, type DeepMutable } from "../../schema"

export const Team = Schema.Struct({
  agents: Schema.Array(Schema.String).annotate({
    description: "Names of agents to include in the team",
  }),
  mode: Schema.Literals(["parallel", "pipeline", "supervisor"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("parallel" as const)),
  ).annotate({
    description: "Team execution mode: parallel (all at once), pipeline (sequential), supervisor (one agent coordinates)",
  }),
  prompt: Schema.String.annotate({ description: "Task prompt for the team" }),
  supervisor: Schema.optional(Schema.String).annotate({
    description: "Agent name to use as supervisor (only in supervisor mode)",
  }),
})

export const Info = Schema.Struct({
  defaultMode: Schema.optional(Schema.Literals(["parallel", "pipeline", "supervisor"])).annotate({
    description: "Default team execution mode (default: parallel)",
  }),
  maxAgents: Schema.optional(NonNegativeInt).annotate({
    description: "Maximum number of agents allowed in a team (default: 3)",
  }),
  team: Schema.optional(Schema.Record(Schema.String, Team)).annotate({
    description: "Predefined team configurations",
  }),
}).annotate({ identifier: "MultiAgentConfig" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>
