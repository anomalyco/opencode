import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopState } from "./types";
type LoopStateController = {
    restartAfterFailedVerification: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null;
};
export declare function handleFailedVerification(ctx: PluginInput, input: {
    state: RalphLoopState;
    directory: string;
    apiTimeoutMs: number;
    loopState: LoopStateController;
}): Promise<boolean>;
export {};
