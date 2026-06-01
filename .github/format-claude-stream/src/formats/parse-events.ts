import z from "zod";
import {ClaudeIOEvent} from "../core/events/claude-io-event.type.ts";
import {
    AssistantLine,
    StreamJsonLine,
    type UserLine,
} from "./zod-schemas/stream-json-line.ts";
import {Thinking} from "../core/events/thinking.ts";
import {TextOutput} from "../core/events/text-output.ts";
import {ToolUseMessageContent} from "./zod-schemas/assistant-message.ts";
import {ToolCall, UnrecognizedToolCall} from "./zod-schemas/tool-calls.ts";
import {GenericToolCall} from "../core/events/generic-tool-call.ts";
import {BashToolCall} from "../core/events/bash-tool-call.ts";
import {ReadToolCall} from "../core/events/read-tool-call.ts";
import {EditToolCall} from "../core/events/edit-tool-call.ts";
import {GrepToolCall} from "../core/events/grep-tool-call.ts";
import {UnreachableCodeError} from "../lib/unreachable-code-error.ts";
import {UnrecognizedJsonEvent} from "../core/events/unrecognized-json-event.ts";
import {ToolUseSuccess} from "../core/events/tool-use-success.ts";
import {ToolUseError} from "../core/events/tool-use-error.ts";
import {AgentToolCall} from "../core/events/agent-tool-call.ts";
import {TaskToolCall} from "../core/events/task-tool-call.ts";
import {
    ToolResultContent,
    UserMessageContent,
} from "./zod-schemas/user-message.ts";
import {prop} from "../lib/prop.ts";
import {WriteToolCall} from "../core/events/write-tool-call.ts";
import {GlobToolCall} from "../core/events/glob-tool-call.ts";

export function parseEvents(data: unknown): ClaudeIOEvent[] {
    const parsed = StreamJsonLine.safeParse(data);

    if (!parsed.success) {
        return [new UnrecognizedJsonEvent(data)];
    }

    switch (parsed.data.type) {
        case "assistant":
            return parseOutputEvents(parsed.data);
        case "result":
            // Result lines seem to just repeat text output earlier by
            // the assistant, so we ignore them.
            return [];
        case "stream_event":
            // These events provide incrementally streamed data, which is
            // also rolled up into other event types. We don't care about
            // streaming tokens to output as fast as they come in, so we
            // ignore these events.
            return [];
        case "system":
            // E.g. the "type":"system", "subtype":"init" event. We ignore
            // these.
            return [];
        case "rate_limit_event":
            // I'm not sure what these events are for, but they get emitted
            // every time I run `claude`.
            return [];
        case "user":
            return parseInputEvents(parsed.data);
        default:
            throw new UnreachableCodeError(parsed.data);
    }
}

function parseOutputEvents(
    data: z.infer<typeof AssistantLine>,
): ClaudeIOEvent[] {
    return data.message.content.map((content) => {
        switch (content.type) {
            case "tool_use":
                return parseToolCallEvent(content);
            case "thinking":
                return new Thinking(content.thinking);
            case "text":
                return new TextOutput(content.text);
            default:
                throw new UnreachableCodeError(content);
        }
    });
}

function parseToolCallEvent(
    data: z.infer<typeof ToolUseMessageContent>,
): ClaudeIOEvent {
    const parsedToolCall = ToolCall.safeParse(data);

    if (!parsedToolCall.success) {
        const toolCall = UnrecognizedToolCall.parse(data);
        return new GenericToolCall(toolCall.name, toolCall.input);
    }

    const toolCall = parsedToolCall.data;

    switch (toolCall.name) {
        case "Bash":
            return new BashToolCall(toolCall.input.command);
        case "Read":
            return new ReadToolCall({
                path: toolCall.input.file_path,
                toolUseId: toolCall.id,
            });
        case "Edit":
            return new EditToolCall({
                path: toolCall.input.file_path,
                toolUseId: toolCall.id,
            });
        case "Glob":
            return new GlobToolCall({
                pattern: toolCall.input.pattern,
                path: toolCall.input.path,
                toolUseId: toolCall.id,
            });
        case "Grep":
            return new GrepToolCall({
                pattern: toolCall.input.pattern,
                path: toolCall.input.path,
                toolUseId: toolCall.id,
            });
        case "Agent":
            return new AgentToolCall({
                toolUseId: toolCall.id,
                description: toolCall.input.description,
                prompt: toolCall.input.prompt,
            });
        case "Task":
            return new TaskToolCall({
                toolUseId: toolCall.id,
                subagentType: toolCall.input.subagent_type,
                description: toolCall.input.description,
                prompt: toolCall.input.prompt,
            });
        case "Write":
            return new WriteToolCall({
                toolUseId: toolCall.id,
                path: toolCall.input.file_path,
            });
        default:
            throw new UnreachableCodeError(toolCall);
    }
}

function parseInputEvents(data: z.infer<typeof UserLine>): ClaudeIOEvent[] {
    return data.message.content.flatMap(parseUserInputMessageContent);
}

function parseUserInputMessageContent(
    message: z.infer<typeof UserMessageContent>,
): ClaudeIOEvent[] {
    switch (message.type) {
        case "text":
            // No-op; don't echo messages from the user or other agents.
            return [];

        case "tool_result": {
            const toolOutput = toolResultContentToString(message.content);
            if (message.is_error) {
                return [
                    new ToolUseError(
                        toolOutput.replace(/<\/?tool_use_error>/g, ""),
                    ),
                ];
            } else {
                return [
                    new ToolUseSuccess({
                        toolOutput,
                        toolUseId: message.tool_use_id,
                    }),
                ];
            }
        }
    }
}

function toolResultContentToString(
    content: z.infer<typeof ToolResultContent>,
): string {
    switch (typeof content) {
        case "string":
            return content;
        default:
            return content.map(prop("text")).join("\n\n");
    }
}
