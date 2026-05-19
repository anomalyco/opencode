import type { ToolDefinition } from "@opencode-ai/plugin";
export declare function filterDisabledTools(tools: Record<string, ToolDefinition>, disabledTools: readonly string[] | undefined): Record<string, ToolDefinition>;
