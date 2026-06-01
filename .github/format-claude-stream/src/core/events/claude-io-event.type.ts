import {Colorizer} from "../ports/colorizer.ts";

export interface FormattingContext {
    colorizer: Colorizer;
    cwd?: string;
}

export interface ClaudeIOEvent {
    format(ctx: FormattingContext): string;
}
