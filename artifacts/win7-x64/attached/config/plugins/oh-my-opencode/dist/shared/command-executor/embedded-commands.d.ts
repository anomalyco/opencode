export interface CommandMatch {
    fullMatch: string;
    command: string;
    start: number;
    end: number;
}
export declare function findEmbeddedCommands(text: string): CommandMatch[];
