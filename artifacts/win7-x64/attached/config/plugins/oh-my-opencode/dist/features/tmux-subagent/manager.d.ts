import type { PluginInput } from "@opencode-ai/plugin";
import type { TmuxConfig } from "../../config/schema";
interface SessionCreatedEvent {
    type: string;
    properties?: {
        info?: {
            id?: string;
            parentID?: string;
            title?: string;
        };
    };
}
export interface TmuxUtilDeps {
    isInsideTmux: () => boolean;
    getCurrentPaneId: () => string | undefined;
}
export declare class TmuxSessionManager {
    private client;
    private tmuxConfig;
    private serverUrl;
    private sourcePaneId;
    private sessions;
    private pendingSessions;
    private spawnQueue;
    private deferredSessions;
    private deferredQueue;
    private deferredAttachInterval?;
    private deferredAttachTickScheduled;
    private nullStateCount;
    private deps;
    private pollingManager;
    private isolatedContainerPaneId;
    private isolatedWindowPaneId;
    private isolatedContainerNullStateCount;
    constructor(ctx: PluginInput, tmuxConfig: TmuxConfig, deps?: TmuxUtilDeps);
    private isEnabled;
    private isIsolated;
    private getEffectiveSourcePaneId;
    private spawnInIsolatedContainer;
    private getCapacityConfig;
    private getSessionMappings;
    getTrackedPaneId(sessionId: string): string | undefined;
    private removeTrackedSession;
    private reassignIsolatedContainerAnchor;
    private cleanupIsolatedContainerAfterSessionDeletion;
    private markSessionClosePending;
    private queryWindowStateSafely;
    private closeTrackedSessionPane;
    private finalizeTrackedSessionClose;
    private closeTrackedSession;
    private retryPendingCloses;
    private enqueueDeferredSession;
    private removeDeferredSession;
    private startDeferredAttachLoop;
    private stopDeferredAttachLoop;
    private tryAttachDeferredSession;
    private waitForSessionReady;
    onSessionCreated(event: SessionCreatedEvent): Promise<void>;
    private enqueueSpawn;
    onSessionDeleted(event: {
        sessionID: string;
    }): Promise<void>;
    private closeSessionById;
    onEvent(event: {
        type: string;
        properties?: Record<string, unknown>;
    }): void;
    createEventHandler(): (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    cleanup(): Promise<void>;
}
export {};
