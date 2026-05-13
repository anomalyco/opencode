import { z } from "zod";
export declare const BabysittingConfigSchema: z.ZodObject<{
    timeout_ms: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type BabysittingConfig = z.infer<typeof BabysittingConfigSchema>;
