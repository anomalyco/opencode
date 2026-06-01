import chalk from "chalk";
import {Colorizer} from "../core/ports/colorizer.ts";

export class ChalkColorizer implements Colorizer {
    claudeThinking(text: string): string {
        return this.color("#bbaa66", text);
    }

    claudeSpeaking(text: string): string {
        return this.color("#ffcc00", chalk.bold(text));
    }

    importantAction(text: string): string {
        return this.color("#88ee88", chalk.bold(text));
    }

    action(text: string): string {
        return this.color("#77bb77", text);
    }

    error(text: string): string {
        return this.color("#ff7755", text);
    }

    private color(code: string, text: string): string {
        return chalk.hex(code)(text);
    }
}
