import { z } from "zod"

export const MAX_TASKS = 500
export const MAX_ASSIGNMENTS = 2_000
export const MAX_EVIDENCE = 2_000
export const MAX_EVENTS = 1_000
export const MAX_RECEIPTS = 256
export const MAX_MUTATION_BYTES = 512 * 1024
export const MAX_RECORD_BYTES = 4 * 1024 * 1024
export const MAX_LIST_LIMIT = 50
export const DEFAULT_LIST_LIMIT = 20
export const MAX_SUMMARY_ROOTS = 50

export const IdentifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/)
export const TitleSchema = z.string().min(1).max(200)
export const SummarySchema = z.string().min(1).max(1_000)
export const PhaseSchema = z.string().min(1).max(80)
export const NonNegativeIntSchema = z.number().int().min(0)
export const PositiveIntSchema = z.number().int().min(1)
export const EpochMillisSchema = z.number().int().min(0)
export const RevisionSchema = PositiveIntSchema
export const ExpectedRevisionSchema = NonNegativeIntSchema

export const PlanPathSchema = z.string().min(1).max(1_024).refine(isWorkspaceRelative)
export const PlanHashSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const TaskStateSchema = z.enum([
  "pending",
  "running",
  "blocked",
  "awaiting_review",
  "verified",
  "failed",
  "skipped",
])
export const GateSchema = z.enum(["tests", "spec_review", "code_review", "manual"])
export const RoleSchema = z.enum(["controller", "implementer", "spec_reviewer", "code_reviewer", "debugger"])
export const OutcomeSchema = z.enum(["passed", "failed"])
export const RunStatusSchema = z.enum(["active", "completed", "cancelled"])
export const ErrorCodeSchema = z.enum([
  "not_found",
  "invalid_input",
  "forbidden",
  "revision_conflict",
  "operation_conflict",
  "invalid_transition",
  "stale_attempt",
  "limit_exceeded",
  "storage_unavailable",
  "incompatible_schema",
])
export const OperationTypeSchema = z.enum([
  "run.start",
  "task.state",
  "assignment.add",
  "assignment.end",
  "evidence.add",
  "task.verify",
  "task.reopen",
  "plan.revise",
  "run.finish",
  "run.cancel",
])

export const PlanSchema = z.strictObject({
  path: PlanPathSchema,
  sha256: PlanHashSchema,
  revision: RevisionSchema,
})

export const PlanDefinitionSchema = z.strictObject({
  path: PlanPathSchema,
  sha256: PlanHashSchema,
})

export const TaskDefinitionSchema = z.strictObject({
  id: IdentifierSchema,
  title: TitleSchema,
  phase: PhaseSchema,
  order: NonNegativeIntSchema,
  dependsOn: z.array(IdentifierSchema).max(MAX_TASKS).refine(isUnique),
  requiredGates: z.array(GateSchema).min(1).max(4).refine(isUnique),
  finalReview: z.boolean(),
})

export const TaskSchema = z
  .strictObject({
    id: IdentifierSchema,
    title: TitleSchema,
    phase: PhaseSchema,
    order: NonNegativeIntSchema,
    dependsOn: z.array(IdentifierSchema).max(MAX_TASKS).refine(isUnique),
    state: TaskStateSchema,
    attempt: PositiveIntSchema,
    requiredGates: z.array(GateSchema).min(1).max(4).refine(isUnique),
    finalReview: z.boolean(),
    reason: SummarySchema.optional(),
  })
  .superRefine((task, ctx) => {
    if (
      (task.state === "blocked" || task.state === "failed" || task.state === "skipped") &&
      task.reason === undefined
    ) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "reason is required" })
    }
  })

export const AssignmentSchema = z.strictObject({
  id: IdentifierSchema,
  taskID: IdentifierSchema,
  attempt: PositiveIntSchema,
  sessionID: IdentifierSchema,
  role: RoleSchema,
  createdAt: EpochMillisSchema,
  endedAt: EpochMillisSchema.optional(),
})

export const EvidenceSchema = z.strictObject({
  id: IdentifierSchema,
  taskID: IdentifierSchema,
  attempt: PositiveIntSchema,
  gate: GateSchema,
  outcome: OutcomeSchema,
  summary: SummarySchema,
  sessionID: IdentifierSchema,
  messageID: IdentifierSchema,
  partID: IdentifierSchema.optional(),
  reportedBySessionID: IdentifierSchema,
  createdAt: EpochMillisSchema,
})

export const RunEventSchema = z.strictObject({
  revision: RevisionSchema,
  type: OperationTypeSchema,
  taskID: IdentifierSchema.optional(),
  summary: SummarySchema,
  createdAt: EpochMillisSchema,
})

export const ProgressSummarySchema = z.strictObject({
  verified: NonNegativeIntSchema,
  total: NonNegativeIntSchema,
  skipped: NonNegativeIntSchema,
  failed: NonNegativeIntSchema,
  blocked: NonNegativeIntSchema,
  awaitingReview: NonNegativeIntSchema,
  percent: z.number().int().min(0).max(100).nullable(),
  source: z.literal("controller_report"),
})

export const RunSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runID: IdentifierSchema,
  rootSessionID: IdentifierSchema,
  title: TitleSchema,
  ownerDirectory: z.string().min(1),
  plan: PlanSchema,
  revision: RevisionSchema,
  status: RunStatusSchema,
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema,
  tasks: z.array(TaskSchema).max(MAX_TASKS),
  assignments: z.array(AssignmentSchema).max(MAX_ASSIGNMENTS),
  evidence: z.array(EvidenceSchema).max(MAX_EVIDENCE),
  events: z.array(RunEventSchema).max(MAX_EVENTS),
  historyTruncatedBeforeRevision: RevisionSchema.optional(),
})

export const RunSummarySchema = z.strictObject({
  runID: IdentifierSchema,
  rootSessionID: IdentifierSchema,
  ownerDirectory: z.string().min(1),
  title: TitleSchema,
  status: RunStatusSchema,
  revision: RevisionSchema,
  updatedAt: EpochMillisSchema,
  planRevision: RevisionSchema,
  progress: ProgressSummarySchema,
})

export const ErrorSchema = z.strictObject({
  code: ErrorCodeSchema,
  detail: SummarySchema,
  currentRevision: ExpectedRevisionSchema.optional(),
})

export const ChangedSchema = z.strictObject({
  rootSessionID: IdentifierSchema,
  runID: IdentifierSchema,
  revision: z.number().int().positive(),
})

const TaskStateChangeSchema = z.enum(["running", "blocked", "awaiting_review", "failed"])

const RunStartOperationSchema = z.strictObject({
  type: z.literal("run.start"),
  title: TitleSchema,
  plan: PlanDefinitionSchema,
  tasks: z.array(TaskDefinitionSchema).min(1).max(MAX_TASKS),
})

const TaskStateOperationSchema = z
  .strictObject({
    type: z.literal("task.state"),
    taskID: IdentifierSchema,
    attempt: PositiveIntSchema,
    state: TaskStateChangeSchema,
    reason: SummarySchema.optional(),
  })
  .superRefine((operation, ctx) => {
    if ((operation.state === "blocked" || operation.state === "failed") && operation.reason === undefined) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "reason is required" })
    }
  })

const AssignmentAddOperationSchema = z.strictObject({
  type: z.literal("assignment.add"),
  id: IdentifierSchema,
  taskID: IdentifierSchema,
  attempt: PositiveIntSchema,
  sessionID: IdentifierSchema,
  role: RoleSchema,
})

const AssignmentEndOperationSchema = z.strictObject({
  type: z.literal("assignment.end"),
  assignmentID: IdentifierSchema,
})

const EvidenceAddOperationSchema = z.strictObject({
  type: z.literal("evidence.add"),
  id: IdentifierSchema,
  taskID: IdentifierSchema,
  attempt: PositiveIntSchema,
  gate: GateSchema,
  outcome: OutcomeSchema,
  summary: SummarySchema,
  sessionID: IdentifierSchema,
  messageID: IdentifierSchema,
  partID: IdentifierSchema.optional(),
})

const TaskVerifyOperationSchema = z.strictObject({
  type: z.literal("task.verify"),
  taskID: IdentifierSchema,
  attempt: PositiveIntSchema,
})

const TaskReopenOperationSchema = z.strictObject({
  type: z.literal("task.reopen"),
  taskID: IdentifierSchema,
  reason: SummarySchema,
})

const PlanReviseOperationSchema = z.strictObject({
  type: z.literal("plan.revise"),
  plan: PlanDefinitionSchema,
  tasks: z.array(TaskDefinitionSchema).max(MAX_TASKS),
  reason: SummarySchema,
})

const RunFinishOperationSchema = z.strictObject({
  type: z.literal("run.finish"),
})

const RunCancelOperationSchema = z.strictObject({
  type: z.literal("run.cancel"),
  reason: SummarySchema,
})

export const ReportOperationSchema = z.discriminatedUnion("type", [
  RunStartOperationSchema,
  TaskStateOperationSchema,
  AssignmentAddOperationSchema,
  AssignmentEndOperationSchema,
  EvidenceAddOperationSchema,
  TaskVerifyOperationSchema,
  TaskReopenOperationSchema,
  PlanReviseOperationSchema,
  RunFinishOperationSchema,
  RunCancelOperationSchema,
])

export const ReportCommandSchema = z.strictObject({
  operationID: IdentifierSchema,
  runID: IdentifierSchema,
  expectedRevision: ExpectedRevisionSchema,
  operation: ReportOperationSchema,
})

export type Plan = z.infer<typeof PlanSchema>
export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>
export type Task = z.infer<typeof TaskSchema>
export type Assignment = z.infer<typeof AssignmentSchema>
export type Evidence = z.infer<typeof EvidenceSchema>
export type RunEvent = z.infer<typeof RunEventSchema>
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>
export type RunSummary = z.infer<typeof RunSummarySchema>
export type ProgressSummary = z.infer<typeof ProgressSummarySchema>
export type TaskState = z.infer<typeof TaskStateSchema>
export type Gate = z.infer<typeof GateSchema>
export type Role = z.infer<typeof RoleSchema>
export type Outcome = z.infer<typeof OutcomeSchema>
export type RunStatus = z.infer<typeof RunStatusSchema>
export type ErrorCode = z.infer<typeof ErrorCodeSchema>
export type OperationType = z.infer<typeof OperationTypeSchema>
export type ExecutionError = z.infer<typeof ErrorSchema>
export type ReportOperation = z.infer<typeof ReportOperationSchema>
export type ReportCommand = z.infer<typeof ReportCommandSchema>
export type Changed = z.infer<typeof ChangedSchema>

function isUnique(items: readonly unknown[]) {
  return new Set(items).size === items.length
}

function isWorkspaceRelative(path: string) {
  if (path.includes("\0")) return false
  if (path.startsWith("/") || path.startsWith("\\")) return false
  if (/^[A-Za-z]:/.test(path)) return false
  return !path.split(/[\\/]/).includes("..")
}
