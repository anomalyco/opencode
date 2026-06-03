import type { ToolContext } from "@opencode-ai/plugin/tool";
import { type RawHashlineEdit } from "./normalize-edits";
import type { PluginContext } from "../../plugin/types";
interface HashlineEditArgs {
    filePath: string;
    edits: RawHashlineEdit[];
    delete?: boolean;
    rename?: string;
}
export declare function executeHashlineEditTool(args: HashlineEditArgs, context: ToolContext, pluginCtx?: PluginContext): Promise<string>;
export {};
