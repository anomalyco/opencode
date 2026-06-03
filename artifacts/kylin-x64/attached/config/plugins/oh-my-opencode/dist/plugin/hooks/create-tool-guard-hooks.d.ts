import type { HookName, OhMyOpenCodeConfig } from "../../config";
import type { ModelCacheState } from "../../plugin-state";
import type { PluginContext } from "../types";
import { createCommentCheckerHooks, createToolOutputTruncatorHook, createDirectoryAgentsInjectorHook, createDirectoryReadmeInjectorHook, createEmptyTaskResponseDetectorHook, createRulesInjectorHook, createTasksTodowriteDisablerHook, createWriteExistingFileGuardHook, createBashFileReadGuardHook, createHashlineReadEnhancerHook, createReadImageResizerHook, createJsonErrorRecoveryHook, createTodoDescriptionOverrideHook, createWebFetchRedirectGuardHook } from "../../hooks";
export type ToolGuardHooks = {
    commentChecker: ReturnType<typeof createCommentCheckerHooks> | null;
    toolOutputTruncator: ReturnType<typeof createToolOutputTruncatorHook> | null;
    directoryAgentsInjector: ReturnType<typeof createDirectoryAgentsInjectorHook> | null;
    directoryReadmeInjector: ReturnType<typeof createDirectoryReadmeInjectorHook> | null;
    emptyTaskResponseDetector: ReturnType<typeof createEmptyTaskResponseDetectorHook> | null;
    rulesInjector: ReturnType<typeof createRulesInjectorHook> | null;
    tasksTodowriteDisabler: ReturnType<typeof createTasksTodowriteDisablerHook> | null;
    writeExistingFileGuard: ReturnType<typeof createWriteExistingFileGuardHook> | null;
    bashFileReadGuard: ReturnType<typeof createBashFileReadGuardHook> | null;
    hashlineReadEnhancer: ReturnType<typeof createHashlineReadEnhancerHook> | null;
    jsonErrorRecovery: ReturnType<typeof createJsonErrorRecoveryHook> | null;
    readImageResizer: ReturnType<typeof createReadImageResizerHook> | null;
    todoDescriptionOverride: ReturnType<typeof createTodoDescriptionOverrideHook> | null;
    webfetchRedirectGuard: ReturnType<typeof createWebFetchRedirectGuardHook> | null;
};
export declare function createToolGuardHooks(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    modelCacheState: ModelCacheState;
    isHookEnabled: (hookName: HookName) => boolean;
    safeHookEnabled: boolean;
}): ToolGuardHooks;
