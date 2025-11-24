import z from "zod"
import { NamedError } from "@opencode-ai/util/error"

export const ConfigUpdateError = NamedError.create(
  "ConfigUpdateError",
  z.object({
    filepath: z.string(),
    scope: z.enum(["project", "global"]),
    directory: z.string(),
    cause: z.any().optional(),
  }),
)

export const ConfigValidationError = NamedError.create(
  "ConfigValidationError",
  z.object({
    filepath: z.string(),
    errors: z.array(
      z.object({
        field: z.string(),
        message: z.string(),
        expected: z.string().optional(),
        received: z.string().optional(),
      }),
    ),
  }),
)

export const ConfigWriteConflictError = NamedError.create(
  "ConfigWriteConflictError",
  z.object({
    filepath: z.string(),
    timeout: z.number(),
    waitedMs: z.number(),
  }),
)

export const ConfigWriteError = NamedError.create(
  "ConfigWriteError",
  z.object({
    filepath: z.string(),
    operation: z.enum(["create", "write", "backup", "restore"]),
    cause: z.any(),
  }),
)
