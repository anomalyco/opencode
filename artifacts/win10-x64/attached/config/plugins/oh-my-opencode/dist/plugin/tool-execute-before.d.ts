import type { PluginContext } from "./types";
import type { CreatedHooks } from "../create-hooks";
export declare function createToolExecuteBeforeHandler(args: {
    ctx: PluginContext;
    hooks: CreatedHooks;
}): (input: {
    tool: string;
    sessionID: string;
    callID: string;
}, output: {
    args: Record<string, unknown>;
}) => Promise<void>;
