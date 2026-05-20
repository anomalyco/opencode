import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopState } from "./types";
type LoopStateController = {
    clear: () => boolean;
    markVerificationPending: (sessionID: string) => RalphLoopState | null;
};
export declare function handleDetectedCompletion(ctx: PluginInput, input: {
    sessionID: string;
    state: RalphLoopState;
    loopState: LoopStateController;
    directory: string;
    apiTimeoutMs: number;
}): Promise<void>;
export {};
