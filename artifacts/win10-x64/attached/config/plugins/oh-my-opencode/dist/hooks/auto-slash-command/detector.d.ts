import type { ParsedSlashCommand } from "./types";
export declare function removeCodeBlocks(text: string): string;
export declare function parseSlashCommand(text: string): ParsedSlashCommand | null;
export declare function isExcludedCommand(command: string): boolean;
export declare function detectSlashCommand(text: string): ParsedSlashCommand | null;
export declare function extractPromptText(parts: Array<{
    type: string;
    text?: string;
}>): string;
export declare function findSlashCommandPartIndex(parts: Array<{
    type: string;
    text?: string;
}>): number;
