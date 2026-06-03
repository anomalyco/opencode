import type { BackgroundTask } from "./types";
export declare function handleSessionIdleBackgroundEvent(args: {
    properties: Record<string, unknown>;
    findBySession: (sessionID: string) => BackgroundTask | undefined;
    idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>;
    validateSessionHasOutput: (sessionID: string) => Promise<boolean>;
    checkSessionTodos: (sessionID: string) => Promise<boolean>;
    tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>;
    emitIdleEvent: (sessionID: string) => void;
}): void;
