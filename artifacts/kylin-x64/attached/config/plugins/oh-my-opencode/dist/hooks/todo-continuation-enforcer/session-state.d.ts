import type { ContinuationProgressOptions, SessionState, Todo } from "./types";
export interface ContinuationProgressUpdate {
    previousIncompleteCount?: number;
    previousStagnationCount: number;
    stagnationCount: number;
    hasProgressed: boolean;
    progressSource: "none" | "todo" | "activity";
}
export interface SessionStateStore {
    getState: (sessionID: string) => SessionState;
    getExistingState: (sessionID: string) => SessionState | undefined;
    recordActivity: (sessionID: string) => void;
    trackContinuationProgress: (sessionID: string, incompleteCount: number, todos?: Todo[], options?: ContinuationProgressOptions) => ContinuationProgressUpdate;
    resetContinuationProgress: (sessionID: string) => void;
    cancelCountdown: (sessionID: string) => void;
    cleanup: (sessionID: string) => void;
    cancelAllCountdowns: () => void;
    shutdown: () => void;
}
export declare function createSessionStateStore(): SessionStateStore;
