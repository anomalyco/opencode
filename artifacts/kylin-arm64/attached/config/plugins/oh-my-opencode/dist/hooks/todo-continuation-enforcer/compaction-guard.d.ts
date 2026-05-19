import type { SessionState } from "./types";
export declare function armCompactionGuard(state: SessionState, now: number): number;
export declare function acknowledgeCompactionGuard(state: SessionState, compactionEpoch: number | undefined): boolean;
export declare function isCompactionGuardActive(state: SessionState, now: number): boolean;
