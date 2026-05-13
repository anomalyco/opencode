import type { ToolDefinition } from "@opencode-ai/plugin";
export declare function normalizeToolArgSchemas<TDefinition extends Pick<ToolDefinition, "args">>(toolDefinition: TDefinition): TDefinition;
export declare function sanitizeJsonSchema(value: unknown, depth?: number, isPropertyName?: boolean): unknown;
