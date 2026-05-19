import { z } from "zod";
export declare const BackgroundTaskConfigSchema: z.ZodObject<{
    defaultConcurrency: z.ZodOptional<z.ZodNumber>;
    providerConcurrency: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    modelConcurrency: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    maxDepth: z.ZodOptional<z.ZodNumber>;
    staleTimeoutMs: z.ZodOptional<z.ZodNumber>;
    messageStalenessTimeoutMs: z.ZodOptional<z.ZodNumber>;
    taskTtlMs: z.ZodOptional<z.ZodNumber>;
    sessionGoneTimeoutMs: z.ZodOptional<z.ZodNumber>;
    syncPollTimeoutMs: z.ZodOptional<z.ZodNumber>;
    maxToolCalls: z.ZodOptional<z.ZodNumber>;
    circuitBreaker: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        maxToolCalls: z.ZodOptional<z.ZodNumber>;
        consecutiveThreshold: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>;
