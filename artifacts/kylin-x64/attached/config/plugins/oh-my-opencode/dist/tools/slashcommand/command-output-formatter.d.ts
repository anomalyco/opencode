import type { CommandInfo } from "./types";
export declare function formatLoadedCommand(command: CommandInfo, userMessage?: string): Promise<string>;
export declare function formatCommandList(items: CommandInfo[]): string;
