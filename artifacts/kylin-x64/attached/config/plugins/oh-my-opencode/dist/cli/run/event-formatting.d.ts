import type { RunContext, EventPayload } from "./types";
export declare function serializeError(error: unknown): string;
export declare function logEventVerbose(ctx: RunContext, payload: EventPayload): void;
