import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
import type { SessionStateStore } from "./session-state";
export declare function handleSessionIdle(args: {
    ctx: PluginInput;
    sessionID: string;
    sessionStateStore: SessionStateStore;
    backgroundManager?: BackgroundManager;
    skipAgents?: string[];
    isContinuationStopped?: (sessionID: string) => boolean;
}): Promise<void>;
