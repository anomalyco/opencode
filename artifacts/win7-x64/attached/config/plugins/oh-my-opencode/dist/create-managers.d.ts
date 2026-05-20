import type { OhMyOpenCodeConfig } from "./config";
import type { ModelCacheState } from "./plugin-state";
import type { PluginContext, TmuxConfig } from "./plugin/types";
import { BackgroundManager } from "./features/background-agent";
import { SkillMcpManager } from "./features/skill-mcp-manager";
import { initTaskToastManager } from "./features/task-toast-manager";
import { TmuxSessionManager } from "./features/tmux-subagent";
import { registerManagerForCleanup } from "./features/background-agent/process-cleanup";
import { createConfigHandler } from "./plugin-handlers";
import { markServerRunningInProcess } from "./shared/tmux/tmux-utils/server-health";
type CreateManagersDeps = {
    BackgroundManagerClass: typeof BackgroundManager;
    SkillMcpManagerClass: typeof SkillMcpManager;
    TmuxSessionManagerClass: typeof TmuxSessionManager;
    initTaskToastManagerFn: typeof initTaskToastManager;
    registerManagerForCleanupFn: typeof registerManagerForCleanup;
    createConfigHandlerFn: typeof createConfigHandler;
    markServerRunningInProcessFn: typeof markServerRunningInProcess;
};
export type Managers = {
    tmuxSessionManager: TmuxSessionManager;
    backgroundManager: BackgroundManager;
    skillMcpManager: SkillMcpManager;
    configHandler: ReturnType<typeof createConfigHandler>;
};
export declare function createManagers(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    tmuxConfig: TmuxConfig;
    modelCacheState: ModelCacheState;
    backgroundNotificationHookEnabled: boolean;
    deps?: Partial<CreateManagersDeps>;
}): Managers;
export {};
