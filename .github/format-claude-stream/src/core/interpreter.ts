import {
    ClaudeIOEvent,
    FormattingContext,
} from "./events/claude-io-event.type.ts";
import {ToolUseSuccess} from "./events/tool-use-success.ts";
import {ToolUseError} from "./events/tool-use-error.ts";
import {ReadToolCall} from "./events/read-tool-call.ts";
import {EditToolCall} from "./events/edit-tool-call.ts";
import {WriteToolCall} from "./events/write-tool-call.ts";
import {Output} from "./ports/output.ts";

export class Interpreter {
    private readonly fileCrudToolUseIds = new Set<string>();
    private lastWrittenEvent: ClaudeIOEvent | null = null;

    constructor(
        private readonly output: Output,
        private readonly ctx: FormattingContext,
    ) {}

    async process(event: ClaudeIOEvent): Promise<void> {
        if (isFileCrudOp(event)) {
            this.fileCrudToolUseIds.add(event.toolUseId);
        }
        if (this.isFileCrudResult(event)) {
            return;
        }
        if (this.needsBlankLineBefore(event)) {
            await this.output.write("\n");
        }
        await this.output.write(event.format(this.ctx) + "\n");
        this.lastWrittenEvent = event;
    }

    private needsBlankLineBefore(event: ClaudeIOEvent): boolean {
        // Don't write a blank line at the very beginning of the output.
        if (this.lastWrittenEvent == null) {
            return false;
        }

        // Don't write a blank line between a tool call and its result.
        if (isToolResult(event)) {
            return false;
        }

        // Don't write a blank line between consecutive file operations
        if (isFileCrudOp(this.lastWrittenEvent) && isFileCrudOp(event)) {
            return false;
        }

        return true;
    }

    private isFileCrudResult(event: ClaudeIOEvent) {
        return (
            event instanceof ToolUseSuccess &&
            this.fileCrudToolUseIds.has(event.toolUseId)
        );
    }
}

function isFileCrudOp(event: ClaudeIOEvent) {
    return (
        event instanceof ReadToolCall ||
        event instanceof EditToolCall ||
        event instanceof WriteToolCall
    );
}

function isToolResult(event: ClaudeIOEvent) {
    return event instanceof ToolUseSuccess || event instanceof ToolUseError;
}
