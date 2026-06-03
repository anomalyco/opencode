import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
import type { SessionStateStore } from "./session-state";
export declare function createTodoContinuationHandler(args: {
    ctx: PluginInput;
    sessionStateStore: SessionStateStore;
    backgroundManager?: BackgroundManager;
    skipAgents?: string[];
    isContinuationStopped?: (sessionID: string) => boolean;
}): (input: {
    event: {
        type: string;
        properties?: unknown;
    };
}) => Promise<void>;
