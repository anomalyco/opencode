import type { HookName, OhMyOpenCodeConfig } from "../../config";
import type { BackgroundManager } from "../../features/background-agent";
import type { PluginContext } from "../types";
import { createTodoContinuationEnforcer, createBackgroundNotificationHook, createStopContinuationGuardHook, createCompactionContextInjector, createCompactionTodoPreserverHook, createAtlasHook } from "../../hooks";
import { createUnstableAgentBabysitter } from "../unstable-agent-babysitter";
export type ContinuationHooks = {
    stopContinuationGuard: ReturnType<typeof createStopContinuationGuardHook> | null;
    compactionContextInjector: ReturnType<typeof createCompactionContextInjector> | null;
    compactionTodoPreserver: ReturnType<typeof createCompactionTodoPreserverHook> | null;
    todoContinuationEnforcer: ReturnType<typeof createTodoContinuationEnforcer> | null;
    unstableAgentBabysitter: ReturnType<typeof createUnstableAgentBabysitter> | null;
    backgroundNotificationHook: ReturnType<typeof createBackgroundNotificationHook> | null;
    atlasHook: ReturnType<typeof createAtlasHook> | null;
};
type SessionRecovery = {
    setOnAbortCallback: (callback: (sessionID: string) => void) => void;
    setOnRecoveryCompleteCallback: (callback: (sessionID: string) => void) => void;
} | null;
export declare function createContinuationHooks(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    isHookEnabled: (hookName: HookName) => boolean;
    safeHookEnabled: boolean;
    backgroundManager: BackgroundManager;
    sessionRecovery: SessionRecovery;
}): ContinuationHooks;
export {};
