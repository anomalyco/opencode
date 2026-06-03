import type { FallbackEntry } from "../../shared/model-requirements";
import type { DelegatedModelConfig } from "../../shared/model-resolution-types";
import type { SessionPermissionRule } from "../../shared/question-denied-session-permission";
export type BackgroundTaskStatus = "pending" | "running" | "completed" | "error" | "cancelled" | "interrupt";
export interface ToolCallWindow {
    lastSignature: string;
    consecutiveCount: number;
    threshold: number;
}
export interface TaskProgress {
    toolCalls: number;
    lastTool?: string;
    toolCallWindow?: ToolCallWindow;
    countedToolPartIDs?: Set<string>;
    lastUpdate: Date;
    lastMessage?: string;
    lastMessageAt?: Date;
}
export interface BackgroundTask {
    id: string;
    sessionID?: string;
    rootSessionID?: string;
    parentSessionID: string;
    parentMessageID: string;
    description: string;
    prompt: string;
    agent: string;
    spawnDepth?: number;
    status: BackgroundTaskStatus;
    queuedAt?: Date;
    startedAt?: Date;
    completedAt?: Date;
    result?: string;
    error?: string;
    progress?: TaskProgress;
    parentModel?: {
        providerID: string;
        modelID: string;
    };
    model?: DelegatedModelConfig;
    /** Fallback chain for runtime retry on model errors */
    fallbackChain?: FallbackEntry[];
    /** Number of fallback retry attempts made */
    attemptCount?: number;
    /** Active concurrency slot key */
    concurrencyKey?: string;
    /** Persistent key for re-acquiring concurrency on resume */
    concurrencyGroup?: string;
    /** Parent session's agent name for notification */
    parentAgent?: string;
    /** Parent session's tool restrictions for notification prompts */
    parentTools?: Record<string, boolean>;
    /** Marks if the task was launched from an unstable agent/category */
    isUnstableAgent?: boolean;
    /** Category used for this task (e.g., 'quick', 'visual-engineering') */
    category?: string;
    /** Last message count for stability detection */
    lastMsgCount?: number;
    /** Number of consecutive polls with stable message count */
    stablePolls?: number;
    /** Number of consecutive polls where session was missing from status map */
    consecutiveMissedPolls?: number;
}
export interface LaunchInput {
    description: string;
    prompt: string;
    agent: string;
    parentSessionID: string;
    parentMessageID: string;
    parentModel?: {
        providerID: string;
        modelID: string;
    };
    parentAgent?: string;
    parentTools?: Record<string, boolean>;
    model?: DelegatedModelConfig;
    /** Fallback chain for runtime retry on model errors */
    fallbackChain?: FallbackEntry[];
    isUnstableAgent?: boolean;
    skills?: string[];
    skillContent?: string;
    category?: string;
    sessionPermission?: SessionPermissionRule[];
}
export interface ResumeInput {
    sessionId: string;
    prompt: string;
    parentSessionID: string;
    parentMessageID: string;
    parentModel?: {
        providerID: string;
        modelID: string;
    };
    parentAgent?: string;
    parentTools?: Record<string, boolean>;
}
