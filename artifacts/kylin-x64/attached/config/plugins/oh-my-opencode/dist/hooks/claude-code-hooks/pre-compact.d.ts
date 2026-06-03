import type { ClaudeHooksConfig } from "./types";
import { type PluginExtendedConfig } from "./config-loader";
export interface PreCompactContext {
    sessionId: string;
    cwd: string;
}
export interface PreCompactResult {
    context: string[];
    elapsedMs?: number;
    hookName?: string;
    continue?: boolean;
    stopReason?: string;
    suppressOutput?: boolean;
    systemMessage?: string;
}
export declare function executePreCompactHooks(ctx: PreCompactContext, config: ClaudeHooksConfig | null, extendedConfig?: PluginExtendedConfig | null): Promise<PreCompactResult>;
