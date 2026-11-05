import { type Clock } from "./lib/clock.js";
import type { ThemeMode } from "./types.js";
export interface RendererThemeModeHost {
    queryThemeColors(): void;
}
export declare class RendererThemeMode {
    private readonly host;
    private readonly clock;
    private static readonly QUERY_TIMEOUT_MS;
    private _themeMode;
    private themeQueryPending;
    private themeOscForeground;
    private themeOscBackground;
    private themeRefreshTimeoutId;
    private waiters;
    constructor(host: RendererThemeModeHost, clock: Clock);
    get themeMode(): ThemeMode | null;
    waitForThemeMode(timeoutMs: number, isDestroyed: boolean): Promise<ThemeMode | null>;
    cancelRefresh(): void;
    dispose(): void;
    handleSequence(sequence: string): {
        handled: boolean;
        changedMode: ThemeMode | null;
    };
    private clearThemeRefreshTimeout;
    private completeThemeQuery;
    private requestThemeOscColors;
    private applyThemeMode;
}
