import {Output} from "./core/ports/output.ts";
import {FormattingContext} from "./core/events/claude-io-event.type.ts";
import {Interpreter} from "./core/interpreter.ts";
import {parseEvents} from "./formats/parse-events.ts";

export class ClaudeStreamFormatter {
    interpreter: Interpreter;

    constructor(output: Output, ctx: FormattingContext) {
        this.interpreter = new Interpreter(output, ctx);
    }

    async write(data: unknown): Promise<void> {
        const events = parseEvents(data);
        for (const event of events) {
            await this.interpreter.process(event);
        }
    }
}
