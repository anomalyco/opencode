import type { ContinuationMarker, ContinuationMarkerSource, ContinuationMarkerState } from "./types";
export declare function readContinuationMarker(directory: string, sessionID: string): ContinuationMarker | null;
export declare function setContinuationMarkerSource(directory: string, sessionID: string, source: ContinuationMarkerSource, state: ContinuationMarkerState, reason?: string): ContinuationMarker;
export declare function clearContinuationMarker(directory: string, sessionID: string): void;
export declare function isContinuationMarkerActive(marker: ContinuationMarker | null): boolean;
export declare function getActiveContinuationMarkerReason(marker: ContinuationMarker | null): string | null;
