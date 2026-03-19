import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"
import { SessionID } from "@/session/schema"
import { ProviderID, ModelID } from "@/provider/schema"

export { SessionID } from "@/session/schema"

export const PlanID = Schema.String.pipe(
  Schema.brand("PlanID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    descending: (id?: string) => s.makeUnsafe(Identifier.descending("plan" as any, id)),
    zod: z.string().pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type PlanID = Schema.Schema.Type<typeof PlanID>

export const SubtaskID = Schema.String.pipe(
  Schema.brand("SubtaskID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("subtask" as any, id)),
    zod: z.string().pipe(z.custom<Schema.Schema.Type<typeof s>>()),
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
})
export type Subtask = z.infer<typeof Subtask>

export const PlanStatus = z.enum(["draft", "proposed", "approved", "spawning", "running", "merging", "done", "failed"])
export type PlanStatus = z.infer<typeof PlanStatus>

export const WorkerStatus = z.enum(["pending", "spawning", "running", "done", "failed", "merged", "conflict"])
export type WorkerStatus = z.infer<typeof WorkerStatus>

export const WorkerState = z.object({
  subtaskID: SubtaskID.zod,
  status: WorkerStatus,
  sessionID: SessionID.zod.optional(),
  worktreeName: z.string().optional(),
  worktreeDir: z.string().optional(),
  branch: z.string().optional(),
  error: z.string().optional(),
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
  sessionID: SessionID.zod,
  status: PlanStatus,
  task: z.string(),
  orchestratorModel: ModelRef,
  workerModel: ModelRef,
  subtasks: z.array(Subtask),
  workers: z.array(WorkerState),
  time: z.object({
    created: z.number(),
    approved: z.number().optional(),
    completed: z.number().optional(),
  }),
})
export type Plan = z.infer<typeof Plan>
