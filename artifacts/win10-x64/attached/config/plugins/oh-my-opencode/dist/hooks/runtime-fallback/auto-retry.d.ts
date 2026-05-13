import type { HookDeps } from "./types";
export declare function createAutoRetryHelpers(deps: HookDeps): {
    abortSessionRequest: (sessionID: string, source: string) => Promise<void>;
    clearSessionFallbackTimeout: (sessionID: string) => void;
    scheduleSessionFallbackTimeout: (sessionID: string, resolvedAgent?: string) => void;
    autoRetryWithFallback: (sessionID: string, newModel: string, resolvedAgent: string | undefined, source: string) => Promise<void>;
    resolveAgentForSessionFromContext: (sessionID: string, eventAgent?: string) => Promise<string | undefined>;
    cleanupStaleSessions: () => void;
};
export type AutoRetryHelpers = ReturnType<typeof createAutoRetryHelpers>;
