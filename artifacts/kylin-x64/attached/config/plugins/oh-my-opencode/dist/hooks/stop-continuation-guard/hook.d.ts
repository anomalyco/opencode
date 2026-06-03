import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
type StopContinuationBackgroundManager = Pick<BackgroundManager, "getAllDescendantTasks" | "cancelTask">;
export interface StopContinuationGuard {
    event: (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    "chat.message": (input: {
        sessionID?: string;
    }) => Promise<void>;
    stop: (sessionID: string) => void;
    isStopped: (sessionID: string) => boolean;
    clear: (sessionID: string) => void;
}
export declare function createStopContinuationGuardHook(ctx: PluginInput, options?: {
    backgroundManager?: StopContinuationBackgroundManager;
}): StopContinuationGuard;
export {};
