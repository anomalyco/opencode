import {ClaudeIOEvent, FormattingContext} from "./claude-io-event.type.ts";

export class GenericToolCall implements ClaudeIOEvent {
    constructor(
        private readonly toolName: string,
        private readonly params: unknown,
    ) {}

    format({colorizer}: FormattingContext) {
        return colorizer.action(
            `${this.toolName}: ${JSON.stringify(this.params)}`,
        );
    }
}
