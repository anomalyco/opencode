export interface TrackedSession {
    sessionId: string;
    paneId: string;
    description: string;
    createdAt: Date;
    lastSeenAt: Date;
    closePending: boolean;
    closeRetryCount: number;
    lastMessageCount?: number;
    stableIdlePolls?: number;
    activityVersion?: number;
    observedIdleActivityVersion?: number;
}
export declare const MIN_PANE_WIDTH = 52;
export declare const MIN_PANE_HEIGHT = 11;
export interface TmuxPaneInfo {
    paneId: string;
    width: number;
    height: number;
    left: number;
    top: number;
    title: string;
    isActive: boolean;
}
export interface WindowState {
    windowWidth: number;
    windowHeight: number;
    mainPane: TmuxPaneInfo | null;
    agentPanes: TmuxPaneInfo[];
}
export type SplitDirection = "-h" | "-v";
export type PaneAction = {
    type: "close";
    paneId: string;
    sessionId: string;
} | {
    type: "spawn";
    sessionId: string;
    description: string;
    targetPaneId: string;
    splitDirection: SplitDirection;
} | {
    type: "replace";
    paneId: string;
    oldSessionId: string;
    newSessionId: string;
    description: string;
};
export interface SpawnDecision {
    canSpawn: boolean;
    actions: PaneAction[];
    reason?: string;
}
export interface CapacityConfig {
    layout?: string;
    mainPaneSize?: number;
    mainPaneMinWidth: number;
    agentPaneWidth: number;
}
