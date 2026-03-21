import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"
import { SessionID } from "@/session/schema"
import { ProjectID } from "@/project/schema"
import { ProviderID, ModelID } from "@/provider/schema"

export const PlanID = Schema.String.pipe(
  Schema.brand("PlanID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    descending: (id?: string) => s.makeUnsafe(Identifier.descending("plan", id)),
    zod: Identifier.schema("plan").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type PlanID = Schema.Schema.Type<typeof PlanID>

export const SubtaskID = Schema.String.pipe(
  Schema.brand("SubtaskID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("subtask", id)),
    zod: Identifier.schema("subtask").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type SubtaskID = Schema.Schema.Type<typeof SubtaskID>

export const ModelRef = z
  .object({
    modelID: ModelID.zod,
    providerID: ProviderID.zod,
  })
  .meta({ ref: "ModelRef" })
export type ModelRef = z.infer<typeof ModelRef>

export const Subtask = z.object({
  id: SubtaskID.zod,
  title: z.string(),
  description: z.string(),
  fileScope: z.array(z.string()),
  dependencies: z.array(SubtaskID.zod).default([]),
  model: ModelRef.optional(),
  constraints: z.array(z.string()).optional(),
})
export type Subtask = z.infer<typeof Subtask>

export const SharedContract = z.object({
  name: z.string(),
  description: z.string(),
  types: z.string(),
  producers: z.array(SubtaskID.zod),
  consumers: z.array(SubtaskID.zod),
})
export type SharedContract = z.infer<typeof SharedContract>

export const ProjectConventions = z.object({
  serialization: z.string().optional(),
  auth: z.string().optional(),
  timestamps: z.string().optional(),
  naming: z.string().optional(),
  other: z.array(z.string()).optional(),
})
export type ProjectConventions = z.infer<typeof ProjectConventions>

export const PlanStatus = z.enum([
  "draft",
  "proposed",
  "approved",
  "spawning",
  "running",
  "merging",
  "integrating",
  "recovering",
  "publishing",
  "partial_success",
  "integrated",
  "cancelled",
  "done",
  "failed",
])
export type PlanStatus = z.infer<typeof PlanStatus>

export const PublishMode = z.enum(["new-branch", "unstaged", "direct"])
export type PublishMode = z.infer<typeof PublishMode>

export const PlanError = z.object({
  code: z.string(),
  message: z.string(),
  stage: z.string(),
  at: z.number(),
})
export type PlanError = z.infer<typeof PlanError>

export const WorkerStatus = z.enum([
  "pending",
  "spawning",
  "running",
  "stopping",
  "done",
  "failed",
  "merged",
  "conflict",
])
export type WorkerStatus = z.infer<typeof WorkerStatus>

export const WorkerResolutionMode = z.enum(["clean", "smart", "ai", "failed"])
export type WorkerResolutionMode = z.infer<typeof WorkerResolutionMode>

export const WorkerState = z.object({
  subtaskID: SubtaskID.zod,
  status: WorkerStatus,
  sessionID: SessionID.zod.optional(),
  worktreeName: z.string().optional(),
  worktreeDir: z.string().optional(),
  branch: z.string().optional(),
  error: z.string().optional(),
  resolutionMode: WorkerResolutionMode.optional(),
  diffStat: z
    .object({
      additions: z.number(),
      deletions: z.number(),
      files: z.number(),
    })
    .optional(),
})
export type WorkerState = z.infer<typeof WorkerState>

export const Plan = z.object({
  id: PlanID.zod,
  projectID: ProjectID.zod,
  sessionID: SessionID.zod.optional(),
  status: PlanStatus,
  error: PlanError.optional(),
  task: z.string(),
  orchestratorModel: ModelRef,
  workerModel: ModelRef,
  subtasks: z.array(Subtask),
  workers: z.array(WorkerState),
  sharedContracts: z.array(SharedContract).optional(),
  conventions: ProjectConventions.optional(),
  integrationBranch: z.string().optional(),
  publishMode: PublishMode.optional(),
  version: z.number().default(0),
  time: z.object({
    created: z.number(),
    approved: z.number().optional(),
    completed: z.number().optional(),
  }),
})
export type Plan = z.infer<typeof Plan>
