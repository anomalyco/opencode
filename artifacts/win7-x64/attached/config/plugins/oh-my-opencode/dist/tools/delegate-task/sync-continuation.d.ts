import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types";
import type { ExecutorContext } from "./executor-types";
import { type SyncContinuationDeps } from "./sync-continuation-deps";
export declare function executeSyncContinuation(args: DelegateTaskArgs, ctx: ToolContextWithMetadata, executorCtx: ExecutorContext, deps?: SyncContinuationDeps): Promise<string>;
