import type { ClaudeHooksConfig } from "./types";
import { type PluginExtendedConfig } from "./config-loader";
export declare function setStopHookActive(sessionId: string, active: boolean): void;
export declare function getStopHookActive(sessionId: string): boolean;
export interface StopContext {
    sessionId: string;
    parentSessionId?: string;
    cwd: string;
    transcriptPath?: string;
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
    stopHookActive?: boolean;
}
export interface StopResult {
    block: boolean;
    reason?: string;
    stopHookActive?: boolean;
    permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions";
    injectPrompt?: string;
}
export declare function executeStopHooks(ctx: StopContext, config: ClaudeHooksConfig | null, extendedConfig?: PluginExtendedConfig | null): Promise<StopResult>;
