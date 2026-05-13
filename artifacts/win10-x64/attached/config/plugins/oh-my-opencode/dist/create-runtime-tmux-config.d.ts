import type { OhMyOpenCodeConfig, TmuxConfig } from "./config";
export declare function isTmuxIntegrationEnabled(pluginConfig: {
    tmux?: {
        enabled?: boolean;
    } | undefined;
}): boolean;
export declare function isInteractiveBashEnabled(which?: (binary: string) => string | null): boolean;
export declare function createRuntimeTmuxConfig(pluginConfig: {
    tmux?: OhMyOpenCodeConfig["tmux"];
}): TmuxConfig;
