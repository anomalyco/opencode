import {ClaudeIOEvent, FormattingContext} from "./claude-io-event.type.ts";

export class BashToolCall implements ClaudeIOEvent {
    constructor(private readonly command: string) {}

    format({colorizer}: FormattingContext): string {
        return colorizer.importantAction(`$ ${this.command}`);
    }
}
