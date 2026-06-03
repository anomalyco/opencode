import type { DelegateTaskArgs, ToolContextWithMetadata, DelegatedModelConfig } from "./types";
import type { ExecutorContext, ParentContext } from "./executor-types";
export declare function executeUnstableAgentTask(args: DelegateTaskArgs, ctx: ToolContextWithMetadata, executorCtx: ExecutorContext, parentContext: ParentContext, agentToUse: string, categoryModel: DelegatedModelConfig | undefined, systemContent: string | undefined, actualModel: string | undefined): Promise<string>;
