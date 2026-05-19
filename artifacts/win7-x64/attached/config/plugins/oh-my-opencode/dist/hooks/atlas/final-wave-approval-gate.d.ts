import type { SessionState } from "./types";
export declare function shouldPauseForFinalWaveApproval(input: {
    planPath: string;
    taskOutput: string;
    sessionState: SessionState;
}): boolean;
