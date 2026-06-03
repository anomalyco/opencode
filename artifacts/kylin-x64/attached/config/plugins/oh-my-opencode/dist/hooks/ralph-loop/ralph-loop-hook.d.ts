import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopOptions, RalphLoopState } from "./types";
export interface RalphLoopHook {
    event: (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    startLoop: (sessionID: string, prompt: string, options?: {
        maxIterations?: number;
        completionPromise?: string;
        messageCountAtStart?: number;
        ultrawork?: boolean;
        strategy?: "reset" | "continue";
    }) => boolean;
    cancelLoop: (sessionID: string) => boolean;
    getState: () => RalphLoopState | null;
}
export declare function createRalphLoopHook(ctx: PluginInput, options?: RalphLoopOptions): RalphLoopHook;
