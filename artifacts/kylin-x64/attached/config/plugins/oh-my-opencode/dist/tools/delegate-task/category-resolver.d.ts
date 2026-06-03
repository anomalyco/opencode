import type { ModelFallbackInfo } from "../../features/task-toast-manager/types";
import type { DelegateTaskArgs } from "./types";
import type { ExecutorContext } from "./executor-types";
import type { FallbackEntry } from "../../shared/model-requirements";
import type { DelegatedModelConfig } from "./types";
export interface CategoryResolutionResult {
    agentToUse: string;
    categoryModel: DelegatedModelConfig | undefined;
    categoryPromptAppend: string | undefined;
    maxPromptTokens?: number;
    modelInfo: ModelFallbackInfo | undefined;
    actualModel: string | undefined;
    isUnstableAgent: boolean;
    fallbackChain?: FallbackEntry[];
    error?: string;
}
export declare function resolveCategoryExecution(args: DelegateTaskArgs, executorCtx: ExecutorContext, inheritedModel: string | undefined, systemDefaultModel: string | undefined): Promise<CategoryResolutionResult>;
