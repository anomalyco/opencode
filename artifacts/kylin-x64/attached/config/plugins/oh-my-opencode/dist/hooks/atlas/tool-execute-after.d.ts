import type { PluginInput } from "@opencode-ai/plugin";
import type { PendingTaskRef, SessionState } from "./types";
import type { ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types";
export declare function createToolExecuteAfterHandler(input: {
    ctx: PluginInput;
    pendingFilePaths: Map<string, string>;
    pendingTaskRefs: Map<string, PendingTaskRef>;
    autoCommit: boolean;
    getState: (sessionID: string) => SessionState;
}): (toolInput: ToolExecuteAfterInput, toolOutput: ToolExecuteAfterOutput) => Promise<void>;
