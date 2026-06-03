import { z } from "zod";
export declare const StartWorkConfigSchema: z.ZodObject<{
    auto_commit: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type StartWorkConfig = z.infer<typeof StartWorkConfigSchema>;
