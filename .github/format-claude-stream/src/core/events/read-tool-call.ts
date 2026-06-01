import {ClaudeIOEvent, FormattingContext} from "./claude-io-event.type.ts";
import {relativizePath} from "../../lib/relativize-path.ts";

export interface ConstructorParams {
    path: string;
    toolUseId: string;
}

export class ReadToolCall implements ClaudeIOEvent {
    public readonly path: string;
    public readonly toolUseId: string;

    constructor({path, toolUseId}: ConstructorParams) {
        this.path = path;
        this.toolUseId = toolUseId;
    }

    format({colorizer, cwd}: FormattingContext) {
        return colorizer.action(`Read: ${relativizePath(cwd, this.path)}`);
    }
}
