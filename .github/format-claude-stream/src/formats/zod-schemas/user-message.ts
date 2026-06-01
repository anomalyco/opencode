import * as z from "zod";

export const Text = z.looseObject({
    type: z.literal("text"),
    text: z.string(),
});

export const ToolResultContent = z.union([z.string(), z.array(Text)]);

export const ToolResult = z.looseObject({
    type: z.literal("tool_result"),
    content: ToolResultContent,
    is_error: z.optional(z.boolean()),
    tool_use_id: z.string(),
});

export const UserMessageContent = z.discriminatedUnion("type", [
    Text,
    ToolResult,
]);

export const UserMessage = z.looseObject({
    content: z.array(UserMessageContent),
});
