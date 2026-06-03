import { type OhMyOpenCodeConfig } from "./config";
export declare function parseConfigPartially(rawConfig: Record<string, unknown>): OhMyOpenCodeConfig | null;
export declare function loadConfigFromPath(configPath: string, _ctx: unknown): OhMyOpenCodeConfig | null;
export declare function mergeConfigs(base: OhMyOpenCodeConfig, override: OhMyOpenCodeConfig): OhMyOpenCodeConfig;
export declare function loadPluginConfig(directory: string, ctx: unknown): OhMyOpenCodeConfig;
