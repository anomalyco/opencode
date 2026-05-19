import { z } from "zod";
export declare const ExperimentalConfigSchema: z.ZodObject<{
    aggressive_truncation: z.ZodOptional<z.ZodBoolean>;
    auto_resume: z.ZodOptional<z.ZodBoolean>;
    preemptive_compaction: z.ZodOptional<z.ZodBoolean>;
    truncate_all_tool_outputs: z.ZodOptional<z.ZodBoolean>;
    dynamic_context_pruning: z.ZodOptional<z.ZodObject<{
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
    }, z.core.$strip>>;
    task_system: z.ZodOptional<z.ZodBoolean>;
    plugin_load_timeout_ms: z.ZodOptional<z.ZodNumber>;
    safe_hook_creation: z.ZodOptional<z.ZodBoolean>;
    disable_omo_env: z.ZodOptional<z.ZodBoolean>;
    hashline_edit: z.ZodOptional<z.ZodBoolean>;
    model_fallback_title: z.ZodOptional<z.ZodBoolean>;
    max_tools: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>;
