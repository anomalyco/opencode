import type { PluginInput } from "@opencode-ai/plugin";
import { type BoulderState } from "../../features/boulder-state";
import type { PendingTaskRef, ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types";
export declare function syncBackgroundLaunchSessionTracking(input: {
    ctx: PluginInput;
    boulderState: BoulderState | null;
    toolInput: ToolExecuteAfterInput;
    toolOutput: ToolExecuteAfterOutput;
    pendingTaskRef: PendingTaskRef | undefined;
    metadataSessionId?: string;
}): Promise<void>;
