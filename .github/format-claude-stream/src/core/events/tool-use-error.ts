import {ClaudeIOEvent, FormattingContext} from "./claude-io-event.type.ts";

export class ToolUseError implements ClaudeIOEvent {
    constructor(private readonly message: string) {}

    format({colorizer}: FormattingContext): string {
        return colorizer.error(this.message);
    }
}
