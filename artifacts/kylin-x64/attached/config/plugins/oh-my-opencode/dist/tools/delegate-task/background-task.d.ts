import type { DelegateTaskArgs, ToolContextWithMetadata, DelegatedModelConfig } from "./types";
import type { ExecutorContext, ParentContext } from "./executor-types";
import type { FallbackEntry } from "../../shared/model-requirements";
export declare function executeBackgroundTask(args: DelegateTaskArgs, ctx: ToolContextWithMetadata, executorCtx: ExecutorContext, parentContext: ParentContext, agentToUse: string, categoryModel: DelegatedModelConfig | undefined, systemContent: string | undefined, fallbackChain?: FallbackEntry[]): Promise<string>;
