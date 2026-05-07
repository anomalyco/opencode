import { resolver } from "hono-openapi"
import z from "zod"
import { NotFoundError } from "../storage/db"

export const SteerUnavailableErrorSchema = z
  .object({
    name: z.literal("SessionSteerUnavailableError"),
    data: z.object({
      message: z.string(),
      sessionID: z.string(),
    }),
  })
  .meta({
    ref: "SteerUnavailableError",
  })

export const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(
          z
            .object({
              data: z.any(),
              errors: z.array(z.record(z.string(), z.any())),
              success: z.literal(false),
            })
            .meta({
              ref: "BadRequestError",
            }),
        ),
      },
    },
  },
  404: {
    description: "Not found",
    content: {
      "application/json": {
        schema: resolver(NotFoundError.Schema),
      },
    },
  },
  409: {
    description: "Conflict",
    content: {
      "application/json": {
        schema: resolver(
          z
            .object({
              name: z.literal("SessionPendingConflictError"),
              data: z.object({
                message: z.string(),
                sessionID: z.string(),
              }),
            })
            .meta({
              ref: "ConflictError",
            }),
        ),
      },
    },
  },
} as const

export const STEER_UNAVAILABLE_ERROR = {
  description: "Steer unavailable",
  content: {
    "application/json": {
      schema: resolver(SteerUnavailableErrorSchema),
    },
  },
} as const

export function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}
