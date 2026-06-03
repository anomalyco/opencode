import type { DelegateTaskArgs } from "./types";
import type { ExecutorContext } from "./executor-types";
import type { DelegatedModelConfig } from "./types";
import type { FallbackEntry } from "../../shared/model-requirements";
export declare function resolveSubagentExecution(args: DelegateTaskArgs, executorCtx: ExecutorContext, parentAgent: string | undefined, categoryExamples: string): Promise<{
    agentToUse: string;
    categoryModel: DelegatedModelConfig | undefined;
    fallbackChain?: FallbackEntry[];
    error?: string;
}>;
