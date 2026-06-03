import type { OhMyOpenCodeConfig } from "../../config";
import type { PluginContext } from "../types";
import type { RalphLoopHook } from "../../hooks/ralph-loop";
import { createClaudeCodeHooksHook, createKeywordDetectorHook, createThinkingBlockValidatorHook, createToolPairValidatorHook } from "../../hooks";
import { createContextInjectorMessagesTransformHook } from "../../features/context-injector";
export type TransformHooks = {
    claudeCodeHooks: ReturnType<typeof createClaudeCodeHooksHook> | null;
    keywordDetector: ReturnType<typeof createKeywordDetectorHook> | null;
    contextInjectorMessagesTransform: ReturnType<typeof createContextInjectorMessagesTransformHook>;
    thinkingBlockValidator: ReturnType<typeof createThinkingBlockValidatorHook> | null;
    toolPairValidator: ReturnType<typeof createToolPairValidatorHook> | null;
};
export declare function createTransformHooks(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    isHookEnabled: (hookName: string) => boolean;
    safeHookEnabled?: boolean;
    ralphLoop?: RalphLoopHook | null;
}): TransformHooks;
