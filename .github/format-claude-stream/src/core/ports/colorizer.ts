export interface Colorizer {
    claudeThinking(text: string): string;

    claudeSpeaking(text: string): string;

    importantAction(text: string): string;

    action(text: string): string;

    error(text: string): string;
}
