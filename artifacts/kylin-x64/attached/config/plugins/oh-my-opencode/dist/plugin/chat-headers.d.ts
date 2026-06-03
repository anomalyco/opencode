import type { PluginContext } from "./types";
export declare function createChatHeadersHandler(args: {
    ctx: PluginContext;
}): (input: unknown, output: unknown) => Promise<void>;
