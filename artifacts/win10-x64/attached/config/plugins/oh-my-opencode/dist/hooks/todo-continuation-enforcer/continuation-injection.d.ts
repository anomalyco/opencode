import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
import type { ResolvedMessageInfo } from "./types";
import type { SessionStateStore } from "./session-state";
export declare function injectContinuation(args: {
    ctx: PluginInput;
    sessionID: string;
    backgroundManager?: BackgroundManager;
    skipAgents?: string[];
    resolvedInfo?: ResolvedMessageInfo;
    sessionStateStore: SessionStateStore;
    isContinuationStopped?: (sessionID: string) => boolean;
}): Promise<void>;
