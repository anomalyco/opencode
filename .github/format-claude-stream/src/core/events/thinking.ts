import {ClaudeIOEvent, FormattingContext} from "./claude-io-event.type.ts";

export class Thinking implements ClaudeIOEvent {
    constructor(private readonly thoughts: string) {}

    format({colorizer}: FormattingContext) {
        return colorizer.claudeThinking(`Thinking: ${this.thoughts}`);
    }
}
