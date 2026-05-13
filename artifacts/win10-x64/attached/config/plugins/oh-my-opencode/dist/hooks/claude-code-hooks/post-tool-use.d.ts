import type { ClaudeHooksConfig } from "./types";
import { type PluginExtendedConfig } from "./config-loader";
export interface PostToolUseClient {
    session: {
        messages: (opts: {
            path: {
                id: string;
            };
            query?: {
                directory: string;
            };
        }) => Promise<unknown>;
    };
}
export interface PostToolUseContext {
    sessionId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolOutput: Record<string, unknown>;
    cwd: string;
    transcriptPath?: string;
    toolUseId?: string;
    client?: PostToolUseClient;
    permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions";
}
export interface PostToolUseResult {
    block: boolean;
    reason?: string;
    message?: string;
    warnings?: string[];
    elapsedMs?: number;
    hookName?: string;
    toolName?: string;
    additionalContext?: string;
    continue?: boolean;
    stopReason?: string;
    suppressOutput?: boolean;
    systemMessage?: string;
}
export declare function executePostToolUseHooks(ctx: PostToolUseContext, config: ClaudeHooksConfig | null, extendedConfig?: PluginExtendedConfig | null): Promise<PostToolUseResult>;
