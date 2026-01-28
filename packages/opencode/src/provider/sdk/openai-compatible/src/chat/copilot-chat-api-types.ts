import { z } from "zod/v4"

const copilotChatToolCallFunctionSchema = z.object({
  name: z.string().optional(),
  arguments: z.string().optional(),
})

const copilotChatToolCallSchema = z.object({
  index: z.number().optional(),
  id: z.string().optional(),
  type: z.literal("function").optional(),
  function: copilotChatToolCallFunctionSchema.optional(),
})

const copilotChatDeltaSchema = z.object({
  role: z.string().optional(),
  content: z.string().nullish(),
  reasoning_opaque: z.string().nullish(),
  reasoning_text: z.string().nullish(),
  tool_calls: z.array(copilotChatToolCallSchema).optional(),
})

const promptTokensDetailsSchema = z.object({
  cached_tokens: z.number().optional(),
  audio_tokens: z.number().optional(),
})

const completionTokensDetailsSchema = z.object({
  reasoning_tokens: z.number().optional(),
  accepted_prediction_tokens: z.number().optional(),
  rejected_prediction_tokens: z.number().optional(),
  audio_tokens: z.number().optional(),
})

export const copilotChatUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  prompt_tokens_details: promptTokensDetailsSchema.nullish(),
  completion_tokens_details: completionTokensDetailsSchema.nullish(),
})

export const copilotChatChunkSchema = z.object({
  id: z.string(),
  created: z.number(),
  model: z.string().optional(),
  choices: z.array(
    z.object({
      delta: copilotChatDeltaSchema,
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: copilotChatUsageSchema.nullish(),
})

export const copilotChatResponseSchema = z.object({
  id: z.string(),
  created: z.number(),
  model: z.string().optional(),
  choices: z.array(
    z.object({
      message: copilotChatDeltaSchema,
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: copilotChatUsageSchema.nullish(),
})
