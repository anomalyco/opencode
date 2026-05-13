import { z } from "zod";
export declare const RuntimeFallbackConfigSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    retry_on_errors: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    max_fallback_attempts: z.ZodOptional<z.ZodNumber>;
    cooldown_seconds: z.ZodOptional<z.ZodNumber>;
    timeout_seconds: z.ZodOptional<z.ZodNumber>;
    notify_on_fallback: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type RuntimeFallbackConfig = z.infer<typeof RuntimeFallbackConfigSchema>;
