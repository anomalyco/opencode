import type { AgentOverrides } from "../../config";
import type { BackgroundManager } from "../../features/background-agent";
import type { TopLevelTaskRef } from "../../features/boulder-state";
export type ModelInfo = {
    providerID: string;
    modelID: string;
    variant?: string;
};
export interface AtlasHookOptions {
    directory: string;
    backgroundManager?: BackgroundManager;
    isContinuationStopped?: (sessionID: string) => boolean;
    agentOverrides?: AgentOverrides;
    /** Enable auto-commit after each atomic task completion (default: true) */
    autoCommit?: boolean;
}
export interface ToolExecuteAfterInput {
    tool: string;
    sessionID?: string;
    callID?: string;
}
export interface ToolExecuteAfterOutput {
    title: string;
    output: string;
    metadata: Record<string, unknown>;
}
export type TrackedTopLevelTaskRef = Pick<TopLevelTaskRef, "key" | "label" | "title">;
export type PendingTaskRef = {
    kind: "track";
    task: TrackedTopLevelTaskRef;
} | {
    kind: "skip";
    reason: "explicit_resume";
} | {
    kind: "skip";
    reason: "ambiguous_task_key";
    task: TrackedTopLevelTaskRef;
};
export interface SessionState {
    lastEventWasAbortError?: boolean;
    lastContinuationInjectedAt?: number;
    isInjectingContinuation?: boolean;
    promptFailureCount: number;
    lastFailureAt?: number;
    pendingRetryTimer?: ReturnType<typeof setTimeout>;
    waitingForFinalWaveApproval?: boolean;
    pendingFinalWaveTaskCount?: number;
    approvedFinalWaveTaskCount?: number;
}
