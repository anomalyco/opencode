import type { ChatMessageHandlerOutput, ChatMessageInput } from "../../plugin/chat-message";
export declare function applyFallbackToChatMessage(params: {
    input: ChatMessageInput;
    output: ChatMessageHandlerOutput;
    fallback: {
        providerID: string;
        modelID: string;
        variant?: string;
    };
    toast?: (input: {
        title: string;
        message: string;
        variant?: "info" | "success" | "warning" | "error";
        duration?: number;
    }) => void | Promise<void>;
    onApplied?: (input: {
        sessionID: string;
        providerID: string;
        modelID: string;
        variant?: string;
    }) => void | Promise<void>;
    lastToastKey: Map<string, string>;
}): Promise<void>;
