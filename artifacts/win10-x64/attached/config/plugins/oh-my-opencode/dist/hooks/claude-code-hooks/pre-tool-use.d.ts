import type { PermissionDecision, ClaudeHooksConfig } from "./types";
import { type PluginExtendedConfig } from "./config-loader";
export interface PreToolUseContext {
    sessionId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    cwd: string;
    transcriptPath?: string;
    toolUseId?: string;
    permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions";
}
export interface PreToolUseResult {
    decision: PermissionDecision;
    reason?: string;
    modifiedInput?: Record<string, unknown>;
    elapsedMs?: number;
    hookName?: string;
    toolName?: string;
    inputLines?: string;
    continue?: boolean;
    stopReason?: string;
    suppressOutput?: boolean;
    systemMessage?: string;
}
export declare function executePreToolUseHooks(ctx: PreToolUseContext, config: ClaudeHooksConfig | null, extendedConfig?: PluginExtendedConfig | null): Promise<PreToolUseResult>;
