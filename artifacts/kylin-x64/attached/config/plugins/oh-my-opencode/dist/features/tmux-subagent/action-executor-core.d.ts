import type { TmuxConfig } from "../../config/schema";
import type { applyLayout, closeTmuxPane, enforceMainPaneWidth, replaceTmuxPane, spawnTmuxPane } from "../../shared/tmux";
import type { PaneAction, WindowState } from "./types";
export interface ActionResult {
    success: boolean;
    paneId?: string;
    error?: string;
}
export interface ExecuteContext {
    config: TmuxConfig;
    serverUrl: string;
    windowState: WindowState;
}
export interface ActionExecutorDeps {
    spawnTmuxPane: typeof spawnTmuxPane;
    closeTmuxPane: typeof closeTmuxPane;
    replaceTmuxPane: typeof replaceTmuxPane;
    applyLayout: typeof applyLayout;
    enforceMainPaneWidth: typeof enforceMainPaneWidth;
}
export declare function executeActionWithDeps(action: PaneAction, ctx: ExecuteContext, deps: ActionExecutorDeps): Promise<ActionResult>;
