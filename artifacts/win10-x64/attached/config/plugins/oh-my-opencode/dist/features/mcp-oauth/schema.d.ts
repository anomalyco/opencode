import { z } from "zod";
export declare const McpOauthSchema: z.ZodObject<{
    clientId: z.ZodOptional<z.ZodString>;
    scopes: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type McpOauth = z.infer<typeof McpOauthSchema>;
