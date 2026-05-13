import { z } from "zod/v4";
export type OpenAICompatibleChatModelId = string;
export declare const openaiCompatibleProviderOptions: z.ZodObject<{
    user: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodString>;
    textVerbosity: z.ZodOptional<z.ZodString>;
    thinking_budget: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type OpenAICompatibleProviderOptions = z.infer<typeof openaiCompatibleProviderOptions>;
