export * as WorkflowSchema from "./schema"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"
import { SessionSchema } from "../session/schema"

export const Status = Schema.Literals(["completed", "partial", "failed"])
export type Status = typeof Status.Type

export const Capability = Schema.Literals(["read", "write"])
export type Capability = typeof Capability.Type

export const Finding = Schema.Struct({
  claim: Schema.String,
  evidence: Schema.Array(Schema.String),
})
export type Finding = typeof Finding.Type

export const HeavyTask = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  objective: Schema.String,
  capability: Capability,
  mode: Schema.Literals(["leaf", "recurse"]),
  depends_on: Schema.Array(Schema.String),
})
export type HeavyTask = typeof HeavyTask.Type

export const HeavyPlan = Schema.Struct({
  rationale: Schema.String,
  tasks: Schema.Array(HeavyTask),
})
export type HeavyPlan = typeof HeavyPlan.Type

export const HeavyNodeResult = Schema.Struct({
  status: Status,
  summary: Schema.String,
  decisions: Schema.Array(Schema.String),
  findings: Schema.Array(Finding),
  changed_files: Schema.Array(Schema.String),
  validation: Schema.Array(Schema.String),
  risks: Schema.Array(Schema.String),
  follow_up: Schema.Array(Schema.String),
})
export type HeavyNodeResult = typeof HeavyNodeResult.Type

export const HeavyNode = Schema.Struct({
  id: Schema.String,
  parent_id: Schema.String.pipe(Schema.optional),
  session_id: SessionSchema.ID,
  depth: NonNegativeInt,
  title: Schema.String,
  objective: Schema.String,
  capability: Capability,
  status: Status,
  summary: Schema.String,
  decisions: Schema.Array(Schema.String),
  findings: Schema.Array(Finding),
  changed_files: Schema.Array(Schema.String),
  validation: Schema.Array(Schema.String),
  risks: Schema.Array(Schema.String),
  follow_up: Schema.Array(Schema.String),
})
export type HeavyNode = typeof HeavyNode.Type

export const HeavyOutput = Schema.Struct({
  workflow: Schema.Literal("heavy"),
  status: Status,
  summary: Schema.String,
  root_session_id: SessionSchema.ID,
  nodes: Schema.Array(HeavyNode),
})
export type HeavyOutput = typeof HeavyOutput.Type

export const Stance = Schema.Literals(["support", "oppose", "conditional", "uncertain"])
export type Stance = typeof Stance.Type

export const CouncilPerspectiveSpec = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  instructions: Schema.String,
})
export type CouncilPerspectiveSpec = typeof CouncilPerspectiveSpec.Type

export const CouncilTopic = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
})
export type CouncilTopic = typeof CouncilTopic.Type

export const CouncilPlan = Schema.Struct({
  rationale: Schema.String,
  issues: Schema.Array(CouncilTopic),
  perspectives: Schema.Array(CouncilPerspectiveSpec),
})
export type CouncilPlan = typeof CouncilPlan.Type

export const CouncilIssue = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  stance: Stance,
  rationale: Schema.String,
  evidence: Schema.Array(Schema.String),
})
export type CouncilIssue = typeof CouncilIssue.Type

const CouncilPerspectiveFields = {
  perspective_id: Schema.String,
  summary: Schema.String,
  issues: Schema.Array(CouncilIssue),
  recommendations: Schema.Array(Schema.String),
  risks: Schema.Array(Schema.String),
}

export const CouncilPerspectiveResult = Schema.Struct(CouncilPerspectiveFields)
export type CouncilPerspectiveResult = typeof CouncilPerspectiveResult.Type

export const CouncilPerspective = Schema.Struct({
  ...CouncilPerspectiveFields,
  session_id: SessionSchema.ID,
})
export type CouncilPerspective = typeof CouncilPerspective.Type

const DebateContributionFields = {
  issue_id: Schema.String,
  perspective_id: Schema.String,
  round: PositiveInt,
  stance: Stance,
  argument: Schema.String,
  concessions: Schema.Array(Schema.String),
  rebuttals: Schema.Array(Schema.String),
  evidence: Schema.Array(Schema.String),
}

export const DebateResult = Schema.Struct(DebateContributionFields)
export type DebateResult = typeof DebateResult.Type

export const DebateContribution = Schema.Struct({
  ...DebateContributionFields,
  session_id: SessionSchema.ID,
})
export type DebateContribution = typeof DebateContribution.Type

export const CouncilSynthesis = Schema.Struct({
  status: Status,
  summary: Schema.String,
  consensus: Schema.Array(Schema.String),
  disagreements: Schema.Array(
    Schema.Struct({
      issue_id: Schema.String,
      question: Schema.String,
      positions: Schema.Array(Schema.String),
    }),
  ),
  recommendations: Schema.Array(Schema.String),
  risks: Schema.Array(Schema.String),
})
export type CouncilSynthesis = typeof CouncilSynthesis.Type

export const CouncilOutput = Schema.Struct({
  workflow: Schema.Literal("council"),
  status: Status,
  summary: Schema.String,
  root_session_id: SessionSchema.ID,
  perspectives: Schema.Array(CouncilPerspective),
  debate: Schema.Array(DebateContribution),
  consensus: Schema.Array(Schema.String),
  disagreements: Schema.Array(
    Schema.Struct({
      issue_id: Schema.String,
      question: Schema.String,
      positions: Schema.Array(Schema.String),
    }),
  ),
  recommendations: Schema.Array(Schema.String),
  risks: Schema.Array(Schema.String),
})
export type CouncilOutput = typeof CouncilOutput.Type
