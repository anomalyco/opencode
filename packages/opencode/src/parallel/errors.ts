import z from "zod"
import { NamedError } from "@opencode-ai/util/error"

export const ConflictError = NamedError.create(
  "ConflictError",
  z.object({
    message: z.string(),
  }),
)
