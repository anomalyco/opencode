import {ClaudeIOEvent, FormattingContext} from "./claude-io-event.type.ts";
import {relativizePath} from "../../lib/relativize-path.ts";

export interface ConstructorParams {
    pattern: string;
    path?: string | undefined;
    toolUseId: string;
}

export class GlobToolCall implements ClaudeIOEvent {
    public readonly pattern: string;
    public readonly path: string | undefined;
    public readonly toolUseId: string;

    constructor({pattern, path, toolUseId}: ConstructorParams) {
        this.pattern = pattern;
        this.path = path;
        this.toolUseId = toolUseId;
    }

    format({colorizer, cwd}: FormattingContext): string {
        return colorizer.action(this.message(cwd));
    }

    private message(cwd: string | undefined): string {
        if (this.path) {
            return `Glob: ${this.pattern} in ${relativizePath(cwd, this.path)}`;
        } else {
            return `Glob: ${this.pattern}`;
        }
    }
}
