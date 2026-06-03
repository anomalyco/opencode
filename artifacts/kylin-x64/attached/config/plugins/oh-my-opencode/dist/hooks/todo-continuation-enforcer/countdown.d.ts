import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
import type { ResolvedMessageInfo } from "./types";
import type { SessionStateStore } from "./session-state";
export declare function startCountdown(args: {
    ctx: PluginInput;
    sessionID: string;
    incompleteCount: number;
    total: number;
    resolvedInfo?: ResolvedMessageInfo;
    backgroundManager?: BackgroundManager;
    skipAgents: string[];
    sessionStateStore: SessionStateStore;
    isContinuationStopped?: (sessionID: string) => boolean;
}): void;
