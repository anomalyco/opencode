import z from "zod"
import { NamedError } from "@opencode-ai/util/error"

export const ConflictError = NamedError.create(
  "ConflictError",
  z.object({
    message: z.string(),
  }),
)

export const PlanLimitError = NamedError.create(
  "PlanLimitError",
  z.object({
    projectID: z.string(),
    currentCount: z.number(),
    maxAllowed: z.number(),
    message: z.string(),
  }),
)

export const WorkerTimeoutError = NamedError.create(
  "WorkerTimeoutError",
  z.object({
    planID: z.string(),
    subtaskID: z.string(),
    elapsedMs: z.number(),
    timeoutMs: z.number(),
    message: z.string(),
  }),
)

export const DependencyError = NamedError.create(
  "DependencyError",
  z.object({
    subtaskID: z.string(),
    dependencyID: z.string().optional(),
    type: z.enum(["circular", "missing", "self", "duplicate"]),
    message: z.string(),
  }),
)
