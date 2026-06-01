import {ClaudeIOEvent, FormattingContext} from "./claude-io-event.type.ts";

export class TextOutput implements ClaudeIOEvent {
    constructor(private readonly text: string) {}

    format({colorizer}: FormattingContext) {
        return colorizer.claudeSpeaking(`${this.text}`);
    }
}
