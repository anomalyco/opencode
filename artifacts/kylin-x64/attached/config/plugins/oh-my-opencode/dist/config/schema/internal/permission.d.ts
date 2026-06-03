import { z } from "zod";
export declare const PermissionValueSchema: z.ZodEnum<{
    ask: "ask";
    allow: "allow";
    deny: "deny";
}>;
export type PermissionValue = z.infer<typeof PermissionValueSchema>;
export declare const AgentPermissionSchema: z.ZodObject<{
    edit: z.ZodOptional<z.ZodEnum<{
        ask: "ask";
        allow: "allow";
        deny: "deny";
    }>>;
    bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        ask: "ask";
        allow: "allow";
        deny: "deny";
    }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
        ask: "ask";
        allow: "allow";
        deny: "deny";
    }>>]>>;
    webfetch: z.ZodOptional<z.ZodEnum<{
        ask: "ask";
        allow: "allow";
        deny: "deny";
    }>>;
    task: z.ZodOptional<z.ZodEnum<{
        ask: "ask";
        allow: "allow";
        deny: "deny";
    }>>;
    doom_loop: z.ZodOptional<z.ZodEnum<{
        ask: "ask";
        allow: "allow";
        deny: "deny";
    }>>;
    external_directory: z.ZodOptional<z.ZodEnum<{
        ask: "ask";
        allow: "allow";
        deny: "deny";
    }>>;
}, z.core.$strip>;
export type AgentPermission = z.infer<typeof AgentPermissionSchema>;
