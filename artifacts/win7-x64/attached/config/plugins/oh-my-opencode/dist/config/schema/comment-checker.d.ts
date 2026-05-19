import { z } from "zod";
export declare const CommentCheckerConfigSchema: z.ZodObject<{
    custom_prompt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>;
