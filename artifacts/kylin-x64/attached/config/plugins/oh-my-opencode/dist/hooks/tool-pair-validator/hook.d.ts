import type { Message, Part } from "@opencode-ai/sdk";
type ToolUsePart = {
    type: "tool_use";
    id: string;
    [key: string]: unknown;
};
type ToolResultPart = {
    type: "tool_result";
    tool_use_id: string;
    content: string;
    [key: string]: unknown;
};
type TransformPart = Part | ToolUsePart | ToolResultPart;
type TransformMessageInfo = Message | {
    role: "user";
    sessionID?: string;
};
interface MessageWithParts {
    info: TransformMessageInfo;
    parts: TransformPart[];
}
type MessagesTransformHook = {
    "experimental.chat.messages.transform"?: (input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
export declare function createToolPairValidatorHook(): MessagesTransformHook;
export {};
