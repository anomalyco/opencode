import type { OhMyOpenCodeConfig } from "../config";
import type { PluginContext } from "./types";
import type { CreatedHooks } from "../create-hooks";
type FirstMessageVariantGate = {
    shouldOverride: (sessionID: string) => boolean;
    markApplied: (sessionID: string) => void;
};
type ChatMessagePart = {
    type: string;
    text?: string;
    [key: string]: unknown;
};
export type ChatMessageHandlerOutput = {
    message: Record<string, unknown>;
    parts: ChatMessagePart[];
};
export type ChatMessageInput = {
    sessionID: string;
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
};
export declare function createChatMessageHandler(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    firstMessageVariantGate: FirstMessageVariantGate;
    hooks: CreatedHooks;
}): (input: ChatMessageInput, output: ChatMessageHandlerOutput) => Promise<void>;
export {};
