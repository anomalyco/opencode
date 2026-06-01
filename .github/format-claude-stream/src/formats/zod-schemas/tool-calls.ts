import * as z from "zod";

export const AgentToolCall = z.looseObject({
    name: z.literal("Agent"),
    id: z.string(),
    input: z.looseObject({
        description: z.string(),
        prompt: z.string(),
    }),
});

export const EditToolCall = z.looseObject({
    name: z.literal("Edit"),
    id: z.string(),
    input: z.looseObject({
        file_path: z.string(),
    }),
});

export const ReadToolCall = z.looseObject({
    name: z.literal("Read"),
    id: z.string(),
    input: z.looseObject({
        file_path: z.string(),
    }),
});

export const BashToolCall = z.looseObject({
    name: z.literal("Bash"),
    id: z.string(),
    input: z.looseObject({
        command: z.string(),
        description: z.optional(z.string()),
        timeout: z.optional(z.number()),
    }),
});

export const GlobToolCall = z.looseObject({
    name: z.literal("Glob"),
    id: z.string(),
    input: z.looseObject({
        path: z.optional(z.string()),
        pattern: z.string(),
    }),
});

export const GrepToolCall = z.looseObject({
    name: z.literal("Grep"),
    id: z.string(),
    input: z.looseObject({
        path: z.optional(z.string()),
        pattern: z.string(),
    }),
});

export const TaskToolCall = z.looseObject({
    name: z.literal("Task"),
    id: z.string(),
    input: z.looseObject({
        subagent_type: z.string(),
        description: z.string(),
        prompt: z.string(),
    }),
});

export const WriteToolCall = z.looseObject({
    name: z.literal("Write"),
    id: z.string(),
    input: z.looseObject({
        file_path: z.string(),
    }),
});

export const UnrecognizedToolCall = z.looseObject({
    name: z.string(),
    id: z.string(),
    input: z.any(),
});

export const ToolCall = z.discriminatedUnion("name", [
    AgentToolCall,
    BashToolCall,
    EditToolCall,
    GlobToolCall,
    GrepToolCall,
    ReadToolCall,
    TaskToolCall,
    WriteToolCall,
]);
