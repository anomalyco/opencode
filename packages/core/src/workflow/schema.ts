export * as WorkflowSchema from "./schema"

import { Schema, SchemaGetter } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"
import { SessionSchema } from "../session/schema"

const Summary = Schema.String.check(Schema.isMaxLength(2_000))
const Detail = Schema.String.check(Schema.isMaxLength(500))
const Evidence = Schema.String.check(Schema.isMaxLength(750))
const Details = Schema.Array(Detail).check(Schema.isMaxLength(6))
const Sources = Schema.Array(Evidence).check(Schema.isMaxLength(4))

const TextObject = Schema.Record(Schema.String, Schema.Unknown)
const TextInput = Schema.Union([Schema.String, TextObject])
const SummaryInput = TextInput.pipe(
  Schema.decodeTo(Summary, {
    decode: SchemaGetter.transform((value) => normalizeText(value, 2_000)),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
const DetailInput = TextInput.pipe(
  Schema.decodeTo(Detail, {
    decode: SchemaGetter.transform((value) => normalizeText(value, 500)),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
const EvidenceInput = TextInput.pipe(
  Schema.decodeTo(Evidence, {
    decode: SchemaGetter.transform((value) => normalizeText(value, 750)),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
const DetailsInput = Schema.Union([DetailInput, Schema.Array(DetailInput)]).pipe(
  Schema.decodeTo(Details, {
    decode: SchemaGetter.transform((value) => (Array.isArray(value) ? value : [value]).slice(0, 6)),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
const OptionalDetailsInput = DetailsInput.pipe(Schema.optional)
const SourcesInput = Schema.Union([EvidenceInput, Schema.Array(EvidenceInput)]).pipe(
  Schema.decodeTo(Sources, {
    decode: SchemaGetter.transform((value) => (Array.isArray(value) ? value : [value]).slice(0, 4)),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
const OptionalSourcesInput = SourcesInput.pipe(Schema.optional)
const FindingInput = Schema.Union([
  Schema.Struct({
    claim: DetailInput.pipe(Schema.optional),
    finding: DetailInput.pipe(Schema.optional),
    summary: DetailInput.pipe(Schema.optional),
    evidence: OptionalSourcesInput,
  }),
  DetailInput,
])
const FindingSubmission = FindingInput.pipe(
  Schema.decodeTo(Schema.Struct({ claim: Detail, evidence: Sources }), {
    decode: SchemaGetter.transform((value) =>
      typeof value === "string"
        ? { claim: value, evidence: [] }
        : {
            claim: value.claim ?? value.finding ?? value.summary ?? "Unlabeled finding",
            evidence: value.evidence ?? [],
          },
    ),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)

export const Status = Schema.Literals(["completed", "partial", "failed"])
export type Status = typeof Status.Type

export const ExecutionStatus = Schema.Literals(["completed", "partial", "failed"])
export type ExecutionStatus = typeof ExecutionStatus.Type

export const ArtifactStatus = Schema.Literals(["available", "partial", "missing"])
export type ArtifactStatus = typeof ArtifactStatus.Type

export const Capability = Schema.Literals(["read", "write"])
export type Capability = typeof Capability.Type

export const RunTiming = Schema.Struct({
  started_at: NonNegativeInt,
  completed_at: NonNegativeInt,
  elapsed_ms: NonNegativeInt,
})
export type RunTiming = typeof RunTiming.Type

export const Usage = Schema.Struct({
  input: NonNegativeInt,
  output: NonNegativeInt,
  reasoning: NonNegativeInt,
  cache_read: NonNegativeInt,
  cache_write: NonNegativeInt,
  cost: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  cost_status: Schema.Literals(["reported", "unavailable"]),
  scope: Schema.Literal("child_sessions").pipe(Schema.optional),
})
export type Usage = typeof Usage.Type

export const Delegation = Schema.Struct({
  id: Schema.String,
  parent_id: Schema.String.pipe(Schema.optional),
  parent_session_id: SessionSchema.ID,
  workflow: Schema.Literals(["heavy", "council", "research"]),
  depth: PositiveInt,
  objective: Schema.String,
  status: Status,
  execution_status: ExecutionStatus.pipe(Schema.optional),
  artifact_status: ArtifactStatus.pipe(Schema.optional),
  evidence_status: Status.pipe(Schema.optional),
  summary: Schema.String,
  root_session_id: SessionSchema.ID,
  session_ids: Schema.Array(SessionSchema.ID).pipe(Schema.optional),
  report_path: Schema.String,
  timing: RunTiming.pipe(Schema.optional),
})
export type Delegation = typeof Delegation.Type

export const SourceObservation = Schema.Struct({
  url: Schema.String,
  verification: Schema.Literals(["verified", "unverified", "failed"]),
  method: Schema.Literals(["direct", "search"]).pipe(Schema.optional),
})
export type SourceObservation = typeof SourceObservation.Type

export const SessionStage = Schema.Struct({
  session_id: SessionSchema.ID,
  parent_session_id: SessionSchema.ID.pipe(Schema.optional),
  run_id: Schema.String,
  parent_run_id: Schema.String.pipe(Schema.optional),
  workflow: Schema.Literals(["heavy", "council", "research"]),
  workflow_depth: NonNegativeInt,
  status: Schema.Literals(["queued", "running", "completed", "failed", "timed_out"]),
  activity: Schema.Literals(["queued", "provider_active", "waiting_on_delegation", "recovering"]).pipe(Schema.optional),
  agent: Schema.String,
  title: Schema.String,
  stage: Schema.String,
  node_depth: NonNegativeInt.pipe(Schema.optional),
  node_id: Schema.String.pipe(Schema.optional),
  parent_node_id: Schema.String.pipe(Schema.optional),
  capability: Capability.pipe(Schema.optional),
  depends_on: Schema.Array(Schema.String).pipe(Schema.optional),
  issue: Schema.String.pipe(Schema.optional),
  round: PositiveInt.pipe(Schema.optional),
  report_path: Schema.String.pipe(Schema.optional),
  prompt_bytes: NonNegativeInt.pipe(Schema.optional),
  started_at: NonNegativeInt,
  active_at: NonNegativeInt.pipe(Schema.optional),
  updated_at: NonNegativeInt,
  elapsed_ms: NonNegativeInt,
  queue_ms: NonNegativeInt.pipe(Schema.optional),
  waiting_ms: NonNegativeInt.pipe(Schema.optional),
  active_ms: NonNegativeInt.pipe(Schema.optional),
  recovery_attempts: NonNegativeInt.pipe(Schema.optional),
  tool_calls: NonNegativeInt.pipe(Schema.optional),
  tool_errors: NonNegativeInt.pipe(Schema.optional),
  usage: Usage.pipe(Schema.optional),
  sources: Schema.Array(SourceObservation).pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
})
export type SessionStage = typeof SessionStage.Type

export const SourceReference = Schema.Struct({
  url: Schema.String,
  report_paths: Schema.Array(Schema.String),
  kind: Schema.Literals(["primary", "secondary", "unknown"]).pipe(Schema.optional),
  verification: Schema.Literals(["verified", "unverified", "failed"]).pipe(Schema.optional),
  direct_checks: NonNegativeInt.pipe(Schema.optional),
  search_discoveries: NonNegativeInt.pipe(Schema.optional),
})
export type SourceReference = typeof SourceReference.Type

export const Finding = Schema.Struct({
  claim: Schema.String,
  evidence: Schema.Array(Schema.String),
})
export type Finding = typeof Finding.Type

export const ArtifactCoverage = Schema.Struct({
  artifact_id: Schema.String.pipe(Schema.optional),
  title: Schema.String,
  report_path: Schema.String.pipe(Schema.optional),
  received: Schema.Boolean,
  used: Schema.Array(Schema.String),
  rejected: Schema.Array(Schema.String),
  unresolved: Schema.Array(Schema.String),
})
export type ArtifactCoverage = typeof ArtifactCoverage.Type

const ArtifactCoverageInput = Schema.Struct({
  artifact_id: Schema.String.pipe(Schema.optional),
  title: DetailInput.pipe(Schema.optional),
  report_path: Schema.String.pipe(Schema.optional),
  used: OptionalDetailsInput,
  rejected: OptionalDetailsInput,
  unresolved: OptionalDetailsInput,
})

export const HeavyRelationship = Schema.Literals(["partition", "corroborate", "challenge", "integrate"])
export type HeavyRelationship = typeof HeavyRelationship.Type

export const CouncilSignal = Schema.Literals([
  "competing_objectives",
  "high_uncertainty",
  "conflicting_evidence",
  "consequential_decision",
  "assumption_sensitive",
  "multiple_interpretations",
  "worker_requested",
])
export type CouncilSignal = typeof CouncilSignal.Type

export const CouncilRequest = Schema.Struct({
  recommended: Schema.Boolean,
  reason: Schema.String,
  question: Schema.String.pipe(Schema.optional),
  signals: Schema.Array(CouncilSignal),
})
export type CouncilRequest = typeof CouncilRequest.Type

const CouncilRequestInput = Schema.Struct({
  recommended: Schema.Boolean.pipe(Schema.optional),
  reason: SummaryInput.pipe(Schema.optional),
  question: SummaryInput.pipe(Schema.optional),
  signals: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
})

export const CouncilRouting = Schema.Struct({
  mode: Schema.Literals(["auto", "synthesis", "required", "always", "off"]),
  outcome: Schema.Literals(["triggered", "not_triggered", "disabled", "unavailable", "failed"]),
  reason: Schema.String,
  question: Schema.String.pipe(Schema.optional),
  signals: Schema.Array(CouncilSignal),
})
export type CouncilRouting = typeof CouncilRouting.Type

export const HeavyTask = Schema.Struct({
  id: Schema.String,
  title: Detail,
  objective: Schema.String.check(Schema.isMaxLength(2_000)),
  capability: Capability,
  mode: Schema.Literals(["leaf", "recurse"]),
  depends_on: Schema.Array(Schema.String).check(Schema.isMaxLength(8)),
  relationship: HeavyRelationship.pipe(Schema.optional),
  contribution: Detail.pipe(Schema.optional),
  exclusions: Details.pipe(Schema.optional),
})
export type HeavyTask = typeof HeavyTask.Type

export const HeavyPlan = Schema.Struct({
  rationale: Summary,
  tasks: Schema.Array(HeavyTask).check(Schema.isMaxLength(8)),
  council: CouncilRequest.pipe(Schema.optional),
})
export type HeavyPlan = typeof HeavyPlan.Type

const HeavyTaskInput = Schema.Struct({
  id: Schema.String.pipe(Schema.optional),
  title: DetailInput.pipe(Schema.optional),
  objective: SummaryInput.pipe(Schema.optional),
  capability: Schema.String.pipe(Schema.optional),
  mode: Schema.String.pipe(Schema.optional),
  depends_on: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  relationship: Schema.String.pipe(Schema.optional),
  contribution: DetailInput.pipe(Schema.optional),
  exclusions: OptionalDetailsInput,
})

export const HeavyPlanSubmission = Schema.Struct({
  rationale: SummaryInput.pipe(Schema.optional),
  tasks: Schema.Array(HeavyTaskInput).pipe(Schema.optional),
  council: CouncilRequestInput.pipe(Schema.optional),
}).pipe(
  Schema.decodeTo(HeavyPlan, {
    decode: SchemaGetter.transform((value) => ({
      rationale: value.rationale ?? "The planner submitted no rationale.",
      ...(value.council ? { council: normalizeCouncilRequest(value.council) } : {}),
      tasks: (value.tasks ?? []).slice(0, 8).map((task, index) => {
        const objective = task.objective ?? task.title ?? `Complete task ${index + 1}`
        return {
          id: task.id?.trim() || `task-${index + 1}`,
          title: task.title ?? clip(objective, 500),
          objective,
          capability: normalizeCapability(task.capability, objective),
          mode: normalizeMode(task.mode),
          depends_on: Array.from(
            new Set(
              task.depends_on === undefined ? [] : Array.isArray(task.depends_on) ? task.depends_on : [task.depends_on],
            ),
          ).slice(0, 8),
          relationship: normalizeRelationship(task.relationship),
          contribution: task.contribution ?? clip(objective, 500),
          exclusions: task.exclusions ?? [],
        }
      }),
    })),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
export type HeavyPlanSubmission = typeof HeavyPlanSubmission.Type

export const HeavyNodeResult = Schema.Struct({
  status: Status,
  summary: Schema.String,
  decisions: Schema.Array(Schema.String),
  findings: Schema.Array(Finding),
  changed_files: Schema.Array(Schema.String),
  validation: Schema.Array(Schema.String),
  risks: Schema.Array(Schema.String),
  follow_up: Schema.Array(Schema.String),
  coverage: Schema.Array(ArtifactCoverage).pipe(Schema.optional),
  council_request: CouncilRequest.pipe(Schema.optional),
})
export type HeavyNodeResult = typeof HeavyNodeResult.Type

export const HeavyNodeSubmission = Schema.Struct({
  status: Schema.String.pipe(Schema.optional),
  summary: SummaryInput.pipe(Schema.optional),
  decisions: OptionalDetailsInput,
  findings: Schema.Union([FindingSubmission, Schema.Array(FindingSubmission)]).pipe(Schema.optional),
  changed_files: Schema.Union([DetailInput, Schema.Array(DetailInput)]).pipe(Schema.optional),
  validation: OptionalDetailsInput,
  risks: OptionalDetailsInput,
  follow_up: OptionalDetailsInput,
  coverage: Schema.Array(ArtifactCoverageInput).pipe(Schema.optional),
  council_request: CouncilRequestInput.pipe(Schema.optional),
}).pipe(
  Schema.decodeTo(HeavyNodeResult, {
    decode: SchemaGetter.transform((value) => ({
      status: normalizeStatus(value.status),
      summary: value.summary ?? "The stage submitted no summary.",
      decisions: value.decisions ?? [],
      findings: (value.findings === undefined
        ? []
        : Array.isArray(value.findings)
          ? value.findings
          : [value.findings]
      ).slice(0, 6),
      changed_files: (value.changed_files === undefined
        ? []
        : Array.isArray(value.changed_files)
          ? value.changed_files
          : [value.changed_files]
      ).slice(0, 12),
      validation: value.validation ?? [],
      risks: value.risks ?? [],
      follow_up: value.follow_up ?? [],
      ...(value.coverage
        ? {
            coverage: value.coverage.map((entry) => ({
              artifact_id: entry.artifact_id,
              title: entry.title ?? entry.artifact_id ?? entry.report_path ?? "Unidentified artifact",
              report_path: entry.report_path,
              received: true,
              used: entry.used ?? [],
              rejected: entry.rejected ?? [],
              unresolved: entry.unresolved ?? [],
            })),
          }
        : {}),
      ...(value.council_request ? { council_request: normalizeCouncilRequest(value.council_request) } : {}),
    })),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
export type HeavyNodeSubmission = typeof HeavyNodeSubmission.Type

export const HeavyPlanTaskRecord = Schema.Struct({
  id: Schema.String,
  node_id: Schema.String.pipe(Schema.optional),
  title: Schema.String,
  disposition: Schema.Literals(["executed", "replaced", "capped", "blocked", "fallback"]),
  status: Status.pipe(Schema.optional),
  reason: Schema.String.pipe(Schema.optional),
  session_id: SessionSchema.ID.pipe(Schema.optional),
  report_path: Schema.String.pipe(Schema.optional),
  relationship: HeavyRelationship.pipe(Schema.optional),
  contribution: Schema.String.pipe(Schema.optional),
  exclusions: Schema.Array(Schema.String).pipe(Schema.optional),
})
export type HeavyPlanTaskRecord = typeof HeavyPlanTaskRecord.Type

export const HeavyNode = Schema.Struct({
  id: Schema.String,
  parent_id: Schema.String.pipe(Schema.optional),
  session_id: SessionSchema.ID,
  planning_session_id: SessionSchema.ID.pipe(Schema.optional),
  depth: NonNegativeInt,
  title: Schema.String,
  objective: Schema.String,
  capability: Capability,
  report_path: Schema.String.pipe(Schema.optional),
  status: Status,
  summary: Schema.String,
  decisions: Schema.Array(Schema.String),
  findings: Schema.Array(Finding),
  changed_files: Schema.Array(Schema.String),
  validation: Schema.Array(Schema.String),
  risks: Schema.Array(Schema.String),
  follow_up: Schema.Array(Schema.String),
  coverage: Schema.Array(ArtifactCoverage).pipe(Schema.optional),
  plan: Schema.Array(HeavyPlanTaskRecord).pipe(Schema.optional),
  council_routing: CouncilRouting.pipe(Schema.optional),
})
export type HeavyNode = typeof HeavyNode.Type

export const Stance = Schema.Literals(["support", "oppose", "conditional", "uncertain"])
export type Stance = typeof Stance.Type

export const CouncilPerspectiveSpec = Schema.Struct({
  id: Schema.String,
  title: Detail,
  instructions: Summary,
})
export type CouncilPerspectiveSpec = typeof CouncilPerspectiveSpec.Type

export const CouncilTopic = Schema.Struct({
  id: Schema.String,
  question: Detail,
})
export type CouncilTopic = typeof CouncilTopic.Type

export const CouncilPlan = Schema.Struct({
  rationale: Summary,
  issues: Schema.Array(CouncilTopic).check(Schema.isMaxLength(8)),
  perspectives: Schema.Array(CouncilPerspectiveSpec).check(Schema.isMaxLength(8)),
})
export type CouncilPlan = typeof CouncilPlan.Type

const CouncilTopicInput = Schema.Union([
  Schema.Struct({
    id: Schema.String.pipe(Schema.optional),
    question: DetailInput.pipe(Schema.optional),
  }),
  DetailInput,
])
const CouncilPerspectiveSpecInput = Schema.Union([
  Schema.Struct({
    id: Schema.String.pipe(Schema.optional),
    title: DetailInput.pipe(Schema.optional),
    instructions: SummaryInput.pipe(Schema.optional),
  }),
  DetailInput,
])

export const CouncilPlanSubmission = Schema.Struct({
  rationale: SummaryInput.pipe(Schema.optional),
  issues: Schema.Union([CouncilTopicInput, Schema.Array(CouncilTopicInput)]).pipe(Schema.optional),
  perspectives: Schema.Union([CouncilPerspectiveSpecInput, Schema.Array(CouncilPerspectiveSpecInput)]).pipe(
    Schema.optional,
  ),
}).pipe(
  Schema.decodeTo(CouncilPlan, {
    decode: SchemaGetter.transform((value) => ({
      rationale: value.rationale ?? "The planner submitted no rationale.",
      issues: normalizeArray(value.issues)
        .slice(0, 8)
        .map((issue, index) =>
          typeof issue === "string"
            ? { id: `issue-${index + 1}`, question: issue }
            : {
                id: issue.id?.trim() || `issue-${index + 1}`,
                question: issue.question ?? `Issue ${index + 1}`,
              },
        ),
      perspectives: normalizeArray(value.perspectives)
        .slice(0, 8)
        .map((perspective, index) =>
          typeof perspective === "string"
            ? {
                id: `perspective-${index + 1}`,
                title: perspective,
                instructions: `Analyze the question from the ${perspective} perspective.`,
              }
            : {
                id: perspective.id?.trim() || `perspective-${index + 1}`,
                title: perspective.title ?? `Perspective ${index + 1}`,
                instructions: perspective.instructions ?? `Analyze the question from perspective ${index + 1}.`,
              },
        ),
    })),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
export type CouncilPlanSubmission = typeof CouncilPlanSubmission.Type

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

const CouncilIssueInput = Schema.Struct({
  id: Schema.String.pipe(Schema.optional),
  question: DetailInput.pipe(Schema.optional),
  stance: Schema.String.pipe(Schema.optional),
  rationale: SummaryInput.pipe(Schema.optional),
  evidence: OptionalSourcesInput,
})

export const CouncilPerspectiveSubmission = Schema.Struct({
  perspective_id: Schema.String.pipe(Schema.optional),
  summary: SummaryInput.pipe(Schema.optional),
  issues: Schema.Union([CouncilIssueInput, Schema.Array(CouncilIssueInput)]).pipe(Schema.optional),
  recommendations: OptionalDetailsInput,
  risks: OptionalDetailsInput,
}).pipe(
  Schema.decodeTo(CouncilPerspectiveResult, {
    decode: SchemaGetter.transform((value) => ({
      perspective_id: value.perspective_id ?? "perspective",
      summary: value.summary ?? "This perspective submitted no summary.",
      issues: normalizeArray(value.issues)
        .slice(0, 8)
        .map((issue, index) => ({
          id: issue.id ?? `issue-${index + 1}`,
          question: issue.question ?? `Issue ${index + 1}`,
          stance: normalizeStance(issue.stance),
          rationale: issue.rationale ?? "No rationale was submitted.",
          evidence: issue.evidence ?? [],
        })),
      recommendations: value.recommendations ?? [],
      risks: value.risks ?? [],
    })),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
export type CouncilPerspectiveSubmission = typeof CouncilPerspectiveSubmission.Type

export const CouncilPerspective = Schema.Struct({
  ...CouncilPerspectiveFields,
  session_id: SessionSchema.ID,
  report_path: Schema.String.pipe(Schema.optional),
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

export const DebateSubmission = Schema.Struct({
  issue_id: Schema.String.pipe(Schema.optional),
  perspective_id: Schema.String.pipe(Schema.optional),
  round: Schema.Number.pipe(Schema.optional),
  stance: Schema.String.pipe(Schema.optional),
  argument: SummaryInput.pipe(Schema.optional),
  concessions: OptionalDetailsInput,
  rebuttals: OptionalDetailsInput,
  evidence: OptionalSourcesInput,
}).pipe(
  Schema.decodeTo(DebateResult, {
    decode: SchemaGetter.transform((value) => ({
      issue_id: value.issue_id ?? "issue",
      perspective_id: value.perspective_id ?? "perspective",
      round: Math.max(1, Math.floor(value.round ?? 1)),
      stance: normalizeStance(value.stance),
      argument: value.argument ?? "No argument was submitted.",
      concessions: value.concessions ?? [],
      rebuttals: value.rebuttals ?? [],
      evidence: value.evidence ?? [],
    })),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
export type DebateSubmission = typeof DebateSubmission.Type

export const DebateContribution = Schema.Struct({
  ...DebateContributionFields,
  session_id: SessionSchema.ID,
  report_path: Schema.String.pipe(Schema.optional),
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
  coverage: Schema.Array(ArtifactCoverage).pipe(Schema.optional),
})
export type CouncilSynthesis = typeof CouncilSynthesis.Type

const DisagreementInput = Schema.Struct({
  issue_id: Schema.String.pipe(Schema.optional),
  question: DetailInput.pipe(Schema.optional),
  positions: OptionalDetailsInput,
})

export const CouncilSynthesisSubmission = Schema.Struct({
  status: Schema.String.pipe(Schema.optional),
  summary: SummaryInput.pipe(Schema.optional),
  consensus: OptionalDetailsInput,
  disagreements: Schema.Union([DisagreementInput, Schema.Array(DisagreementInput)]).pipe(Schema.optional),
  recommendations: OptionalDetailsInput,
  risks: OptionalDetailsInput,
  coverage: Schema.Array(ArtifactCoverageInput).pipe(Schema.optional),
}).pipe(
  Schema.decodeTo(CouncilSynthesis, {
    decode: SchemaGetter.transform((value) => ({
      status: normalizeStatus(value.status),
      summary: value.summary ?? "The Council submitted no synthesis summary.",
      consensus: value.consensus ?? [],
      disagreements: normalizeArray(value.disagreements)
        .slice(0, 8)
        .map((disagreement, index) => ({
          issue_id: disagreement.issue_id ?? `issue-${index + 1}`,
          question: disagreement.question ?? `Issue ${index + 1}`,
          positions: disagreement.positions ?? [],
        })),
      recommendations: value.recommendations ?? [],
      risks: value.risks ?? [],
      ...(value.coverage
        ? {
            coverage: value.coverage.map((entry) => ({
              artifact_id: entry.artifact_id,
              title: entry.title ?? entry.artifact_id ?? entry.report_path ?? "Unidentified artifact",
              report_path: entry.report_path,
              received: true,
              used: entry.used ?? [],
              rejected: entry.rejected ?? [],
              unresolved: entry.unresolved ?? [],
            })),
          }
        : {}),
    })),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
export type CouncilSynthesisSubmission = typeof CouncilSynthesisSubmission.Type

export const CouncilOutput = Schema.Struct({
  workflow: Schema.Literal("council"),
  status: Status,
  execution_status: ExecutionStatus.pipe(Schema.optional),
  artifact_status: ArtifactStatus.pipe(Schema.optional),
  evidence_status: Status.pipe(Schema.optional),
  summary: Schema.String,
  final_response: Schema.String.pipe(Schema.optional),
  usage: Usage.pipe(Schema.optional),
  timing: RunTiming.pipe(Schema.optional),
  root_session_id: SessionSchema.ID,
  synthesis_session_id: SessionSchema.ID,
  synthesis_report_path: Schema.String.pipe(Schema.optional),
  report_path: Schema.String.pipe(Schema.optional),
  source_manifest: Schema.Array(Schema.String).pipe(Schema.optional),
  source_provenance: Schema.Array(SourceReference).pipe(Schema.optional),
  session_manifest: Schema.Array(SessionStage).pipe(Schema.optional),
  delegations: Schema.Array(Delegation).pipe(Schema.optional),
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
  coverage: Schema.Array(ArtifactCoverage).pipe(Schema.optional),
})
export type CouncilOutput = typeof CouncilOutput.Type

export const HeavyOutput = Schema.Struct({
  workflow: Schema.Literal("heavy"),
  status: Status,
  execution_status: ExecutionStatus.pipe(Schema.optional),
  artifact_status: ArtifactStatus.pipe(Schema.optional),
  evidence_status: Status.pipe(Schema.optional),
  summary: Schema.String,
  final_response: Schema.String.pipe(Schema.optional),
  usage: Usage.pipe(Schema.optional),
  timing: RunTiming.pipe(Schema.optional),
  root_session_id: SessionSchema.ID,
  report_path: Schema.String.pipe(Schema.optional),
  source_manifest: Schema.Array(Schema.String).pipe(Schema.optional),
  source_provenance: Schema.Array(SourceReference).pipe(Schema.optional),
  session_manifest: Schema.Array(SessionStage).pipe(Schema.optional),
  delegations: Schema.Array(Delegation).pipe(Schema.optional),
  nodes: Schema.Array(HeavyNode),
  council: CouncilOutput.pipe(Schema.optional),
})
export type HeavyOutput = typeof HeavyOutput.Type

export const ResearchPriority = Schema.Literals(["critical", "material", "background"])
export type ResearchPriority = typeof ResearchPriority.Type

export const ResearchTaskRole = Schema.Literals(["evidence", "critic", "recursive"])
export type ResearchTaskRole = typeof ResearchTaskRole.Type

export const ResearchTask = Schema.Struct({
  id: Schema.String,
  title: Detail,
  question: Schema.String.check(Schema.isMaxLength(2_000)),
  priority: ResearchPriority,
  role: ResearchTaskRole,
  mode: Schema.Literals(["leaf", "recurse"]),
  depends_on: Schema.Array(Schema.String).check(Schema.isMaxLength(8)),
  rationale: Detail,
  expected_evidence: Details,
  subquestions: Details.pipe(Schema.optional),
  evidence_methods: Details.pipe(Schema.optional),
  exclusions: Details.pipe(Schema.optional),
  decision_relevance: Detail.pipe(Schema.optional),
  decomposition_reason: Detail.pipe(Schema.optional),
})
export type ResearchTask = typeof ResearchTask.Type

export const ResearchContract = Schema.Struct({
  rationale: Summary,
  objective: Schema.String,
  deliverables: Details,
  assumptions: Details,
  unknowns: Details,
  falsifiers: Details,
  tasks: Schema.Array(ResearchTask).check(Schema.isMaxLength(8)),
  flat_rationale: Detail.pipe(Schema.optional),
})
export type ResearchContract = typeof ResearchContract.Type

const ResearchTaskInput = Schema.Struct({
  id: Schema.String.pipe(Schema.optional),
  title: DetailInput.pipe(Schema.optional),
  question: SummaryInput.pipe(Schema.optional),
  objective: SummaryInput.pipe(Schema.optional),
  priority: Schema.Literals(["critical", "material", "background", "high", "medium", "low"]).pipe(Schema.optional),
  role: ResearchTaskRole.pipe(Schema.optional),
  mode: Schema.Literals(["leaf", "recurse", "atomic", "compound", "recursive", "deep"]).pipe(Schema.optional),
  depends_on: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  rationale: DetailInput.pipe(Schema.optional),
  expected_evidence: OptionalDetailsInput,
  subquestions: OptionalDetailsInput,
  evidence_methods: OptionalDetailsInput,
  exclusions: OptionalDetailsInput,
  decision_relevance: DetailInput.pipe(Schema.optional),
  decomposition_reason: DetailInput.pipe(Schema.optional),
})

export const ResearchContractSubmission = Schema.Struct({
  rationale: SummaryInput.pipe(Schema.optional),
  objective: SummaryInput.pipe(Schema.optional),
  deliverables: OptionalDetailsInput,
  assumptions: OptionalDetailsInput,
  unknowns: OptionalDetailsInput,
  falsifiers: OptionalDetailsInput,
  tasks: Schema.Array(ResearchTaskInput).pipe(Schema.optional),
  flat_rationale: DetailInput.pipe(Schema.optional),
}).pipe(
  Schema.decodeTo(ResearchContract, {
    decode: SchemaGetter.transform((value) => ({
      rationale: value.rationale ?? value.flat_rationale ?? "The planner submitted no research rationale.",
      objective: value.objective ?? "Complete the research objective.",
      deliverables: value.deliverables ?? [],
      assumptions: value.assumptions ?? [],
      unknowns: value.unknowns ?? [],
      falsifiers: value.falsifiers ?? [],
      flat_rationale: value.flat_rationale,
      tasks: (value.tasks ?? [])
        .slice(0, 8)
        .map((task, index) => normalizeResearchTask(task, index, "question", "Investigate question")),
    })),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
export type ResearchContractSubmission = typeof ResearchContractSubmission.Type

export const ResearchEvidence = Schema.Struct({
  id: Schema.String,
  summary: Schema.String,
  claim_ids: Schema.Array(Schema.String),
  stance: Schema.Literals(["support", "challenge", "context"]),
  source_type: Schema.Literals(["primary", "secondary", "observation", "calculation", "artifact", "unknown"]),
  verification: Schema.Literals(["verified", "unverified", "failed", "not_applicable"]),
  url: Schema.String.pipe(Schema.optional),
  report_path: Schema.String.pipe(Schema.optional),
  published_at: Schema.String.pipe(Schema.optional),
  checked_at: Schema.String.pipe(Schema.optional),
  limitation: Schema.String.pipe(Schema.optional),
})
export type ResearchEvidence = typeof ResearchEvidence.Type

export const ResearchClaim = Schema.Struct({
  id: Schema.String,
  statement: Schema.String,
  kind: Schema.Literals(["fact", "inference", "estimate", "recommendation"]),
  status: Schema.Literals(["supported", "contested", "uncertain", "refuted"]),
  confidence: Schema.Literals(["high", "medium", "low"]),
  evidence_ids: Schema.Array(Schema.String),
  contradicts: Schema.Array(Schema.String),
  assumptions: Schema.Array(Schema.String),
  derived_from_claim_ids: Schema.Array(Schema.String).pipe(Schema.optional),
  supersedes_claim_ids: Schema.Array(Schema.String).pipe(Schema.optional),
  resolves_gap_ids: Schema.Array(Schema.String).pipe(Schema.optional),
  resolves_dispute_ids: Schema.Array(Schema.String).pipe(Schema.optional),
})
export type ResearchClaim = typeof ResearchClaim.Type

export const ResearchGap = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  priority: ResearchPriority,
  status: Schema.Literals(["open", "addressed", "deferred"]),
  reason: Schema.String,
})
export type ResearchGap = typeof ResearchGap.Type

export const ResearchDispute = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  claim_ids: Schema.Array(Schema.String),
  priority: ResearchPriority,
  consequential: Schema.Boolean,
  reason: Schema.String,
  status: Schema.Literals(["open", "debated", "resolved", "deferred"]),
  resolution: Schema.String.pipe(Schema.optional),
  council_report_path: Schema.String.pipe(Schema.optional),
  debate_profile: Schema.Literals(["compact", "full"]).pipe(Schema.optional),
})
export type ResearchDispute = typeof ResearchDispute.Type

const ResearchEvidenceInput = Schema.Struct({
  id: Schema.String.pipe(Schema.optional),
  summary: SummaryInput.pipe(Schema.optional),
  claim_ids: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  stance: Schema.String.pipe(Schema.optional),
  source_type: Schema.Literals([
    "primary",
    "secondary",
    "observation",
    "calculation",
    "artifact",
    "unknown",
    "primary_source",
    "secondary_source",
    "official",
    "authoritative",
    "literature",
    "review",
    "observed",
    "empirical",
    "computed",
    "model",
    "repository",
    "workspace",
    "document",
  ]).pipe(Schema.optional),
  verification: Schema.Literals(["verified", "unverified", "failed", "not_applicable"]).pipe(Schema.optional),
  url: Schema.String.pipe(Schema.optional),
  report_path: Schema.String.pipe(Schema.optional),
  published_at: Schema.String.pipe(Schema.optional),
  checked_at: Schema.String.pipe(Schema.optional),
  limitation: DetailInput.pipe(Schema.optional),
})

const ResearchClaimInput = Schema.Struct({
  id: Schema.String.pipe(Schema.optional),
  statement: SummaryInput.pipe(Schema.optional),
  claim: SummaryInput.pipe(Schema.optional),
  kind: Schema.String.pipe(Schema.optional),
  status: Schema.String.pipe(Schema.optional),
  confidence: Schema.String.pipe(Schema.optional),
  evidence_ids: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  contradicts: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  assumptions: OptionalDetailsInput,
  derived_from_claim_ids: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  supersedes_claim_ids: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  resolves_gap_ids: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  resolves_dispute_ids: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
})

const ResearchGapInput = Schema.Struct({
  id: Schema.String.pipe(Schema.optional),
  question: SummaryInput.pipe(Schema.optional),
  priority: Schema.String.pipe(Schema.optional),
  status: Schema.String.pipe(Schema.optional),
  reason: SummaryInput.pipe(Schema.optional),
})

const ResearchDisputeInput = Schema.Struct({
  id: Schema.String.pipe(Schema.optional),
  question: SummaryInput.pipe(Schema.optional),
  claim_ids: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  priority: Schema.String.pipe(Schema.optional),
  consequential: Schema.Boolean.pipe(Schema.optional),
  reason: SummaryInput.pipe(Schema.optional),
  status: Schema.String.pipe(Schema.optional),
  resolution: SummaryInput.pipe(Schema.optional),
  council_report_path: Schema.String.pipe(Schema.optional),
  debate_profile: Schema.Literals(["compact", "full"]).pipe(Schema.optional),
})

export const ResearchDeliverableCoverage = Schema.Struct({
  deliverable: Schema.String,
  status: Schema.Literals(["complete", "partial", "missing"]),
  report_section: Schema.String.pipe(Schema.optional),
  claim_ids: Schema.Array(Schema.String),
  limitations: Schema.Array(Schema.String),
})
export type ResearchDeliverableCoverage = typeof ResearchDeliverableCoverage.Type

const ResearchDeliverableCoverageInput = Schema.Struct({
  deliverable: SummaryInput,
  status: Schema.Literals(["complete", "partial", "missing"]).pipe(Schema.optional),
  report_section: SummaryInput.pipe(Schema.optional),
  claim_ids: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  limitations: OptionalDetailsInput,
})

export const ResearchBranchResult = Schema.Struct({
  status: Status,
  summary: Schema.String,
  claims: Schema.Array(ResearchClaim),
  evidence: Schema.Array(ResearchEvidence),
  gaps: Schema.Array(ResearchGap),
  disputes: Schema.Array(ResearchDispute),
  assumptions: Schema.Array(Schema.String),
  conclusions: Schema.Array(Schema.String),
  recommendations: Schema.Array(Schema.String),
  limitations: Schema.Array(Schema.String),
  coverage: Schema.Array(ArtifactCoverage).pipe(Schema.optional),
  deliverable_coverage: Schema.Array(ResearchDeliverableCoverage).pipe(Schema.optional),
})
export type ResearchBranchResult = typeof ResearchBranchResult.Type

export const ResearchBranchSubmission = Schema.Struct({
  status: Schema.String.pipe(Schema.optional),
  summary: SummaryInput.pipe(Schema.optional),
  claims: Schema.Union([ResearchClaimInput, Schema.Array(ResearchClaimInput)]).pipe(Schema.optional),
  evidence: Schema.Union([ResearchEvidenceInput, Schema.Array(ResearchEvidenceInput)]).pipe(Schema.optional),
  gaps: Schema.Union([ResearchGapInput, Schema.Array(ResearchGapInput)]).pipe(Schema.optional),
  disputes: Schema.Union([ResearchDisputeInput, Schema.Array(ResearchDisputeInput)]).pipe(Schema.optional),
  assumptions: OptionalDetailsInput,
  conclusions: OptionalDetailsInput,
  recommendations: OptionalDetailsInput,
  limitations: OptionalDetailsInput,
  coverage: Schema.Array(ArtifactCoverageInput).pipe(Schema.optional),
  deliverable_coverage: Schema.Array(ResearchDeliverableCoverageInput).pipe(Schema.optional),
}).pipe(
  Schema.decodeTo(ResearchBranchResult, {
    decode: SchemaGetter.transform((value) => ({
      status: normalizeStatus(value.status),
      summary: value.summary ?? "The research stage submitted no summary.",
      claims: normalizeArray(value.claims)
        .slice(0, 24)
        .map((claim, index) => ({
          id: claim.id?.trim() || `claim-${index + 1}`,
          statement: claim.statement ?? claim.claim ?? `Unlabeled claim ${index + 1}`,
          kind: normalizeClaimKind(claim.kind),
          status: normalizeClaimStatus(claim.status),
          confidence: normalizeConfidence(claim.confidence),
          evidence_ids: normalizeStringArray(claim.evidence_ids, 24),
          contradicts: normalizeStringArray(claim.contradicts, 12),
          assumptions: claim.assumptions ?? [],
          derived_from_claim_ids: normalizeStringArray(claim.derived_from_claim_ids, 24),
          supersedes_claim_ids: normalizeStringArray(claim.supersedes_claim_ids, 24),
          resolves_gap_ids: normalizeStringArray(claim.resolves_gap_ids, 24),
          resolves_dispute_ids: normalizeStringArray(claim.resolves_dispute_ids, 24),
        })),
      evidence: normalizeArray(value.evidence)
        .slice(0, 32)
        .map((evidence, index) => ({
          id: evidence.id?.trim() || `evidence-${index + 1}`,
          summary: evidence.summary ?? `Unlabeled evidence ${index + 1}`,
          claim_ids: normalizeStringArray(evidence.claim_ids, 24),
          stance: normalizeEvidenceStance(evidence.stance),
          source_type: normalizeSourceType(evidence.source_type),
          verification: normalizeVerification(evidence.verification),
          url: evidence.url,
          report_path: evidence.report_path,
          published_at: evidence.published_at,
          checked_at: evidence.checked_at,
          limitation: evidence.limitation,
        })),
      gaps: normalizeArray(value.gaps)
        .slice(0, 16)
        .map((gap, index) => ({
          id: gap.id?.trim() || `gap-${index + 1}`,
          question: gap.question ?? `Unresolved question ${index + 1}`,
          priority: normalizeResearchPriority(gap.priority),
          status: normalizeGapStatus(gap.status),
          reason: gap.reason ?? "The research stage did not supply a reason.",
        })),
      disputes: normalizeArray(value.disputes)
        .slice(0, 12)
        .map((dispute, index) => ({
          id: dispute.id?.trim() || `dispute-${index + 1}`,
          question: dispute.question ?? `Disputed question ${index + 1}`,
          claim_ids: normalizeStringArray(dispute.claim_ids, 12),
          priority: normalizeResearchPriority(dispute.priority),
          consequential: dispute.consequential ?? false,
          reason: dispute.reason ?? "The research stage did not supply a reason.",
          status: normalizeDisputeStatus(dispute.status),
          resolution: dispute.resolution,
          council_report_path: dispute.council_report_path,
          debate_profile: dispute.debate_profile,
        })),
      assumptions: value.assumptions ?? [],
      conclusions: value.conclusions ?? [],
      recommendations: value.recommendations ?? [],
      limitations: value.limitations ?? [],
      ...(value.deliverable_coverage
        ? {
            deliverable_coverage: value.deliverable_coverage.map((item) => ({
              deliverable: item.deliverable,
              status: item.status ?? "missing",
              report_section: item.report_section,
              claim_ids: normalizeStringArray(item.claim_ids, 24),
              limitations: item.limitations ?? [],
            })),
          }
        : {}),
      ...(value.coverage
        ? {
            coverage: value.coverage.map((entry) => ({
              artifact_id: entry.artifact_id,
              title: entry.title ?? entry.artifact_id ?? entry.report_path ?? "Unidentified artifact",
              report_path: entry.report_path,
              received: true,
              used: entry.used ?? [],
              rejected: entry.rejected ?? [],
              unresolved: entry.unresolved ?? [],
            })),
          }
        : {}),
    })),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
export type ResearchBranchSubmission = typeof ResearchBranchSubmission.Type

export const ResearchDeliverableAssessment = Schema.Struct({
  deliverable: Schema.String,
  status: Schema.Literals(["covered", "partial", "missing", "empirical_only"]),
  reason: Schema.String,
})
export type ResearchDeliverableAssessment = typeof ResearchDeliverableAssessment.Type

export const ResearchAssessment = Schema.Struct({
  decision: Schema.Literals(["continue", "stop"]),
  stop_reason: Schema.Literals([
    "evidence_saturated",
    "requires_empirical_work",
    "budget_exhausted",
    "blocked",
    "low_information_gain",
  ]).pipe(Schema.optional),
  rationale: Summary,
  information_gain: Schema.Literals(["high", "medium", "low"]),
  coverage: Schema.Literals(["complete", "adequate", "incomplete"]),
  addressed_gap_ids: Schema.Array(Schema.String),
  tasks: Schema.Array(ResearchTask).check(Schema.isMaxLength(8)),
  disputes: Schema.Array(ResearchDispute).check(Schema.isMaxLength(8)),
  deferred_validations: Details.pipe(Schema.optional),
  deliverable_coverage: Schema.Array(ResearchDeliverableAssessment),
})
export type ResearchAssessment = typeof ResearchAssessment.Type

export const ResearchAssessmentSubmission = Schema.Struct({
  decision: Schema.Literals(["continue", "stop"]),
  stop_reason: Schema.Literals([
    "evidence_saturated",
    "requires_empirical_work",
    "budget_exhausted",
    "blocked",
    "low_information_gain",
  ]).pipe(Schema.optional),
  rationale: SummaryInput.pipe(Schema.optional),
  information_gain: Schema.Literals(["high", "medium", "low"]),
  coverage: Schema.Literals(["complete", "adequate", "incomplete"]),
  addressed_gap_ids: Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(Schema.optional),
  tasks: Schema.Array(ResearchTaskInput).pipe(Schema.optional),
  disputes: Schema.Array(ResearchDisputeInput).pipe(Schema.optional),
  deferred_validations: OptionalDetailsInput,
  deliverable_coverage: Schema.Array(ResearchDeliverableAssessment),
}).pipe(
  Schema.decodeTo(ResearchAssessment, {
    decode: SchemaGetter.transform((value) => ({
      decision: value.decision,
      stop_reason:
        value.decision === "continue"
          ? undefined
          : (value.stop_reason ?? (value.information_gain === "low" ? "low_information_gain" : "evidence_saturated")),
      rationale: value.rationale ?? "The assessor submitted no rationale.",
      information_gain: value.information_gain,
      coverage: value.coverage,
      addressed_gap_ids: normalizeStringArray(value.addressed_gap_ids, 24),
      tasks: (value.tasks ?? [])
        .slice(0, 8)
        .map((task, index) => normalizeResearchTask(task, index, "follow-up", "Investigate follow-up")),
      disputes: (value.disputes ?? []).slice(0, 8).map((dispute, index) => ({
        id: dispute.id?.trim() || `dispute-${index + 1}`,
        question: dispute.question ?? `Disputed question ${index + 1}`,
        claim_ids: normalizeStringArray(dispute.claim_ids, 12),
        priority: normalizeResearchPriority(dispute.priority),
        consequential: dispute.consequential ?? false,
        reason: dispute.reason ?? "The assessor did not supply a reason.",
        status: normalizeDisputeStatus(dispute.status),
        resolution: dispute.resolution,
        council_report_path: dispute.council_report_path,
        debate_profile: dispute.debate_profile,
      })),
      deferred_validations: value.deferred_validations ?? [],
      deliverable_coverage: value.deliverable_coverage,
    })),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
export type ResearchAssessmentSubmission = typeof ResearchAssessmentSubmission.Type

export const ResearchTaskRecord = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  question: Schema.String,
  priority: ResearchPriority,
  role: ResearchTaskRole,
  mode: Schema.Literals(["leaf", "recurse"]),
  depends_on: Schema.Array(Schema.String).pipe(Schema.optional),
  status: Status,
  session_id: SessionSchema.ID,
  report_path: Schema.String.pipe(Schema.optional),
  node_id: Schema.String.pipe(Schema.optional),
  artifact_id: Schema.String.pipe(Schema.optional),
  reused: Schema.Boolean,
  reserved_subtree_slots: NonNegativeInt.pipe(Schema.optional),
  decomposition_reason: Detail.pipe(Schema.optional),
})
export type ResearchTaskRecord = typeof ResearchTaskRecord.Type

export const ResearchWave = Schema.Struct({
  number: PositiveInt,
  rationale: Schema.String,
  tasks: Schema.Array(ResearchTaskRecord),
  assessment_session_id: SessionSchema.ID,
  assessment: ResearchAssessment,
  stop_code: Schema.Literals([
    "evidence_saturated",
    "requires_empirical_work",
    "budget_exhausted",
    "blocked",
    "low_information_gain",
  ]).pipe(Schema.optional),
  stop_reason: Schema.String.pipe(Schema.optional),
})
export type ResearchWave = typeof ResearchWave.Type

export const ResearchNode = Schema.Struct({
  id: Schema.String,
  parent_id: Schema.String.pipe(Schema.optional),
  depth: NonNegativeInt,
  title: Schema.String,
  objective: Schema.String,
  planning_session_id: SessionSchema.ID,
  synthesis_session_id: SessionSchema.ID,
  synthesis_status: Schema.Literals(["completed", "failed", "skipped"]).pipe(Schema.optional),
  report_path: Schema.String.pipe(Schema.optional),
  budget_allocated: NonNegativeInt.pipe(Schema.optional),
  budget_unused: NonNegativeInt.pipe(Schema.optional),
  contract: ResearchContract,
  waves: Schema.Array(ResearchWave),
  result: ResearchBranchResult,
})
export type ResearchNode = typeof ResearchNode.Type

export const ResearchCouncilReview = Schema.Struct({
  dispute_id: Schema.String,
  dispute_ids: Schema.Array(Schema.String).pipe(Schema.optional),
  node_id: Schema.String,
  question: Schema.String,
  profile: Schema.Literals(["compact", "full"]).pipe(Schema.optional),
  output: CouncilOutput,
})
export type ResearchCouncilReview = typeof ResearchCouncilReview.Type

export const ResearchGraph = Schema.Struct({
  claims: Schema.Array(ResearchClaim),
  evidence: Schema.Array(ResearchEvidence),
  gaps: Schema.Array(ResearchGap),
  disputes: Schema.Array(ResearchDispute),
  assumptions: Schema.Array(Schema.String),
})
export type ResearchGraph = typeof ResearchGraph.Type

export const ResearchRoleEvaluation = Schema.Struct({
  agent: Schema.String,
  sessions: NonNegativeInt,
  failed_sessions: NonNegativeInt,
  tool_calls: NonNegativeInt,
  tool_errors: NonNegativeInt,
  usage: Usage,
})
export type ResearchRoleEvaluation = typeof ResearchRoleEvaluation.Type

export const ResearchEvaluation = Schema.Struct({
  report_words: NonNegativeInt,
  report_sections: NonNegativeInt,
  standalone_pass: Schema.Boolean,
  claims: NonNegativeInt,
  supported_claims: NonNegativeInt,
  traceable_supported_claims: NonNegativeInt,
  evidence_records: NonNegativeInt,
  verified_sources: NonNegativeInt,
  open_critical_gaps: NonNegativeInt,
  consequential_disputes: NonNegativeInt,
  council_reviews: NonNegativeInt,
  evidence_tasks: NonNegativeInt,
  reused_artifacts: NonNegativeInt,
  recursive_branches: NonNegativeInt.pipe(Schema.optional),
  productive_recursive_branches: NonNegativeInt.pipe(Schema.optional),
  synthesis_only_branches: NonNegativeInt.pipe(Schema.optional),
  branch_syntheses: NonNegativeInt.pipe(Schema.optional),
  evidence_leaves: NonNegativeInt.pipe(Schema.optional),
  critic_tasks: NonNegativeInt.pipe(Schema.optional),
  max_evidence_depth: NonNegativeInt.pipe(Schema.optional),
  max_branch_depth: NonNegativeInt.pipe(Schema.optional),
  dependent_tasks: NonNegativeInt.pipe(Schema.optional),
  root_budget_slots: NonNegativeInt.pipe(Schema.optional),
  root_unused_slots: NonNegativeInt.pipe(Schema.optional),
  coverage_complete: Schema.Boolean,
  deliverables_total: NonNegativeInt.pipe(Schema.optional),
  deliverables_complete: NonNegativeInt.pipe(Schema.optional),
  deliverables_partial: NonNegativeInt.pipe(Schema.optional),
  deliverables_missing: NonNegativeInt.pipe(Schema.optional),
  total_sessions: NonNegativeInt.pipe(Schema.optional),
  failed_sessions: NonNegativeInt.pipe(Schema.optional),
  delegated_workflows: NonNegativeInt.pipe(Schema.optional),
  council_sessions: NonNegativeInt.pipe(Schema.optional),
  council_invocations: NonNegativeInt.pipe(Schema.optional),
  nested_council_invocations: NonNegativeInt.pipe(Schema.optional),
  tool_calls: NonNegativeInt.pipe(Schema.optional),
  tool_errors: NonNegativeInt.pipe(Schema.optional),
  cited_sources: NonNegativeInt.pipe(Schema.optional),
  verified_citations: NonNegativeInt.pipe(Schema.optional),
  unverified_citations: NonNegativeInt.pipe(Schema.optional),
  usage: Usage.pipe(Schema.optional),
  roles: Schema.Array(ResearchRoleEvaluation).pipe(Schema.optional),
})
export type ResearchEvaluation = typeof ResearchEvaluation.Type

export const ResearchOutput = Schema.Struct({
  workflow: Schema.Literal("research"),
  status: Status,
  execution_status: ExecutionStatus.pipe(Schema.optional),
  artifact_status: ArtifactStatus.pipe(Schema.optional),
  evidence_status: Status.pipe(Schema.optional),
  summary: Schema.String,
  final_response: Schema.String.pipe(Schema.optional),
  usage: Usage.pipe(Schema.optional),
  timing: RunTiming.pipe(Schema.optional),
  root_session_id: SessionSchema.ID,
  report_path: Schema.String.pipe(Schema.optional),
  trace_path: Schema.String.pipe(Schema.optional),
  graph_path: Schema.String.pipe(Schema.optional),
  raw_graph_path: Schema.String.pipe(Schema.optional),
  source_manifest: Schema.Array(Schema.String).pipe(Schema.optional),
  source_provenance: Schema.Array(SourceReference).pipe(Schema.optional),
  session_manifest: Schema.Array(SessionStage).pipe(Schema.optional),
  delegations: Schema.Array(Delegation).pipe(Schema.optional),
  nodes: Schema.Array(ResearchNode),
  raw_graph: ResearchGraph.pipe(Schema.optional),
  graph: ResearchGraph,
  evaluation: ResearchEvaluation,
  councils: Schema.Array(ResearchCouncilReview),
})
export type ResearchOutput = typeof ResearchOutput.Type

function normalizeText(value: string | Readonly<Record<string, unknown>>, maxLength: number) {
  if (typeof value === "string") return clip(value, maxLength)
  if (typeof value.decision === "string")
    return clip(
      `${value.decision}${typeof value.basis === "string" && value.basis ? ` — ${value.basis}` : ""}`,
      maxLength,
    )
  const text = Object.entries(value)
    .flatMap(([key, item]) => {
      if (item === undefined || item === null || item === "") return []
      return [`${key.replaceAll("_", " ")}: ${formatValue(item)}`]
    })
    .join(" — ")
  return clip(text || "No detail supplied.", maxLength)
}

function formatValue(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value) ?? String(value)
}

function clip(value: string, maxLength: number) {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`
}

function normalizeArray<Value>(value: Value | ReadonlyArray<Value> | undefined): ReadonlyArray<Value>
function normalizeArray(value: unknown): ReadonlyArray<unknown> {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function normalizeStatus(value: string | undefined): Status {
  if (value === "failed") return "failed"
  if (value === "partial" || value === "incomplete") return "partial"
  return "completed"
}

function normalizeCapability(value: string | undefined, objective: string): Capability {
  if (value === "write") return "write"
  if (value === "read") return "read"
  return /\b(add|apply|build|change|create|delete|edit|fix|format|generate|implement|install|migrate|modify|patch|refactor|remove|rename|replace|run|test|update|validate|write)\b/i.test(
    objective,
  )
    ? "write"
    : "read"
}

function normalizeMode(value: string | undefined): HeavyTask["mode"] {
  if (value && /^(recurse|recursive|deep|heavy|compound)$/i.test(value)) return "recurse"
  return "leaf"
}

function normalizeResearchTask(
  task: typeof ResearchTaskInput.Type,
  index: number,
  idPrefix: string,
  questionPrefix: string,
) {
  const question = task.question ?? task.objective ?? task.title ?? `${questionPrefix} ${index + 1}`
  const role = task.role ?? (normalizeMode(task.mode) === "recurse" ? "recursive" : "evidence")
  return {
    id: task.id?.trim() || `${idPrefix}-${index + 1}`,
    title: task.title ?? clip(question, 500),
    question,
    priority: normalizeResearchPriority(task.priority),
    role,
    mode: role === "recursive" ? ("recurse" as const) : ("leaf" as const),
    depends_on: Array.from(
      new Set(
        task.depends_on === undefined ? [] : Array.isArray(task.depends_on) ? task.depends_on : [task.depends_on],
      ),
    ).slice(0, 8),
    rationale: task.rationale ?? clip(question, 500),
    expected_evidence: task.expected_evidence ?? [],
    subquestions: task.subquestions ?? [],
    evidence_methods: task.evidence_methods ?? [],
    exclusions: task.exclusions ?? [],
    decision_relevance: task.decision_relevance ?? task.rationale,
    decomposition_reason: task.decomposition_reason ?? task.rationale,
  }
}

function normalizeRelationship(value: string | undefined): HeavyRelationship {
  if (value === "corroborate" || value === "challenge" || value === "integrate") return value
  return "partition"
}

function normalizeCouncilRequest(value: typeof CouncilRequestInput.Type): CouncilRequest {
  return {
    recommended: value.recommended ?? false,
    reason: value.reason ?? "No Council routing rationale was supplied.",
    question: value.question,
    signals: normalizeArray(value.signals).flatMap((signal) =>
      signal === "competing_objectives" ||
      signal === "high_uncertainty" ||
      signal === "conflicting_evidence" ||
      signal === "consequential_decision" ||
      signal === "assumption_sensitive" ||
      signal === "multiple_interpretations" ||
      signal === "worker_requested"
        ? [signal]
        : [],
    ),
  }
}

function normalizeStance(value: string | undefined): Stance {
  if (value === "support" || value === "oppose" || value === "conditional") return value
  return "uncertain"
}

function normalizeResearchPriority(value: string | undefined): ResearchPriority {
  if (value === "critical" || value === "high") return "critical"
  if (value === "background" || value === "low") return "background"
  return "material"
}

function normalizeStringArray(value: string | ReadonlyArray<string> | undefined, maximum: number) {
  return Array.from(new Set(value === undefined ? [] : Array.isArray(value) ? value : [value])).slice(0, maximum)
}

function normalizeClaimKind(value: string | undefined): ResearchClaim["kind"] {
  if (value === "fact" || value === "estimate" || value === "recommendation") return value
  return "inference"
}

function normalizeClaimStatus(value: string | undefined): ResearchClaim["status"] {
  if (value === "supported" || value === "contested" || value === "refuted") return value
  return "uncertain"
}

function normalizeConfidence(value: string | undefined): ResearchClaim["confidence"] {
  if (value === "high" || value === "medium") return value
  return "low"
}

function normalizeEvidenceStance(value: string | undefined): ResearchEvidence["stance"] {
  if (value === "support" || value === "challenge") return value
  return "context"
}

function normalizeSourceType(value: string | undefined): ResearchEvidence["source_type"] {
  const normalized = value?.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_")
  if (
    normalized === "primary" ||
    normalized === "secondary" ||
    normalized === "observation" ||
    normalized === "calculation" ||
    normalized === "artifact"
  )
    return normalized
  if (normalized === "primary_source" || normalized === "official" || normalized === "authoritative") return "primary"
  if (normalized === "secondary_source" || normalized === "literature" || normalized === "review") return "secondary"
  if (normalized === "observed" || normalized === "empirical") return "observation"
  if (normalized === "computed" || normalized === "model") return "calculation"
  if (normalized === "repository" || normalized === "workspace" || normalized === "document") return "artifact"
  return "unknown"
}

function normalizeVerification(value: string | undefined): ResearchEvidence["verification"] {
  if (value === "verified" || value === "failed" || value === "not_applicable") return value
  return "unverified"
}

function normalizeGapStatus(value: string | undefined): ResearchGap["status"] {
  if (value === "addressed" || value === "deferred") return value
  return "open"
}

function normalizeDisputeStatus(value: string | undefined): ResearchDispute["status"] {
  if (value === "debated" || value === "resolved" || value === "deferred") return value
  return "open"
}
