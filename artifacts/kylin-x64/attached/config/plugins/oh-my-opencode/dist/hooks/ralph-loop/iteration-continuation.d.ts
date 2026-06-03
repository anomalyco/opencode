import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopState } from "./types";
type ContinuationOptions = {
    directory: string;
    apiTimeoutMs: number;
    previousSessionID: string;
    loopState: {
        setSessionID: (sessionID: string) => RalphLoopState | null;
    };
};
export declare function continueIteration(ctx: PluginInput, state: RalphLoopState, options: ContinuationOptions): Promise<void>;
export {};
