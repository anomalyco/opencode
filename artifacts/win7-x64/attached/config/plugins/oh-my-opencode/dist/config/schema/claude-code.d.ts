import { z } from "zod";
export declare const ClaudeCodeConfigSchema: z.ZodObject<{
    mcp: z.ZodOptional<z.ZodBoolean>;
    commands: z.ZodOptional<z.ZodBoolean>;
    skills: z.ZodOptional<z.ZodBoolean>;
    agents: z.ZodOptional<z.ZodBoolean>;
    hooks: z.ZodOptional<z.ZodBoolean>;
    plugins: z.ZodOptional<z.ZodBoolean>;
    plugins_override: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
}, z.core.$strip>;
export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfigSchema>;
