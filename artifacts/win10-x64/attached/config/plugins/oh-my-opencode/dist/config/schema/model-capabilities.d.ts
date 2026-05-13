import { z } from "zod";
export declare const ModelCapabilitiesConfigSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    auto_refresh_on_start: z.ZodOptional<z.ZodBoolean>;
    refresh_timeout_ms: z.ZodOptional<z.ZodNumber>;
    source_url: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ModelCapabilitiesConfig = z.infer<typeof ModelCapabilitiesConfigSchema>;
