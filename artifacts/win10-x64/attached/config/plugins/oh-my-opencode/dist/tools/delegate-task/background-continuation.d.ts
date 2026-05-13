import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types";
import type { ExecutorContext, ParentContext } from "./executor-types";
export declare function executeBackgroundContinuation(args: DelegateTaskArgs, ctx: ToolContextWithMetadata, executorCtx: ExecutorContext, parentContext: ParentContext): Promise<string>;
