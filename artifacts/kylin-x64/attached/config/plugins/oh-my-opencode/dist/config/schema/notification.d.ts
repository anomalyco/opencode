import { z } from "zod";
export declare const NotificationConfigSchema: z.ZodObject<{
    force_enable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;
