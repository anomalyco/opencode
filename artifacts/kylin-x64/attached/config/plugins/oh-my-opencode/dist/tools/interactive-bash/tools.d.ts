import { type ToolDefinition } from "@opencode-ai/plugin/tool";
/**
 * Quote-aware command tokenizer with escape handling
 * Handles single/double quotes and backslash escapes without external dependencies
 */
export declare function tokenizeCommand(cmd: string): string[];
export declare const interactive_bash: ToolDefinition;
