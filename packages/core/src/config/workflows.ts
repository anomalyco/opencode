export * as ConfigWorkflows from "./workflows"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

const Models = Schema.Struct({
  planner: Schema.String.pipe(Schema.optional),
  worker: Schema.String.pipe(Schema.optional),
  writer: Schema.String.pipe(Schema.optional),
  synthesizer: Schema.String.pipe(Schema.optional),
})

export class Heavy extends Schema.Class<Heavy>("ConfigV2.Workflows.Heavy")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  council: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Run one Council review before the root Heavy synthesis",
  }),
  max_depth: PositiveInt.pipe(Schema.optional),
  tasks_per_node: PositiveInt.pipe(Schema.optional),
  max_nodes: PositiveInt.pipe(Schema.optional),
  concurrency: PositiveInt.pipe(Schema.optional),
  child_timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum runtime in milliseconds for one Heavy child session",
  }),
  mutation: Schema.Literal("serial").pipe(Schema.optional),
  on_failure: Schema.Literals(["keep", "stop"]).pipe(Schema.optional),
  models: Models.pipe(Schema.optional),
}) {}

export class Debate extends Schema.Class<Debate>("ConfigV2.Workflows.Debate")({
  mode: Schema.Literals(["auto", "always", "off"]).pipe(Schema.optional),
  topics: PositiveInt.pipe(Schema.optional),
  participants: PositiveInt.pipe(Schema.optional),
  rounds: PositiveInt.pipe(Schema.optional),
}) {}

export class Council extends Schema.Class<Council>("ConfigV2.Workflows.Council")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  perspectives: PositiveInt.pipe(Schema.optional),
  concurrency: PositiveInt.pipe(Schema.optional),
  child_timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum runtime in milliseconds for one Council child session",
  }),
  debate: Debate.pipe(Schema.optional),
  models: Schema.Struct({
    planner: Schema.String.pipe(Schema.optional),
    perspective: Schema.String.pipe(Schema.optional),
    debater: Schema.String.pipe(Schema.optional),
    synthesizer: Schema.String.pipe(Schema.optional),
  }).pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Workflows")({
  heavy: Schema.Union([Schema.Boolean, Heavy]).pipe(Schema.optional),
  council: Schema.Union([Schema.Boolean, Council]).pipe(Schema.optional),
}) {}

export function merge(inputs: ReadonlyArray<Info | undefined>): Info | undefined {
  const configured = inputs.filter((input): input is Info => input !== undefined)
  if (configured.length === 0) return undefined
  return Info.make({
    heavy: configured.reduce<boolean | Heavy | undefined>(
      (previous, input) => mergeHeavy(previous, input.heavy),
      undefined,
    ),
    council: configured.reduce<boolean | Council | undefined>(
      (previous, input) => mergeCouncil(previous, input.council),
      undefined,
    ),
  })
}

function mergeHeavy(previous: boolean | Heavy | undefined, next: boolean | Heavy | undefined) {
  if (next === undefined) return previous
  if (typeof next === "boolean" || typeof previous !== "object") return next
  return Heavy.make({
    enabled: next.enabled ?? previous.enabled,
    council: next.council ?? previous.council,
    max_depth: next.max_depth ?? previous.max_depth,
    tasks_per_node: next.tasks_per_node ?? previous.tasks_per_node,
    max_nodes: next.max_nodes ?? previous.max_nodes,
    concurrency: next.concurrency ?? previous.concurrency,
    child_timeout: next.child_timeout ?? previous.child_timeout,
    mutation: next.mutation ?? previous.mutation,
    on_failure: next.on_failure ?? previous.on_failure,
    models: next.models ? { ...previous.models, ...next.models } : previous.models,
  })
}

function mergeCouncil(previous: boolean | Council | undefined, next: boolean | Council | undefined) {
  if (next === undefined) return previous
  if (typeof next === "boolean" || typeof previous !== "object") return next
  return Council.make({
    enabled: next.enabled ?? previous.enabled,
    perspectives: next.perspectives ?? previous.perspectives,
    concurrency: next.concurrency ?? previous.concurrency,
    child_timeout: next.child_timeout ?? previous.child_timeout,
    debate: next.debate
      ? Debate.make({
          mode: next.debate.mode ?? previous.debate?.mode,
          topics: next.debate.topics ?? previous.debate?.topics,
          participants: next.debate.participants ?? previous.debate?.participants,
          rounds: next.debate.rounds ?? previous.debate?.rounds,
        })
      : previous.debate,
    models: next.models ? { ...previous.models, ...next.models } : previous.models,
  })
}
