import type { CapacityConfig, TmuxPaneInfo } from "./types";
export interface GridCapacity {
    cols: number;
    rows: number;
    total: number;
}
export interface GridSlot {
    row: number;
    col: number;
}
export interface GridPlan {
    cols: number;
    rows: number;
    slotWidth: number;
    slotHeight: number;
}
type CapacityOptions = CapacityConfig | number | undefined;
export declare function calculateCapacity(windowWidth: number, windowHeight: number, options?: CapacityOptions, mainPaneWidth?: number): GridCapacity;
export declare function computeGridPlan(windowWidth: number, windowHeight: number, paneCount: number, options?: CapacityOptions, mainPaneWidth?: number): GridPlan;
export declare function mapPaneToSlot(pane: TmuxPaneInfo, plan: GridPlan, mainPaneWidth: number): GridSlot;
export {};
