import { z } from "zod/v4"
import { createJsonErrorResponseHandler } from "@ai-sdk/provider-utils"

export const openaiErrorDataSchema = z.object({
  error: z.object({
    message: z.string(),

    // The additional information below is handled loosely to support
    // OpenAI-compatible providers that have slightly different error
    // responses:
    type: z.string().nullish(),
    param: z.any().nullish(),
    code: z.union([z.string(), z.number()]).nullish(),
  }),
})

export type OpenAIErrorData = z.infer<typeof openaiErrorDataSchema>

// Status codes that should trigger automatic retry
const RETRYABLE_STATUS_CODES = new Set([
  404, // OpenAI Responses API can return 404 for transient "Item not found" errors
  408, // Request Timeout
  429, // Too Many Requests / Rate Limited
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
])

export const openaiFailedResponseHandler: any = createJsonErrorResponseHandler({
  errorSchema: openaiErrorDataSchema,
  errorToMessage: (data) => data.error.message,
  isRetryable: (response) => RETRYABLE_STATUS_CODES.has(response.status),
})
