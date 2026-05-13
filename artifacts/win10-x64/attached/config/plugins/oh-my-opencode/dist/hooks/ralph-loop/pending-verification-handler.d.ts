import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopState } from "./types";
type LoopStateController = {
    restartAfterFailedVerification: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null;
    setVerificationSessionID: (sessionID: string, verificationSessionID: string) => RalphLoopState | null;
};
export declare function handlePendingVerification(ctx: PluginInput, input: {
    sessionID: string;
    state: RalphLoopState;
    verificationSessionID?: string;
    matchesParentSession: boolean;
    matchesVerificationSession: boolean;
    loopState: LoopStateController;
    directory: string;
    apiTimeoutMs: number;
}): Promise<void>;
export {};
