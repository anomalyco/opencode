import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundTask, LaunchInput } from "./types";
export declare const TASK_TTL_MS: number;
export declare const TERMINAL_TASK_TTL_MS: number;
export declare const MIN_STABILITY_TIME_MS: number;
export declare const DEFAULT_STALE_TIMEOUT_MS = 2700000;
export declare const DEFAULT_MESSAGE_STALENESS_TIMEOUT_MS = 3600000;
export declare const DEFAULT_MAX_TOOL_CALLS = 4000;
export declare const DEFAULT_CIRCUIT_BREAKER_CONSECUTIVE_THRESHOLD = 20;
export declare const DEFAULT_CIRCUIT_BREAKER_ENABLED = true;
export declare const MIN_RUNTIME_BEFORE_STALE_MS = 30000;
export declare const DEFAULT_SESSION_GONE_TIMEOUT_MS = 60000;
export declare const MIN_IDLE_TIME_MS = 5000;
export declare const POLLING_INTERVAL_MS = 3000;
export declare const TASK_CLEANUP_DELAY_MS: number;
export declare const TMUX_CALLBACK_DELAY_MS = 200;
export type ProcessCleanupEvent = NodeJS.Signals | "beforeExit" | "exit";
export type OpencodeClient = PluginInput["client"];
export interface MessagePartInfo {
    sessionID?: string;
    type?: string;
    tool?: string;
}
export interface EventProperties {
    sessionID?: string;
    info?: {
        id?: string;
    };
    [key: string]: unknown;
}
export interface BackgroundEvent {
    type: string;
    properties?: EventProperties;
}
export interface Todo {
    content: string;
    status: string;
    priority: string;
    id?: string;
}
export interface QueueItem {
    task: BackgroundTask;
    input: LaunchInput;
}
export interface SubagentSessionCreatedEvent {
    sessionID: string;
    parentID: string;
    title: string;
}
export type OnSubagentSessionCreated = (event: SubagentSessionCreatedEvent) => Promise<void>;
