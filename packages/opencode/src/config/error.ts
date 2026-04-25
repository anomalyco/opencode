export * as ConfigError from "./error"

import z from "zod"
import { NamedError } from "@opencode-ai/shared/util/error"

export const JsonError = NamedError.create(
  "ConfigJsonError",
  z.object({
    path: z.string(),
    message: z.string().optional(),
  }),
)

export const InvalidError = NamedError.create(
  "ConfigInvalidError",
  z.object({
    path: z.string(),
    issues: z.custom<z.core.$ZodIssue[]>().optional(),
    message: z.string().optional(),
  }),
)
