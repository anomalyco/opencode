import { z } from "zod";
export declare const DynamicContextPruningConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    notification: z.ZodDefault<z.ZodEnum<{
        minimal: "minimal";
        off: "off";
        detailed: "detailed";
    }>>;
    turn_protection: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        turns: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    protected_tools: z.ZodDefault<z.ZodArray<z.ZodString>>;
    strategies: z.ZodOptional<z.ZodObject<{
        deduplication: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
        supersede_writes: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            aggressive: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
        purge_errors: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            turns: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type DynamicContextPruningConfig = z.infer<typeof DynamicContextPruningConfigSchema>;
