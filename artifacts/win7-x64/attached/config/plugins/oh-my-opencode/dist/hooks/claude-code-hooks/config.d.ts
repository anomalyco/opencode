import type { ClaudeHooksConfig } from "./types";
export declare function getClaudeSettingsPaths(customPath?: string): string[];
export declare function clearClaudeHooksConfigCache(): void;
export declare function loadClaudeHooksConfig(customSettingsPath?: string): Promise<ClaudeHooksConfig | null>;
