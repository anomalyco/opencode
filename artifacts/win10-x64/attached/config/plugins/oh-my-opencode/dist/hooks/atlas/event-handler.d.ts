import type { PluginInput } from "@opencode-ai/plugin";
import type { AtlasHookOptions, SessionState } from "./types";
export declare function createAtlasEventHandler(input: {
    ctx: PluginInput;
    options?: AtlasHookOptions;
    sessions: Map<string, SessionState>;
    getState: (sessionID: string) => SessionState;
}): (arg: {
    event: {
        type: string;
        properties?: unknown;
    };
}) => Promise<void>;
