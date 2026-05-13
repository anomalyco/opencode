import { z } from "zod";
export declare const RalphLoopConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    default_max_iterations: z.ZodDefault<z.ZodNumber>;
    state_dir: z.ZodOptional<z.ZodString>;
    default_strategy: z.ZodDefault<z.ZodEnum<{
        reset: "reset";
        continue: "continue";
    }>>;
}, z.core.$strip>;
export type RalphLoopConfig = z.infer<typeof RalphLoopConfigSchema>;
