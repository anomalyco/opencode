import * as z from "zod";

export const ThinkingMessageContent = z.looseObject({
    type: z.literal("thinking"),
    thinking: z.string(),
});

export const TextMessageContent = z.looseObject({
    type: z.literal("text"),
    text: z.string(),
});

export const ToolUseMessageContent = z.looseObject({
    type: z.literal("tool_use"),
    name: z.string(),
    input: z.any(),
});

export const AssistantMessageContent = z.discriminatedUnion("type", [
    ThinkingMessageContent,
    TextMessageContent,
    ToolUseMessageContent,
]);

export const AssistantMessage = z.looseObject({
    type: z.literal("message"),
    content: z.array(AssistantMessageContent),
});
