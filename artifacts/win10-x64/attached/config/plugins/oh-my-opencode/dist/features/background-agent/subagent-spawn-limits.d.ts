import type { BackgroundTaskConfig } from "../../config/schema";
import type { OpencodeClient } from "./constants";
export declare const DEFAULT_MAX_SUBAGENT_DEPTH = 3;
export interface SubagentSpawnContext {
    rootSessionID: string;
    parentDepth: number;
    childDepth: number;
}
export declare function getMaxSubagentDepth(config?: BackgroundTaskConfig): number;
export declare function resolveSubagentSpawnContext(client: OpencodeClient, parentSessionID: string, directory?: string): Promise<SubagentSpawnContext>;
export declare function createSubagentDepthLimitError(input: {
    childDepth: number;
    maxDepth: number;
    parentSessionID: string;
    rootSessionID: string;
}): Error;
