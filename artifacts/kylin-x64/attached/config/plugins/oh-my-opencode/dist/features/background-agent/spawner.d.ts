import type { BackgroundTask, LaunchInput, ResumeInput } from "./types";
import type { OpencodeClient, OnSubagentSessionCreated, QueueItem } from "./constants";
import type { ConcurrencyManager } from "./concurrency";
export declare const FALLBACK_AGENT = "general";
export declare function isAgentNotFoundError(error: unknown): boolean;
export declare function buildFallbackBody(originalBody: Record<string, unknown>, fallbackAgent: string): Record<string, unknown>;
export interface SpawnerContext {
    client: OpencodeClient;
    directory: string;
    concurrencyManager: ConcurrencyManager;
    tmuxEnabled: boolean;
    onSubagentSessionCreated?: OnSubagentSessionCreated;
    onTaskError: (task: BackgroundTask, error: Error) => void;
}
export declare function createTask(input: LaunchInput): BackgroundTask;
export declare function startTask(item: QueueItem, ctx: SpawnerContext): Promise<void>;
export declare function resumeTask(task: BackgroundTask, input: ResumeInput, ctx: Pick<SpawnerContext, "client" | "concurrencyManager" | "onTaskError">): Promise<void>;
