import { z } from "zod/v4"
import { createJsonErrorResponseHandler, zodSchema } from "@ai-sdk/provider-utils"

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

export const openaiFailedResponseHandler: any = createJsonErrorResponseHandler({
  errorSchema: (zodSchema as any)(openaiErrorDataSchema),
  errorToMessage: (data) => (data as OpenAIErrorData).error.message,
})
