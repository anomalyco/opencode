import type { SplitDirection, TmuxPaneInfo } from "./types";
export declare function getColumnCount(paneCount: number): number;
export declare function getColumnWidth(agentAreaWidth: number, paneCount: number): number;
export declare function isSplittableAtCount(agentAreaWidth: number, paneCount: number, minPaneWidth?: number): boolean;
export declare function findMinimalEvictions(agentAreaWidth: number, currentCount: number, minPaneWidth?: number): number | null;
export declare function canSplitPane(pane: TmuxPaneInfo, direction: SplitDirection, minPaneWidth?: number): boolean;
export declare function canSplitPaneAnyDirection(pane: TmuxPaneInfo, minPaneWidth?: number): boolean;
export declare function getBestSplitDirection(pane: TmuxPaneInfo, minPaneWidth?: number): SplitDirection | null;
