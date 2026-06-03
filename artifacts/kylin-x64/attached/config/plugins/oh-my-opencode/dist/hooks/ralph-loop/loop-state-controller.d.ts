import type { RalphLoopOptions, RalphLoopState } from "./types";
export declare function createLoopStateController(options: {
    directory: string;
    stateDir: string | undefined;
    config: RalphLoopOptions["config"] | undefined;
}): {
    startLoop(sessionID: string, prompt: string, loopOptions?: {
        maxIterations?: number;
        completionPromise?: string;
        messageCountAtStart?: number;
        ultrawork?: boolean;
        strategy?: "reset" | "continue";
    }): boolean;
    cancelLoop(sessionID: string): boolean;
    getState(): RalphLoopState | null;
    clear(): boolean;
    incrementIteration(): RalphLoopState | null;
    setSessionID(sessionID: string): RalphLoopState | null;
    setMessageCountAtStart(sessionID: string, messageCountAtStart: number): RalphLoopState | null;
    markVerificationPending(sessionID: string): RalphLoopState | null;
    setVerificationSessionID(sessionID: string, verificationSessionID: string): RalphLoopState | null;
    restartAfterFailedVerification(sessionID: string, messageCountAtStart?: number): RalphLoopState | null;
};
