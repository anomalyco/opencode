import {ClaudeIOEvent, FormattingContext} from "./claude-io-event.type.ts";

export class UnrecognizedJsonEvent implements ClaudeIOEvent {
    constructor(private readonly data: unknown) {}

    format({colorizer}: FormattingContext): string {
        return colorizer.error(
            "Unrecognized JSON: " + JSON.stringify(this.data),
        );
    }
}
