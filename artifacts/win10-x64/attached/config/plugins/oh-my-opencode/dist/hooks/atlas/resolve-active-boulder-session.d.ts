import type { PluginInput } from "@opencode-ai/plugin";
import type { BoulderState, PlanProgress } from "../../features/boulder-state";
export declare function resolveActiveBoulderSession(input: {
    client: PluginInput["client"];
    directory: string;
    sessionID: string;
}): Promise<{
    boulderState: BoulderState;
    progress: PlanProgress;
    appendedSession: boolean;
} | null>;
