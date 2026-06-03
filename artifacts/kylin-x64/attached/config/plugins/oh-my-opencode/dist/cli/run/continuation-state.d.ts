import type { RunContext } from "./types";
export interface ContinuationState {
    hasActiveBoulder: boolean;
    hasActiveRalphLoop: boolean;
    hasHookMarker: boolean;
    hasTodoHookMarker: boolean;
    hasActiveHookMarker: boolean;
    activeHookMarkerReason: string | null;
}
export declare function getContinuationState(directory: string, sessionID: string, client?: RunContext["client"]): Promise<ContinuationState>;
