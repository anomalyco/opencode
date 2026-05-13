import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundTask, LaunchInput, ResumeInput } from "./types";
import { TaskHistory } from "./task-history";
import type { BackgroundTaskConfig, TmuxConfig } from "../../config/schema";
import { type SubagentSpawnContext } from "./subagent-spawn-limits";
interface EventProperties {
    sessionID?: string;
    info?: {
        id?: string;
    };
    [key: string]: unknown;
}
interface Event {
    type: string;
    properties?: EventProperties;
}
export interface SubagentSessionCreatedEvent {
    sessionID: string;
    parentID: string;
    title: string;
}
export type OnSubagentSessionCreated = (event: SubagentSessionCreatedEvent) => Promise<void>;
export declare class BackgroundManager {
    private tasks;
    private notifications;
    private pendingNotifications;
    private pendingByParent;
    private client;
    private directory;
    private pollingInterval?;
    private pollingInFlight;
    private concurrencyManager;
    private shutdownTriggered;
    private config?;
    private tmuxEnabled;
    private onSubagentSessionCreated?;
    private onShutdown?;
    private queuesByKey;
    private processingKeys;
    private completionTimers;
    private completedTaskSummaries;
    private idleDeferralTimers;
    private notificationQueueByParent;
    private observedOutputSessions;
    private observedIncompleteTodosBySession;
    private rootDescendantCounts;
    private preStartDescendantReservations;
    private enableParentSessionNotifications;
    readonly taskHistory: TaskHistory;
    private cachedCircuitBreakerSettings?;
    constructor(ctx: PluginInput, config?: BackgroundTaskConfig, options?: {
        tmuxConfig?: TmuxConfig;
        onSubagentSessionCreated?: OnSubagentSessionCreated;
        onShutdown?: () => void | Promise<void>;
        enableParentSessionNotifications?: boolean;
    });
    private abortSessionWithLogging;
    assertCanSpawn(parentSessionID: string): Promise<SubagentSpawnContext>;
    reserveSubagentSpawn(parentSessionID: string): Promise<{
        spawnContext: SubagentSpawnContext;
        descendantCount: number;
        commit: () => number;
        rollback: () => void;
    }>;
    private registerRootDescendant;
    private unregisterRootDescendant;
    private markPreStartDescendantReservation;
    private settlePreStartDescendantReservation;
    private rollbackPreStartDescendantReservation;
    launch(input: LaunchInput): Promise<BackgroundTask>;
    private processKey;
    private startTask;
    getTask(id: string): BackgroundTask | undefined;
    getTasksByParentSession(sessionID: string): BackgroundTask[];
    getAllDescendantTasks(sessionID: string): BackgroundTask[];
    findBySession(sessionID: string): BackgroundTask | undefined;
    private getConcurrencyKeyFromInput;
    /**
     * Track a task created elsewhere (e.g., from task) for notification tracking.
     * This allows tasks created by other tools to receive the same toast/prompt notifications.
     */
    trackTask(input: {
        taskId: string;
        sessionID: string;
        parentSessionID: string;
        description: string;
        agent?: string;
        parentAgent?: string;
        concurrencyKey?: string;
    }): Promise<BackgroundTask>;
    resume(input: ResumeInput): Promise<BackgroundTask>;
    private checkSessionTodos;
    private markSessionOutputObserved;
    private clearSessionOutputObserved;
    private clearSessionTodoObservation;
    private hasOutputSignalFromPart;
    handleEvent(event: Event): void;
    private handleSessionErrorEvent;
    private tryFallbackRetry;
    markForNotification(task: BackgroundTask): void;
    getPendingNotifications(sessionID: string): BackgroundTask[];
    clearNotifications(sessionID: string): void;
    queuePendingNotification(sessionID: string | undefined, notification: string): void;
    injectPendingNotificationsIntoChatMessage(output: {
        parts: Array<{
            type: string;
            text?: string;
            [key: string]: unknown;
        }>;
    }, sessionID: string): void;
    /**
     * Validates that a session has actual assistant/tool output before marking complete.
     * Prevents premature completion when session.idle fires before agent responds.
     */
    private validateSessionHasOutput;
    private clearNotificationsForTask;
    /**
     * Remove task from pending tracking for its parent session.
     * Cleans up the parent entry if no pending tasks remain.
     */
    private cleanupPendingByParent;
    private clearTaskHistoryWhenParentTasksGone;
    private scheduleTaskRemoval;
    cancelTask(taskId: string, options?: {
        source?: string;
        reason?: string;
        abortSession?: boolean;
        skipNotification?: boolean;
    }): Promise<boolean>;
    /**
     * Cancels a pending task by removing it from queue and marking as cancelled.
     * Does NOT abort session (no session exists yet) or release concurrency slot (wasn't acquired).
     */
    cancelPendingTask(taskId: string): boolean;
    private startPolling;
    private stopPolling;
    private registerProcessCleanup;
    private unregisterProcessCleanup;
    /**
     * Get all running tasks (for compaction hook)
     */
    getRunningTasks(): BackgroundTask[];
    /**
     * Get all non-running tasks still in memory (for compaction hook)
     */
    getNonRunningTasks(): BackgroundTask[];
    /**
     * Safely complete a task with race condition protection.
     * Returns true if task was successfully completed, false if already completed by another path.
     */
    private tryCompleteTask;
    private notifyParentSession;
    private hasRunningTasks;
    private pruneStaleTasksAndNotifications;
    private checkAndInterruptStaleTasks;
    private verifySessionExists;
    private failCrashedTask;
    private pollRunningTasks;
    /**
     * Shutdown the manager gracefully.
     * Cancels all pending concurrency waiters and clears timers.
     * Should be called when the plugin is unloaded.
     */
    shutdown(): Promise<void>;
    private enqueueNotificationForParent;
}
export {};
