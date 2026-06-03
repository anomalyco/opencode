import type { PluginInput } from "@opencode-ai/plugin";
import type { AtlasHookOptions, SessionState } from "./types";
export declare function handleAtlasSessionIdle(input: {
    ctx: PluginInput;
    options?: AtlasHookOptions;
    getState: (sessionID: string) => SessionState;
    sessionID: string;
}): Promise<void>;
