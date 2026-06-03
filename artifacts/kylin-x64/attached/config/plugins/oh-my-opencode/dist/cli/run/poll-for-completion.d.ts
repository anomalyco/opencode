import type { RunContext } from "./types";
import type { EventState } from "./events";
export interface PollOptions {
    pollIntervalMs?: number;
    requiredConsecutive?: number;
    minStabilizationMs?: number;
    eventWatchdogMs?: number;
    secondaryMeaningfulWorkTimeoutMs?: number;
}
export declare function pollForCompletion(ctx: RunContext, eventState: EventState, abortController: AbortController, options?: PollOptions): Promise<number>;
