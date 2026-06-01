import {ClaudeIOEvent} from "./claude-io-event.type.ts";

export interface ConstructorParams {
    toolOutput: string;
    toolUseId: string;
}

export class ToolUseSuccess implements ClaudeIOEvent {
    public readonly toolOutput: string;
    public readonly toolUseId: string;

    constructor({toolOutput, toolUseId}: ConstructorParams) {
        this.toolOutput = toolOutput;
        this.toolUseId = toolUseId;
    }

    format() {
        return `${this.toolOutput}`;
    }
}
