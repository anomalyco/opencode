import type { CapacityConfig, SplitDirection, WindowState } from "./types";
export interface SpawnTarget {
    targetPaneId: string;
    splitDirection: SplitDirection;
}
export declare function findSpawnTarget(state: WindowState, config: CapacityConfig): SpawnTarget | null;
