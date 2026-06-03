import type { ContextCollector } from "./collector";
import type { Message, Part } from "@opencode-ai/sdk";
interface OutputPart {
    type: string;
    text?: string;
    [key: string]: unknown;
}
interface InjectionResult {
    injected: boolean;
    contextLength: number;
}
export declare function injectPendingContext(collector: ContextCollector, sessionID: string, parts: OutputPart[]): InjectionResult;
interface ChatMessageInput {
    sessionID: string;
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
    messageID?: string;
}
interface ChatMessageOutput {
    message: Record<string, unknown>;
    parts: OutputPart[];
}
export declare function createContextInjectorHook(collector: ContextCollector): {
    "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>;
};
interface MessageWithParts {
    info: Message;
    parts: Part[];
}
type MessagesTransformHook = {
    "experimental.chat.messages.transform"?: (input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
export declare function createContextInjectorMessagesTransformHook(collector: ContextCollector): MessagesTransformHook;
export {};
