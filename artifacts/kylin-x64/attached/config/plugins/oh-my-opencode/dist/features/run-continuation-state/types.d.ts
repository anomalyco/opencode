export type ContinuationMarkerSource = "todo" | "stop";
export type ContinuationMarkerState = "idle" | "active" | "stopped";
export interface ContinuationMarkerSourceEntry {
    state: ContinuationMarkerState;
    reason?: string;
    updatedAt: string;
}
export interface ContinuationMarker {
    sessionID: string;
    updatedAt: string;
    sources: Partial<Record<ContinuationMarkerSource, ContinuationMarkerSourceEntry>>;
}
