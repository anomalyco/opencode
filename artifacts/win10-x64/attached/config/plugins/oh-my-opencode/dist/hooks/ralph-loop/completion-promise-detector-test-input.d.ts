import type { PluginInput } from "@opencode-ai/plugin";
export type SessionMessage = {
    info?: {
        role?: string;
    };
    parts?: Array<{
        type: string;
        text?: string;
    }>;
};
export declare function createPluginInput(messages: SessionMessage[]): PluginInput;
