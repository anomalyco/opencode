import type { TmuxConfig } from "../../config/schema";
import type { PaneAction, WindowState } from "./types";
import type { ActionResult } from "./action-executor-core";
export type { ActionExecutorDeps, ActionResult } from "./action-executor-core";
export interface ExecuteActionsResult {
    success: boolean;
    spawnedPaneId?: string;
    results: Array<{
        action: PaneAction;
        result: ActionResult;
    }>;
}
export interface ExecuteContext {
    config: TmuxConfig;
    serverUrl: string;
    windowState: WindowState;
    sourcePaneId?: string;
}
export declare function executeAction(action: PaneAction, ctx: ExecuteContext): Promise<ActionResult>;
export declare function executeActions(actions: PaneAction[], ctx: ExecuteContext): Promise<ExecuteActionsResult>;
