import { z } from "zod";
export declare const SisyphusAgentConfigSchema: z.ZodObject<{
    disabled: z.ZodOptional<z.ZodBoolean>;
    default_builder_enabled: z.ZodOptional<z.ZodBoolean>;
    planner_enabled: z.ZodOptional<z.ZodBoolean>;
    replace_plan: z.ZodOptional<z.ZodBoolean>;
    tdd: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
}, z.core.$strip>;
export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>;
