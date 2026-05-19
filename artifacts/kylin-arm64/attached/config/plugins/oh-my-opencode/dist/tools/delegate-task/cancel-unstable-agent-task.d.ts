import type { ExecutorContext } from "./executor-types";
export declare function cancelUnstableAgentTask(manager: ExecutorContext["manager"], taskID: string | undefined, reason: string): Promise<void>;
