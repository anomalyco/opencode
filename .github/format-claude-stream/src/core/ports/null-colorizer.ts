import {Colorizer} from "./colorizer.ts";

export class NullColorizer implements Colorizer {
    claudeThinking(text: string): string {
        return text;
    }

    claudeSpeaking(text: string): string {
        return text;
    }

    importantAction(text: string): string {
        return text;
    }

    action(text: string): string {
        return text;
    }

    error(text: string): string {
        return text;
    }
}
