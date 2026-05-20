import type { ClaudeHookEvent } from "./types";
export interface DisabledHooksConfig {
    Stop?: string[];
    PreToolUse?: string[];
    PostToolUse?: string[];
    UserPromptSubmit?: string[];
    PreCompact?: string[];
}
export interface PluginExtendedConfig {
    disabledHooks?: DisabledHooksConfig;
}
export declare function clearPluginExtendedConfigCache(): void;
export declare function loadPluginExtendedConfig(): Promise<PluginExtendedConfig>;
export declare function isHookCommandDisabled(eventType: ClaudeHookEvent, command: string, config: PluginExtendedConfig | null): boolean;
