import {Colorizer} from "./colorizer.ts";

export class MarkupColorizer implements Colorizer {
    claudeThinking(text: string): string {
        return this.color("claudeThinking", text);
    }

    claudeSpeaking(text: string): string {
        return this.color("claudeSpeaking", text);
    }

    importantAction(text: string): string {
        return this.color("importantAction", text);
    }

    action(text: string): string {
        return this.color("action", text);
    }

    error(text: string): string {
        return this.color("error", text);
    }

    private color(name: string, text: string) {
        return `[[${name} ${text}]]`;
    }
}
