import type { SessionStateStore } from "./session-state";
export declare function handleNonIdleEvent(args: {
    eventType: string;
    properties: Record<string, unknown> | undefined;
    sessionStateStore: SessionStateStore;
}): void;
