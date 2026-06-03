import type { ClaudeHooksConfig } from "./types";
import { type PluginExtendedConfig } from "./config-loader";
export interface MessagePart {
    type: "text" | "tool_use" | "tool_result";
    text?: string;
    [key: string]: unknown;
}
export interface UserPromptSubmitContext {
    sessionId: string;
    parentSessionId?: string;
    prompt: string;
    parts: MessagePart[];
    cwd: string;
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
}
export interface UserPromptSubmitResult {
    block: boolean;
    reason?: string;
    modifiedParts: MessagePart[];
    messages: string[];
}
export declare function executeUserPromptSubmitHooks(ctx: UserPromptSubmitContext, config: ClaudeHooksConfig | null, extendedConfig?: PluginExtendedConfig | null): Promise<UserPromptSubmitResult>;
