import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
import type { SessionState } from "./types";
export type BoulderContinuationResult = "injected" | "skipped_background_tasks" | "skipped_agent_unavailable" | "failed";
export declare function injectBoulderContinuation(input: {
    ctx: PluginInput;
    sessionID: string;
    planName: string;
    remaining: number;
    total: number;
    agent?: string;
    worktreePath?: string;
    preferredTaskSessionId?: string;
    preferredTaskTitle?: string;
    backgroundManager?: BackgroundManager;
    sessionState: SessionState;
}): Promise<BoulderContinuationResult>;
