import { z } from "zod";
export declare const SisyphusTasksConfigSchema: z.ZodObject<{
    storage_path: z.ZodOptional<z.ZodString>;
    task_list_id: z.ZodOptional<z.ZodString>;
    claude_code_compat: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const SisyphusConfigSchema: z.ZodObject<{
    tasks: z.ZodOptional<z.ZodObject<{
        storage_path: z.ZodOptional<z.ZodString>;
        task_list_id: z.ZodOptional<z.ZodString>;
        claude_code_compat: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type SisyphusTasksConfig = z.infer<typeof SisyphusTasksConfigSchema>;
export type SisyphusConfig = z.infer<typeof SisyphusConfigSchema>;
