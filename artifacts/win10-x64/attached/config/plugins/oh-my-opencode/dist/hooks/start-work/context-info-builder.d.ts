import { readBoulderState } from "../../features/boulder-state";
import type { PluginInput } from "@opencode-ai/plugin";
export declare function buildStartWorkContextInfo(params: {
    ctx: PluginInput;
    explicitPlanName: string | null;
    existingState: ReturnType<typeof readBoulderState>;
    sessionId: string;
    timestamp: string;
    activeAgent: string;
    worktreePath: string | undefined;
    worktreeBlock: string;
}): string;
