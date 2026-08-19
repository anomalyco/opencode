export * as Workflow from "./workflow"

import { Schema } from "effect"
import { Agent } from "./agent"
import { ascending } from "./identifier"
import { Model } from "./model"
import { Project } from "./project"
import { DateTimeUtcFromMillis, NonNegativeInt, optional, PositiveInt, statics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("wfl_")).pipe(
  Schema.brand("Workflow.ID"),
  statics((schema) => ({
    create: () => schema.make("wfl_" + ascending()),
  })),
)
export type ID = typeof ID.Type

export const Status = Schema.Literals([
  "planning",
  "running",
  "final_audit",
  "paused",
  "needs_human",
  "completed",
  "failed",
  "cancelled",
]).annotate({ identifier: "Workflow.Status" })
export type Status = typeof Status.Type

export const TaskStatus = Schema.Literals([
  "blocked",
  "ready",
  "coding",
  "audit_pending",
  "remediation_ready",
  "approved",
  "integrating",
  "integrated",
  "needs_human",
  "failed",
  "cancelled",
]).annotate({ identifier: "Workflow.TaskStatus" })
export type TaskStatus = typeof TaskStatus.Type

export const AttemptStatus = Schema.Literals(["submitted", "approved", "rejected", "failed"]).annotate({
  identifier: "Workflow.AttemptStatus",
})
export type AttemptStatus = typeof AttemptStatus.Type

export const AuditFinding = Schema.Struct({
  severity: Schema.Literals(["info", "warning", "error"]),
  message: Schema.String,
  path: Schema.String.pipe(optional),
}).annotate({ identifier: "Workflow.AuditFinding" })
export interface AuditFinding extends Schema.Schema.Type<typeof AuditFinding> {}

export const RoleSelection = Schema.Struct({
  agent: Agent.ID,
  model: Model.Ref.pipe(optional),
}).annotate({ identifier: "Workflow.RoleSelection" })
export interface RoleSelection extends Schema.Schema.Type<typeof RoleSelection> {}

export const Preferences = Schema.Struct({
  projectID: Project.ID,
  architect: RoleSelection.pipe(optional),
  coder: RoleSelection.pipe(optional),
  concurrency: PositiveInt.pipe(optional),
  time: Schema.Struct({
    updated: DateTimeUtcFromMillis,
  }),
}).annotate({ identifier: "Workflow.Preferences" })
export interface Preferences extends Schema.Schema.Type<typeof Preferences> {}

export const PreferencesInput = Schema.Struct({
  architect: RoleSelection.pipe(optional),
  coder: RoleSelection.pipe(optional),
  concurrency: PositiveInt.pipe(optional),
}).annotate({ identifier: "Workflow.PreferencesInput" })
export interface PreferencesInput extends Schema.Schema.Type<typeof PreferencesInput> {}

export const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: TaskStatus,
  dependencies: Schema.Array(Schema.String),
  attempts: NonNegativeInt,
  summary: Schema.String.pipe(optional),
}).annotate({ identifier: "Workflow.Task" })
export interface Task extends Schema.Schema.Type<typeof Task> {}

export const PlannedTask = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  dependencies: Schema.Array(Schema.String),
  conflictsWith: Schema.Array(Schema.String),
  parallelEligible: Schema.Boolean,
  allowedPaths: Schema.Array(Schema.String),
  acceptanceCriteria: Schema.Array(Schema.String),
  validation: Schema.Array(Schema.String),
  summary: Schema.String.pipe(optional),
}).annotate({ identifier: "Workflow.PlannedTask" })
export interface PlannedTask extends Schema.Schema.Type<typeof PlannedTask> {}

export const Attempt = Schema.Struct({
  id: Schema.String,
  taskID: Schema.String,
  status: AttemptStatus,
  sessionID: Schema.String.pipe(optional),
  summary: Schema.String.pipe(optional),
  feedback: Schema.String.pipe(optional),
  findings: Schema.Array(AuditFinding),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
  }),
}).annotate({ identifier: "Workflow.Attempt" })
export interface Attempt extends Schema.Schema.Type<typeof Attempt> {}

export const Info = Schema.Struct({
  id: ID,
  projectID: Project.ID,
  story: Schema.String,
  status: Status,
  architect: RoleSelection,
  coder: RoleSelection,
  concurrency: PositiveInt,
  tasks: Schema.Array(Task),
  attempts: Schema.Array(Attempt),
  sessions: Schema.Struct({
    architect: Schema.Array(Schema.String),
    coder: Schema.Array(Schema.String),
  }),
  branch: Schema.String.pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
  }),
}).annotate({ identifier: "Workflow.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const CreateInput = Schema.Struct({
  story: Schema.String,
  architect: RoleSelection.pipe(optional),
  coder: RoleSelection.pipe(optional),
  concurrency: PositiveInt.pipe(optional),
}).annotate({ identifier: "Workflow.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

export const SetTasksInput = Schema.Struct({
  tasks: Schema.Array(PlannedTask),
}).annotate({ identifier: "Workflow.SetTasksInput" })
export interface SetTasksInput extends Schema.Schema.Type<typeof SetTasksInput> {}

export const AppendSessionInput = Schema.Struct({
  role: Schema.Literals(["architect", "coder"]),
  sessionID: Schema.String,
}).annotate({ identifier: "Workflow.AppendSessionInput" })
export interface AppendSessionInput extends Schema.Schema.Type<typeof AppendSessionInput> {}

export const TransitionTaskInput = Schema.Struct({
  taskID: Schema.String,
  status: TaskStatus,
}).annotate({ identifier: "Workflow.TransitionTaskInput" })
export interface TransitionTaskInput extends Schema.Schema.Type<typeof TransitionTaskInput> {}

export const RecordAttemptInput = Schema.Struct({
  taskID: Schema.String,
  status: AttemptStatus,
  sessionID: Schema.String.pipe(optional),
  summary: Schema.String.pipe(optional),
  feedback: Schema.String.pipe(optional),
  findings: Schema.Array(AuditFinding).pipe(optional),
}).annotate({ identifier: "Workflow.RecordAttemptInput" })
export interface RecordAttemptInput extends Schema.Schema.Type<typeof RecordAttemptInput> {}

export const ArchitectPlanOutput = Schema.Struct({
  schemaVersion: Schema.Literal("1.0"),
  kind: Schema.Literal("ARCHITECT_WORKFLOW_PLAN"),
  status: Schema.Literals(["COMPLETE", "BLOCKED", "NEEDS_HUMAN"]),
  summary: Schema.String,
  tasks: Schema.Array(PlannedTask),
  blockers: Schema.Array(Schema.String),
  questions: Schema.Array(Schema.String),
}).annotate({ identifier: "Workflow.ArchitectPlanOutput" })
export interface ArchitectPlanOutput extends Schema.Schema.Type<typeof ArchitectPlanOutput> {}

export const ArchitectAuditOutput = Schema.Struct({
  schemaVersion: Schema.Literal("1.0"),
  kind: Schema.Literal("ARCHITECT_TASK_AUDIT"),
  status: Schema.Literals(["APPROVED", "REJECTED", "BLOCKED", "NEEDS_HUMAN"]),
  taskID: Schema.String,
  attemptID: Schema.String,
  summary: Schema.String,
  findings: Schema.Array(AuditFinding),
  remediation: Schema.Struct({
    required: Schema.Boolean,
    instructions: Schema.Array(Schema.String),
  }),
}).annotate({ identifier: "Workflow.ArchitectAuditOutput" })
export interface ArchitectAuditOutput extends Schema.Schema.Type<typeof ArchitectAuditOutput> {}

export const CoderResultOutput = Schema.Struct({
  schemaVersion: Schema.Literal("1.0"),
  kind: Schema.Literal("CODER_WORKFLOW_RESULT"),
  status: Schema.Literals(["READY_FOR_ARCHITECT_AUDIT", "FAILED", "BLOCKED", "NEEDS_HUMAN"]),
  taskID: Schema.String,
  attemptID: Schema.String,
  summary: Schema.String,
  filesChanged: Schema.Array(Schema.String),
  validation: Schema.Array(
    Schema.Struct({
      command: Schema.String,
      exitCode: Schema.Number,
      result: Schema.Literals(["PASS", "FAIL", "BLOCKED"]),
      summary: Schema.String,
    }),
  ),
  blockers: Schema.Array(Schema.String),
}).annotate({ identifier: "Workflow.CoderResultOutput" })
export interface CoderResultOutput extends Schema.Schema.Type<typeof CoderResultOutput> {}
