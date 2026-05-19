import type { PluginInput } from "@opencode-ai/plugin";
export declare function createSisyphusJuniorNotepadHook(ctx: PluginInput): {
    "tool.execute.before": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, output: {
        args: Record<string, unknown>;
        message?: string;
    }) => Promise<void>;
};
