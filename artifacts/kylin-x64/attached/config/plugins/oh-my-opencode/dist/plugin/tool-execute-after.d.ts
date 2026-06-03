import type { CreatedHooks } from "../create-hooks";
import type { PluginContext } from "./types";
export declare function createToolExecuteAfterHandler(args: {
    ctx: PluginContext;
    hooks: CreatedHooks;
}): (input: {
    tool: string;
    sessionID: string;
    callID: string;
}, output: {
    title: string;
    output: string;
    metadata: Record<string, unknown>;
} | undefined) => Promise<void>;
