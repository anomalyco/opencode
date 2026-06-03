import { z } from "zod";
export declare const McpNameSchema: z.ZodEnum<{
    websearch: "websearch";
    context7: "context7";
    grep_app: "grep_app";
}>;
export type McpName = z.infer<typeof McpNameSchema>;
export declare const AnyMcpNameSchema: z.ZodString;
export type AnyMcpName = z.infer<typeof AnyMcpNameSchema>;
