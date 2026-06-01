import {ClaudeIOEvent, FormattingContext} from "./claude-io-event.type.ts";

interface ConstructorParams {
    toolUseId: string;
    description: string;
    prompt: string;
}

export class AgentToolCall implements ClaudeIOEvent {
    toolUseId: string;
    description: string;
    prompt: string;

    constructor({toolUseId, description, prompt}: ConstructorParams) {
        this.toolUseId = toolUseId;
        this.description = description;
        this.prompt = prompt;
    }

    format({colorizer}: FormattingContext): string {
        return [
            colorizer.importantAction(`Agent: ${this.description}`),
            this.prompt,
        ].join("\n");
    }
}
