import type { Message, Part } from "@opencode-ai/sdk";
import type { CreatedHooks } from "../create-hooks";
type MessageWithParts = {
    info: Message;
    parts: Part[];
};
type MessagesTransformOutput = {
    messages: MessageWithParts[];
};
export declare function createMessagesTransformHandler(args: {
    hooks: CreatedHooks;
}): (input: Record<string, never>, output: MessagesTransformOutput) => Promise<void>;
export {};
