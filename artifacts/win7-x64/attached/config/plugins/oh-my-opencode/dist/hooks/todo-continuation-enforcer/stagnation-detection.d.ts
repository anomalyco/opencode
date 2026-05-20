import type { ContinuationProgressUpdate } from "./session-state";
export declare function shouldStopForStagnation(args: {
    sessionID: string;
    incompleteCount: number;
    progressUpdate: ContinuationProgressUpdate;
}): boolean;
