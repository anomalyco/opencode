import type { ModelFallbackInfo } from "../../features/task-toast-manager/types";
import type { DelegateTaskArgs, ToolContextWithMetadata, DelegatedModelConfig } from "./types";
import type { ExecutorContext, ParentContext } from "./executor-types";
import { type SyncTaskDeps } from "./sync-task-deps";
export declare function executeSyncTask(args: DelegateTaskArgs, ctx: ToolContextWithMetadata, executorCtx: ExecutorContext, parentContext: ParentContext, agentToUse: string, categoryModel: DelegatedModelConfig | undefined, systemContent: string | undefined, modelInfo?: ModelFallbackInfo, fallbackChain?: import("../../shared/model-requirements").FallbackEntry[], deps?: SyncTaskDeps): Promise<string>;
