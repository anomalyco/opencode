import type { ClaudeHooksConfig, HookMatcher } from "../hooks/claude-code-hooks/types";
export declare function matchesToolMatcher(toolName: string, matcher: string): boolean;
export declare function findMatchingHooks(config: ClaudeHooksConfig, eventName: keyof ClaudeHooksConfig, toolName?: string): HookMatcher[];
